"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step =
  | "pick_glb"
  | "pick_thumbnail"
  | "pick_video"
  | "pick_extra_images"
  | "metadata"
  | "uploading"
  | "done"
  | "error";

interface UploadProgress {
  glbSigning: "idle" | "pending" | "done" | "error";
  glbUpload: number | "done" | "error"; // 0-100, then "done" or "error"
  thumbnailSigning: "idle" | "pending" | "done" | "error";
  thumbnailUpload: number | "done" | "error";
  videoSigning: "idle" | "pending" | "done" | "error";
  videoUpload: number | "done" | "error";
  // Per-image: Map<index, status>
  imageSigning: Map<number, "idle" | "pending" | "done" | "error">;
  imageUpload: Map<number, number | "done" | "error">;
  creating: "idle" | "pending" | "done" | "error";
}

type FailedSubstep =
  | "glb_sign"
  | "glb_upload"
  | "thumbnail_sign"
  | "thumbnail_upload"
  | "video_sign"
  | "video_upload"
  | `image_sign_${number}`
  | `image_upload_${number}`
  | "create";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadFileWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream"
    );
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(file);
  });
}

function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to read video metadata — file may be corrupt"));
    };
    video.src = url;
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_GLB_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_VIDEO_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_VIDEO_DURATION_SEC = 30;
const MAX_EXTRA_IMAGES = 4;
const ALLOWED_THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function makeInitialProgress(): UploadProgress {
  return {
    glbSigning: "idle",
    glbUpload: 0,
    thumbnailSigning: "idle",
    thumbnailUpload: 0,
    videoSigning: "idle",
    videoUpload: 0,
    imageSigning: new Map(),
    imageUpload: new Map(),
    creating: "idle",
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UploadForm() {
  const router = useRouter();

  // Generate worldId once at mount — never regenerate between retries.
  const [worldId] = useState<string>(() => crypto.randomUUID());

  const [step, setStep] = useState<Step>("pick_glb");
  const [errorMessage, setErrorMessage] = useState<string>("");

  // File data
  const [glbFile, setGlbFile] = useState<File | null>(null);
  const [glbError, setGlbError] = useState<string>("");
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [thumbnailError, setThumbnailError] = useState<string>("");
  const [thumbnailPreview, setThumbnailPreview] = useState<string>("");

  // Video
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string>("");
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [videoValidating, setVideoValidating] = useState<boolean>(false);

  // Extra images
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [imageError, setImageError] = useState<string>("");

  // Metadata
  const [title, setTitle] = useState<string>("");
  const [titleError, setTitleError] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagsInput, setTagsInput] = useState<string>("");
  const [tagsError, setTagsError] = useState<string>("");
  const [tosAccepted, setTosAccepted] = useState<boolean>(false);
  const [tosError, setTosError] = useState<string>("");

  // Upload state — persisted across retries so we can resume from failure
  const [progress, setProgress] = useState<UploadProgress>(makeInitialProgress);

  // Stores the results of completed sign requests so retry can skip re-signing
  const glbKeyRef = useRef<string | null>(null);
  const glbUploadUrlRef = useRef<string | null>(null);
  const thumbnailKeyRef = useRef<string | null>(null);
  const thumbnailUploadUrlRef = useRef<string | null>(null);
  const videoKeyRef = useRef<string | null>(null);
  const videoUploadUrlRef = useRef<string | null>(null);
  // Map<fileIndex, {key, uploadUrl}> — keyed by index in imageFiles array
  const imageSignCacheRef = useRef<Map<number, { key: string; uploadUrl: string }>>(
    new Map()
  );

  // Tracks which sub-step failed for targeted retry
  const failedSubstepRef = useRef<FailedSubstep | null>(null);

  // ---------------------------------------------------------------------------
  // Revoke object URLs on unmount to prevent memory leaks
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
      if (videoPreview) URL.revokeObjectURL(videoPreview);
      imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    };
    // Only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Step 1: GLB file selection
  // ---------------------------------------------------------------------------

  function handleGlbChange(e: React.ChangeEvent<HTMLInputElement>) {
    setGlbError("");
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setGlbFile(null);
      return;
    }
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "glb" && ext !== "gltf") {
      setGlbError("File must be a .glb or .gltf file.");
      setGlbFile(null);
      return;
    }
    if (file.size > MAX_GLB_BYTES) {
      setGlbError(
        `File is too large (${formatBytes(file.size)}). Maximum is 50 MB.`
      );
      setGlbFile(null);
      return;
    }
    setGlbFile(file);
  }

  function handleGlbContinue() {
    if (!glbFile) {
      setGlbError("Please select a .glb or .gltf file.");
      return;
    }
    setStep("pick_thumbnail");
  }

  // ---------------------------------------------------------------------------
  // Step 2: Thumbnail selection
  // ---------------------------------------------------------------------------

  function handleThumbnailChange(e: React.ChangeEvent<HTMLInputElement>) {
    setThumbnailError("");
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      setThumbnailFile(null);
      if (thumbnailPreview) {
        URL.revokeObjectURL(thumbnailPreview);
        setThumbnailPreview("");
      }
      return;
    }
    if (!ALLOWED_THUMBNAIL_TYPES.includes(file.type)) {
      setThumbnailError("Thumbnail must be a JPEG, PNG, or WebP image.");
      setThumbnailFile(null);
      return;
    }
    if (file.size > MAX_THUMBNAIL_BYTES) {
      setThumbnailError(
        `Thumbnail is too large (${formatBytes(file.size)}). Maximum is 2 MB.`
      );
      setThumbnailFile(null);
      return;
    }
    if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    setThumbnailFile(file);
    setThumbnailPreview(URL.createObjectURL(file));
  }

  function handleThumbnailContinue() {
    if (!thumbnailFile) {
      setThumbnailError("Please select a thumbnail image.");
      return;
    }
    setStep("pick_video");
  }

  // ---------------------------------------------------------------------------
  // Step 3: Video selection (optional)
  // ---------------------------------------------------------------------------

  async function handleVideoChange(e: React.ChangeEvent<HTMLInputElement>) {
    setVideoError("");
    const file = e.target.files?.[0] ?? null;
    if (!file) {
      if (videoPreview) {
        URL.revokeObjectURL(videoPreview);
        setVideoPreview("");
      }
      setVideoFile(null);
      return;
    }

    // Cheap checks first
    if (file.type !== "video/mp4") {
      setVideoError("Preview video must be an MP4 file.");
      setVideoFile(null);
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setVideoError(
        `Video is too large (${formatBytes(file.size)}). Maximum is 15 MB.`
      );
      setVideoFile(null);
      return;
    }

    // Duration check — async, requires creating a temporary video element
    setVideoValidating(true);
    try {
      const duration = await getVideoDuration(file);
      if (duration > MAX_VIDEO_DURATION_SEC) {
        setVideoError("Preview must be 30 seconds or less.");
        setVideoFile(null);
        setVideoValidating(false);
        return;
      }
    } catch (err) {
      setVideoError(
        err instanceof Error
          ? err.message
          : "Could not read video metadata."
      );
      setVideoFile(null);
      setVideoValidating(false);
      return;
    }

    if (videoPreview) URL.revokeObjectURL(videoPreview);
    setVideoFile(file);
    setVideoPreview(URL.createObjectURL(file));
    setVideoValidating(false);
  }

  function handleVideoSkip() {
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview("");
    }
    setVideoFile(null);
    setVideoError("");
    setStep("pick_extra_images");
  }

  function handleVideoContinue() {
    setStep("pick_extra_images");
  }

  // ---------------------------------------------------------------------------
  // Step 4: Extra images selection (optional, up to 4)
  // ---------------------------------------------------------------------------

  function handleImagesChange(e: React.ChangeEvent<HTMLInputElement>) {
    setImageError("");
    const incoming = Array.from(e.target.files ?? []);
    if (incoming.length === 0) return;

    const available = MAX_EXTRA_IMAGES - imageFiles.length;
    if (available <= 0) {
      setImageError("Maximum 4 extra images allowed.");
      e.target.value = "";
      return;
    }

    const toAdd = incoming.slice(0, available);
    const rejected = incoming.length - toAdd.length;

    const newFiles: File[] = [];
    const newPreviews: string[] = [];
    const errors: string[] = [];

    for (const file of toAdd) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        errors.push(`"${file.name}" is not a JPEG, PNG, or WebP image.`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        errors.push(
          `"${file.name}" is too large (${formatBytes(file.size)}). Maximum is 5 MB.`
        );
        continue;
      }
      newFiles.push(file);
      newPreviews.push(URL.createObjectURL(file));
    }

    if (errors.length > 0) {
      setImageError(errors[0]);
    } else if (rejected > 0) {
      setImageError(
        `Only ${available} more image${available === 1 ? "" : "s"} can be added (max 4 total). ${rejected} file${rejected === 1 ? " was" : "s were"} ignored.`
      );
    }

    setImageFiles((prev) => [...prev, ...newFiles]);
    setImagePreviews((prev) => [...prev, ...newPreviews]);
    // Reset input so the same file can be re-added after removal
    e.target.value = "";
  }

  function handleRemoveImage(index: number) {
    setImageError("");
    setImageFiles((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setImagePreviews((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index]);
      next.splice(index, 1);
      return next;
    });
    // Invalidate sign cache for this index and shift later entries
    imageSignCacheRef.current.delete(index);
  }

  function handleImagesSkip() {
    // Revoke any existing previews
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImageFiles([]);
    setImagePreviews([]);
    setImageError("");
    setStep("metadata");
  }

  function handleImagesContinue() {
    setStep("metadata");
  }

  // ---------------------------------------------------------------------------
  // Step 5: Metadata — tag input helpers
  // ---------------------------------------------------------------------------

  const TAG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

  function commitTagInput(raw: string) {
    const normalized = raw.trim().toLowerCase().slice(0, 32);
    if (!normalized) return;

    if (!TAG_REGEX.test(normalized)) {
      setTagsError(
        "Tags must be 1–32 chars, lowercase, alphanumeric/dash/underscore only."
      );
      return;
    }
    if (tags.includes(normalized)) {
      // Silently clear the input on duplicate — not an error worth surfacing
      setTagsInput("");
      return;
    }
    if (tags.length >= 5) {
      setTagsError("Maximum 5 tags reached.");
      return;
    }
    setTagsError("");
    setTags((prev) => [...prev, normalized]);
    setTagsInput("");
  }

  function handleTagsKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitTagInput(tagsInput);
    } else if (e.key === "Backspace" && tagsInput === "" && tags.length > 0) {
      // Backspace in empty input removes the last tag
      setTagsError("");
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function handleTagsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    if (val.endsWith(",")) {
      commitTagInput(val.slice(0, -1));
    } else {
      setTagsInput(val);
      if (tagsError) setTagsError("");
    }
  }

  function handleRemoveTag(name: string) {
    setTagsError("");
    setTags((prev) => prev.filter((t) => t !== name));
  }

  // ---------------------------------------------------------------------------
  // Step 5: Metadata
  // ---------------------------------------------------------------------------

  function handlePublish() {
    let valid = true;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setTitleError("Title is required.");
      valid = false;
    } else if (trimmedTitle.length > 100) {
      setTitleError("Title must be 100 characters or fewer.");
      valid = false;
    } else {
      setTitleError("");
    }
    if (!tosAccepted) {
      setTosError("You must confirm you have the rights to share this model.");
      valid = false;
    } else {
      setTosError("");
    }
    if (!valid) return;

    setTitle(trimmedTitle);
    setStep("uploading");
    // Start the upload flow from the beginning
    runUpload(trimmedTitle, "glb_sign");
  }

  // ---------------------------------------------------------------------------
  // Upload flow
  // ---------------------------------------------------------------------------

  async function runUpload(
    resolvedTitle: string,
    startFrom: FailedSubstep
  ) {
    failedSubstepRef.current = null;
    const file = glbFile!;
    const thumb = thumbnailFile!;

    // Helper: update image-specific signing status
    function setImageSigningStatus(
      idx: number,
      status: "idle" | "pending" | "done" | "error"
    ) {
      setProgress((p) => {
        const next = { ...p, imageSigning: new Map(p.imageSigning) };
        next.imageSigning.set(idx, status);
        return next;
      });
    }

    function setImageUploadStatus(
      idx: number,
      status: number | "done" | "error"
    ) {
      setProgress((p) => {
        const next = { ...p, imageUpload: new Map(p.imageUpload) };
        next.imageUpload.set(idx, status);
        return next;
      });
    }

    // Build ordered list of upload substeps based on which files are present.
    // This mirrors the order we'll execute: glb → thumbnail → video? → images?
    const steps: FailedSubstep[] = [
      "glb_sign",
      "glb_upload",
      "thumbnail_sign",
      "thumbnail_upload",
      ...(videoFile
        ? (["video_sign", "video_upload"] as FailedSubstep[])
        : []),
      ...imageFiles.flatMap(
        (_, i) =>
          [`image_sign_${i}`, `image_upload_${i}`] as FailedSubstep[]
      ),
      "create",
    ];

    const startIndex = steps.indexOf(startFrom);
    // Use a mutable cursor instead of reassigning startFrom (avoid TS issues)
    let stepCursor = startIndex >= 0 ? startFrom : ("glb_sign" as FailedSubstep);

    try {
      // --- 1. Sign GLB -----------------------------------------------------------
      if (
        stepCursor === "glb_sign" ||
        steps.indexOf(stepCursor) <= steps.indexOf("glb_sign")
      ) {
        if (stepCursor === "glb_sign") {
          setProgress((p) => ({ ...p, glbSigning: "pending" }));
          const signRes = await fetch("/api/uploads/sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "glb",
              worldId,
              contentType: file.type || "application/octet-stream",
              sizeBytes: file.size,
            }),
          });
          if (!signRes.ok) {
            throw Object.assign(
              new Error(`Sign failed: ${await signRes.text()}`),
              { substep: "glb_sign" as const }
            );
          }
          const { uploadUrl, objectKey } = await signRes.json();
          glbUploadUrlRef.current = uploadUrl;
          glbKeyRef.current = objectKey;
          setProgress((p) => ({ ...p, glbSigning: "done", glbUpload: 0 }));
          stepCursor = "glb_upload";
        }
      }

      // --- 2. Upload GLB ---------------------------------------------------------
      if (stepCursor === "glb_upload") {
        await uploadFileWithProgress(
          glbUploadUrlRef.current!,
          file,
          (pct) => setProgress((p) => ({ ...p, glbUpload: pct }))
        ).catch((err: Error) => {
          throw Object.assign(err, { substep: "glb_upload" as const });
        });
        setProgress((p) => ({ ...p, glbUpload: "done" }));
        stepCursor = "thumbnail_sign";
      }

      // --- 3. Sign thumbnail -----------------------------------------------------
      if (stepCursor === "thumbnail_sign") {
        setProgress((p) => ({ ...p, thumbnailSigning: "pending" }));
        const signRes = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "thumbnail",
            worldId,
            contentType: thumb.type,
            sizeBytes: thumb.size,
          }),
        });
        if (!signRes.ok) {
          throw Object.assign(
            new Error(`Sign failed: ${await signRes.text()}`),
            { substep: "thumbnail_sign" as const }
          );
        }
        const { uploadUrl, objectKey } = await signRes.json();
        thumbnailUploadUrlRef.current = uploadUrl;
        thumbnailKeyRef.current = objectKey;
        setProgress((p) => ({
          ...p,
          thumbnailSigning: "done",
          thumbnailUpload: 0,
        }));
        stepCursor = "thumbnail_upload";
      }

      // --- 4. Upload thumbnail ---------------------------------------------------
      if (stepCursor === "thumbnail_upload") {
        await uploadFileWithProgress(
          thumbnailUploadUrlRef.current!,
          thumb,
          (pct) => setProgress((p) => ({ ...p, thumbnailUpload: pct }))
        ).catch((err: Error) => {
          throw Object.assign(err, { substep: "thumbnail_upload" as const });
        });
        setProgress((p) => ({ ...p, thumbnailUpload: "done" }));
        stepCursor = videoFile ? "video_sign" : (imageFiles.length > 0 ? "image_sign_0" : "create");
      }

      // --- 5. Sign video (optional) ----------------------------------------------
      if (videoFile && stepCursor === "video_sign") {
        setProgress((p) => ({ ...p, videoSigning: "pending" }));
        const mediaId = crypto.randomUUID();
        const signRes = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "video",
            worldId,
            mediaId,
            contentType: "video/mp4",
            sizeBytes: videoFile.size,
          }),
        });
        if (!signRes.ok) {
          throw Object.assign(
            new Error(`Sign failed: ${await signRes.text()}`),
            { substep: "video_sign" as const }
          );
        }
        const { uploadUrl, objectKey } = await signRes.json();
        videoUploadUrlRef.current = uploadUrl;
        videoKeyRef.current = objectKey;
        setProgress((p) => ({
          ...p,
          videoSigning: "done",
          videoUpload: 0,
        }));
        stepCursor = "video_upload";
      }

      // --- 6. Upload video (optional) --------------------------------------------
      if (videoFile && stepCursor === "video_upload") {
        await uploadFileWithProgress(
          videoUploadUrlRef.current!,
          videoFile,
          (pct) => setProgress((p) => ({ ...p, videoUpload: pct }))
        ).catch((err: Error) => {
          throw Object.assign(err, { substep: "video_upload" as const });
        });
        setProgress((p) => ({ ...p, videoUpload: "done" }));
        stepCursor = imageFiles.length > 0 ? "image_sign_0" : "create";
      }

      // --- 7. Sign + upload each extra image (optional) -------------------------
      for (let i = 0; i < imageFiles.length; i++) {
        const signStep = `image_sign_${i}` as FailedSubstep;
        const uploadStep = `image_upload_${i}` as FailedSubstep;
        const imgFile = imageFiles[i];

        if (stepCursor === signStep) {
          // Check cache first — avoid re-signing on retry
          if (!imageSignCacheRef.current.has(i)) {
            setImageSigningStatus(i, "pending");
            const mediaId = crypto.randomUUID();
            const signRes = await fetch("/api/uploads/sign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kind: "image",
                worldId,
                mediaId,
                contentType: imgFile.type,
                sizeBytes: imgFile.size,
              }),
            });
            if (!signRes.ok) {
              throw Object.assign(
                new Error(`Sign failed: ${await signRes.text()}`),
                { substep: signStep }
              );
            }
            const { uploadUrl, objectKey } = await signRes.json();
            imageSignCacheRef.current.set(i, { key: objectKey, uploadUrl });
          }
          setImageSigningStatus(i, "done");
          setImageUploadStatus(i, 0);
          stepCursor = uploadStep;
        }

        if (stepCursor === uploadStep) {
          const cached = imageSignCacheRef.current.get(i)!;
          await uploadFileWithProgress(
            cached.uploadUrl,
            imgFile,
            (pct) => setImageUploadStatus(i, pct)
          ).catch((err: Error) => {
            throw Object.assign(err, { substep: uploadStep });
          });
          setImageUploadStatus(i, "done");
          stepCursor =
            i + 1 < imageFiles.length ? `image_sign_${i + 1}` : "create";
        }
      }

      // --- 8. Create world -------------------------------------------------------
      if (stepCursor === "create") {
        setProgress((p) => ({ ...p, creating: "pending" }));

        const createRes = await fetch("/api/worlds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            worldId,
            title: resolvedTitle,
            description: description || undefined,
            tosAccepted: true,
            tags: tags.length > 0 ? tags : undefined,
            glbKey: glbKeyRef.current,
            glbSizeBytes: file.size,
            media: [
              {
                kind: "thumbnail",
                key: thumbnailKeyRef.current,
                sizeBytes: thumb.size,
              },
              ...(videoFile && videoKeyRef.current
                ? [
                    {
                      kind: "video",
                      key: videoKeyRef.current,
                      sizeBytes: videoFile.size,
                    },
                  ]
                : []),
              ...imageFiles.map((imgFile, i) => ({
                kind: "image" as const,
                key: imageSignCacheRef.current.get(i)!.key,
                sizeBytes: imgFile.size,
              })),
            ],
          }),
        });
        if (!createRes.ok) {
          throw Object.assign(
            new Error(`Create failed: ${await createRes.text()}`),
            { substep: "create" as const }
          );
        }
        const { url } = await createRes.json();
        setProgress((p) => ({ ...p, creating: "done" }));
        setStep("done");
        router.push(url);
      }
    } catch (err: unknown) {
      const e = err as Error & { substep?: FailedSubstep };
      failedSubstepRef.current = e.substep ?? null;

      // Mark the failed substep in progress state
      setProgress((p) => {
        const next = { ...p };
        const sub = e.substep;
        if (!sub) return next;

        if (sub === "glb_sign") next.glbSigning = "error";
        else if (sub === "glb_upload") next.glbUpload = "error";
        else if (sub === "thumbnail_sign") next.thumbnailSigning = "error";
        else if (sub === "thumbnail_upload") next.thumbnailUpload = "error";
        else if (sub === "video_sign") next.videoSigning = "error";
        else if (sub === "video_upload") next.videoUpload = "error";
        else if (sub === "create") next.creating = "error";
        else if (sub.startsWith("image_sign_")) {
          const idx = parseInt(sub.replace("image_sign_", ""), 10);
          next.imageSigning = new Map(p.imageSigning);
          next.imageSigning.set(idx, "error");
        } else if (sub.startsWith("image_upload_")) {
          const idx = parseInt(sub.replace("image_upload_", ""), 10);
          next.imageUpload = new Map(p.imageUpload);
          next.imageUpload.set(idx, "error");
        }
        return next;
      });

      setErrorMessage(e.message || "An unexpected error occurred.");
      setStep("error");
    }
  }

  // ---------------------------------------------------------------------------
  // Retry — resumes from the sub-step that failed, preserving completed work
  // ---------------------------------------------------------------------------

  function handleRetry() {
    const substep = failedSubstepRef.current;
    if (!substep) {
      handleStartOver();
      return;
    }

    // Reset the error marker for the failed substep
    setProgress((p) => {
      const next = { ...p };
      if (substep === "glb_sign") next.glbSigning = "idle";
      else if (substep === "glb_upload") next.glbUpload = 0;
      else if (substep === "thumbnail_sign") next.thumbnailSigning = "idle";
      else if (substep === "thumbnail_upload") next.thumbnailUpload = 0;
      else if (substep === "video_sign") next.videoSigning = "idle";
      else if (substep === "video_upload") next.videoUpload = 0;
      else if (substep === "create") next.creating = "idle";
      else if (substep.startsWith("image_sign_")) {
        const idx = parseInt(substep.replace("image_sign_", ""), 10);
        next.imageSigning = new Map(p.imageSigning);
        next.imageSigning.set(idx, "idle");
      } else if (substep.startsWith("image_upload_")) {
        const idx = parseInt(substep.replace("image_upload_", ""), 10);
        next.imageUpload = new Map(p.imageUpload);
        next.imageUpload.set(idx, 0);
      }
      return next;
    });

    setErrorMessage("");
    setStep("uploading");
    runUpload(title.trim(), substep);
  }

  function handleStartOver() {
    setStep("pick_glb");
    setGlbFile(null);
    setGlbError("");
    setThumbnailFile(null);
    setThumbnailError("");
    if (thumbnailPreview) {
      URL.revokeObjectURL(thumbnailPreview);
      setThumbnailPreview("");
    }
    if (videoPreview) {
      URL.revokeObjectURL(videoPreview);
      setVideoPreview("");
    }
    setVideoFile(null);
    setVideoError("");
    imagePreviews.forEach((url) => URL.revokeObjectURL(url));
    setImageFiles([]);
    setImagePreviews([]);
    setImageError("");
    setTitle("");
    setTitleError("");
    setDescription("");
    setTags([]);
    setTagsInput("");
    setTagsError("");
    setTosAccepted(false);
    setTosError("");
    setErrorMessage("");
    glbKeyRef.current = null;
    glbUploadUrlRef.current = null;
    thumbnailKeyRef.current = null;
    thumbnailUploadUrlRef.current = null;
    videoKeyRef.current = null;
    videoUploadUrlRef.current = null;
    imageSignCacheRef.current = new Map();
    failedSubstepRef.current = null;
    setProgress(makeInitialProgress());
  }

  // ---------------------------------------------------------------------------
  // Progress bar helper
  // ---------------------------------------------------------------------------

  function ProgressRow({
    label,
    status,
  }: {
    label: string;
    status: "idle" | "pending" | "done" | "error" | number;
  }) {
    if (status === "idle") return null;

    const isNumeric = typeof status === "number";
    const pct = isNumeric ? (status as number) : 0;

    let statusText: string;
    let barFill: number;
    if (status === "pending") {
      statusText = "Working...";
      barFill = 0;
    } else if (status === "done") {
      statusText = "Done";
      barFill = 100;
    } else if (status === "error") {
      statusText = "Failed";
      barFill = 0;
    } else {
      statusText = `${pct}%`;
      barFill = pct;
    }

    return (
      <div className="mb-3">
        <div className="flex justify-between text-sm mb-1">
          <span
            className={
              status === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-neutral-700 dark:text-neutral-300"
            }
          >
            {label}
          </span>
          <span
            className={
              status === "error"
                ? "text-red-600 dark:text-red-400"
                : status === "done"
                ? "text-green-600 dark:text-green-400"
                : "text-neutral-500 dark:text-neutral-400"
            }
          >
            {statusText}
          </span>
        </div>
        {(isNumeric || status === "done" || status === "error") && (
          <progress
            className="w-full h-2 rounded"
            value={barFill}
            max={100}
            role="progressbar"
            aria-valuenow={barFill}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={label}
          />
        )}
      </div>
    );
  }

  // Build the dynamic list of progress rows visible during upload/error states
  function renderProgressRows() {
    return (
      <>
        <ProgressRow label="Signing GLB upload" status={progress.glbSigning} />
        <ProgressRow
          label={
            typeof progress.glbUpload === "number"
              ? `Uploading GLB (${progress.glbUpload}%)`
              : "Uploading GLB"
          }
          status={progress.glbUpload}
        />
        <ProgressRow
          label="Signing thumbnail upload"
          status={progress.thumbnailSigning}
        />
        <ProgressRow
          label={
            typeof progress.thumbnailUpload === "number"
              ? `Uploading thumbnail (${progress.thumbnailUpload}%)`
              : "Uploading thumbnail"
          }
          status={progress.thumbnailUpload}
        />
        {videoFile && (
          <>
            <ProgressRow
              label="Signing video upload"
              status={progress.videoSigning}
            />
            <ProgressRow
              label={
                typeof progress.videoUpload === "number"
                  ? `Uploading video (${progress.videoUpload}%)`
                  : "Uploading video"
              }
              status={progress.videoUpload}
            />
          </>
        )}
        {imageFiles.map((imgFile, i) => (
          <div key={i}>
            <ProgressRow
              label={`Signing image ${i + 1} upload`}
              status={progress.imageSigning.get(i) ?? "idle"}
            />
            <ProgressRow
              label={
                typeof progress.imageUpload.get(i) === "number"
                  ? `Uploading image ${i + 1} (${progress.imageUpload.get(i)}%)`
                  : `Uploading image ${i + 1} — ${imgFile.name}`
              }
              status={progress.imageUpload.get(i) ?? 0}
            />
          </div>
        ))}
        <ProgressRow label="Creating world" status={progress.creating} />
      </>
    );
  }

  // Shared button classes
  const btnPrimary =
    "px-5 py-2.5 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus:ring-neutral-400";
  const btnSecondary =
    "px-5 py-2.5 rounded-md border border-neutral-300 text-neutral-700 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:focus:ring-neutral-400";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mt-8">
      {/* ------------------------------------------------------------------ */}
      {/* Step 1: Pick GLB                                                    */}
      {/* ------------------------------------------------------------------ */}
      {step === "pick_glb" && (
        <section aria-labelledby="step1-heading">
          <h2 id="step1-heading" className="text-xl font-medium mb-1">
            Step 1 of 5 — Select your 3D model
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
            Accepted formats: .glb, .gltf. Maximum size: 50 MB.
          </p>

          <div className="mb-4">
            <label
              htmlFor="glb-input"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              3D model file
            </label>
            <input
              id="glb-input"
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json,application/octet-stream"
              onChange={handleGlbChange}
              className="block w-full text-sm text-neutral-700 border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:text-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-neutral-400"
              aria-describedby={glbError ? "glb-error" : undefined}
            />
            {glbError && (
              <p id="glb-error" role="alert" className="mt-1 text-sm text-red-600">
                {glbError}
              </p>
            )}
          </div>

          {glbFile && (
            <div className="mb-4 p-3 bg-neutral-100 dark:bg-neutral-800 rounded-md text-sm">
              <p className="font-medium text-neutral-800 dark:text-neutral-200">
                {glbFile.name}
              </p>
              <p className="text-neutral-500 dark:text-neutral-400">
                {formatBytes(glbFile.size)}
              </p>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={handleGlbContinue}
              disabled={!glbFile}
              className={btnPrimary}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 2: Pick Thumbnail                                              */}
      {/* ------------------------------------------------------------------ */}
      {step === "pick_thumbnail" && (
        <section aria-labelledby="step2-heading">
          <h2 id="step2-heading" className="text-xl font-medium mb-1">
            Step 2 of 5 — Add a thumbnail
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
            Accepted formats: JPEG, PNG, WebP. Maximum size: 2 MB.
          </p>

          <div className="mb-4">
            <label
              htmlFor="thumbnail-input"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Thumbnail image
            </label>
            <input
              id="thumbnail-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleThumbnailChange}
              className="block w-full text-sm text-neutral-700 border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:text-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-neutral-400"
              aria-describedby={thumbnailError ? "thumbnail-error" : undefined}
            />
            {thumbnailError && (
              <p
                id="thumbnail-error"
                role="alert"
                className="mt-1 text-sm text-red-600"
              >
                {thumbnailError}
              </p>
            )}
          </div>

          {thumbnailPreview && (
            <div className="mb-4">
              {/* blob URL preview — unoptimized is the correct escape hatch for non-CDN sources */}
              <Image
                src={thumbnailPreview}
                alt="Thumbnail preview"
                width={384}
                height={192}
                unoptimized
                className="max-h-48 rounded-md border border-neutral-200 dark:border-neutral-700 object-cover"
              />
              {thumbnailFile && (
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  {thumbnailFile.name} — {formatBytes(thumbnailFile.size)}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setStep("pick_glb")}
              className={btnSecondary}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleThumbnailContinue}
              disabled={!thumbnailFile}
              className={btnPrimary}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 3: Pick Video (optional)                                       */}
      {/* ------------------------------------------------------------------ */}
      {step === "pick_video" && (
        <section aria-labelledby="step3-heading">
          <h2 id="step3-heading" className="text-xl font-medium mb-1">
            Step 3 of 5 — Add a preview video{" "}
            <span className="text-neutral-400 dark:text-neutral-500 font-normal text-base">
              (optional)
            </span>
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
            MP4 only. Maximum 15 MB and 30 seconds. Skip if you don&apos;t have one.
          </p>

          <div className="mb-4">
            <label
              htmlFor="video-input"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Preview video
            </label>
            <input
              id="video-input"
              type="file"
              accept="video/mp4"
              onChange={handleVideoChange}
              disabled={videoValidating}
              className="block w-full text-sm text-neutral-700 border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:text-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-neutral-400 disabled:opacity-50"
              aria-describedby={videoError ? "video-error" : undefined}
            />
            {videoValidating && (
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Checking video duration...
              </p>
            )}
            {videoError && (
              <p
                id="video-error"
                role="alert"
                className="mt-1 text-sm text-red-600"
              >
                {videoError}
              </p>
            )}
          </div>

          {videoPreview && videoFile && (
            <div className="mb-4">
              <video
                src={videoPreview}
                controls
                muted
                className="max-h-48 w-full rounded-md border border-neutral-200 dark:border-neutral-700 object-contain bg-black"
                aria-label={`Preview of ${videoFile.name}`}
              />
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                {videoFile.name} — {formatBytes(videoFile.size)}
              </p>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setStep("pick_thumbnail")}
              className={btnSecondary}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleVideoSkip}
              className={btnSecondary}
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleVideoContinue}
              disabled={!videoFile || videoValidating}
              className={btnPrimary}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 4: Pick Extra Images (optional, up to 4)                       */}
      {/* ------------------------------------------------------------------ */}
      {step === "pick_extra_images" && (
        <section aria-labelledby="step4-heading">
          <h2 id="step4-heading" className="text-xl font-medium mb-1">
            Step 4 of 5 — Add extra images{" "}
            <span className="text-neutral-400 dark:text-neutral-500 font-normal text-base">
              (optional)
            </span>
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
            JPEG, PNG, or WebP. Up to 4 images, 5 MB each. Skip if you don&apos;t
            have any.
          </p>

          {imageFiles.length < MAX_EXTRA_IMAGES && (
            <div className="mb-4">
              <label
                htmlFor="images-input"
                className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
              >
                Extra images{" "}
                <span className="text-neutral-400 dark:text-neutral-500 font-normal">
                  ({imageFiles.length} of {MAX_EXTRA_IMAGES} selected)
                </span>
              </label>
              <input
                id="images-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleImagesChange}
                className="block w-full text-sm text-neutral-700 border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:text-neutral-300 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:ring-neutral-400"
                aria-describedby={imageError ? "images-error" : undefined}
              />
            </div>
          )}

          {imageFiles.length === MAX_EXTRA_IMAGES && (
            <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
              Maximum reached ({MAX_EXTRA_IMAGES} of {MAX_EXTRA_IMAGES}). Remove
              an image to add a different one.
            </p>
          )}

          {imageError && (
            <p
              id="images-error"
              role="alert"
              className="mb-3 text-sm text-red-600"
            >
              {imageError}
            </p>
          )}

          {imagePreviews.length > 0 && (
            <div
              className="flex flex-wrap gap-3 mb-4"
              aria-label="Selected images"
            >
              {imagePreviews.map((src, i) => (
                <div key={i} className="relative inline-block">
                  {/* blob URL preview — unoptimized is the correct escape hatch for non-CDN sources */}
                  <Image
                    src={src}
                    alt={`Extra image ${i + 1}: ${imageFiles[i]?.name ?? ""}`}
                    width={64}
                    height={64}
                    unoptimized
                    className="w-16 h-16 object-cover rounded-md border border-neutral-200 dark:border-neutral-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveImage(i)}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white text-xs flex items-center justify-center hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setStep("pick_video")}
              className={btnSecondary}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleImagesSkip}
              className={btnSecondary}
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleImagesContinue}
              disabled={imageFiles.length === 0}
              className={btnPrimary}
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 5: Metadata                                                    */}
      {/* ------------------------------------------------------------------ */}
      {step === "metadata" && (
        <section aria-labelledby="step5-heading">
          <h2 id="step5-heading" className="text-xl font-medium mb-1">
            Step 5 of 5 — Describe your world
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">
            Give your world a title so others can find it.
          </p>

          <div className="mb-4">
            <label
              htmlFor="title-input"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Title <span aria-hidden="true">*</span>
            </label>
            <input
              id="title-input"
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (titleError) setTitleError("");
              }}
              maxLength={100}
              required
              placeholder="My awesome world"
              className="block w-full text-sm border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:ring-neutral-400"
              aria-describedby={titleError ? "title-error" : undefined}
            />
            {titleError && (
              <p
                id="title-error"
                role="alert"
                className="mt-1 text-sm text-red-600"
              >
                {titleError}
              </p>
            )}
          </div>

          <div className="mb-4">
            <label
              htmlFor="description-input"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Description{" "}
              <span className="text-neutral-400 dark:text-neutral-500">
                (optional)
              </span>
            </label>
            <textarea
              id="description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Describe your world..."
              className="block w-full text-sm border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-y dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:ring-neutral-400"
            />
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              {description.length} / 1000
            </p>
          </div>

          <div className="mb-4">
            <label
              htmlFor="tags-input"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
            >
              Tags{" "}
              <span className="text-neutral-400 dark:text-neutral-500">
                (optional)
              </span>
            </label>
            <input
              id="tags-input"
              type="text"
              value={tagsInput}
              onChange={handleTagsChange}
              onKeyDown={handleTagsKeyDown}
              disabled={tags.length >= 5}
              placeholder="Add tags (press Enter or comma to add, up to 5)"
              className="block w-full text-sm border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:ring-neutral-400 disabled:opacity-50 disabled:cursor-not-allowed"
              aria-describedby={tagsError ? "tags-error" : undefined}
            />
            {tagsError && (
              <p
                id="tags-error"
                role="alert"
                className="mt-1 text-sm text-red-600 dark:text-red-400"
              >
                {tagsError}
              </p>
            )}
            {tags.length > 0 && (
              <div
                className="mt-2 flex flex-wrap gap-1.5"
                aria-label="Selected tags"
              >
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="flex items-center justify-center rounded-full text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-neutral-500"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mb-6">
            <div className="flex items-start gap-2">
              <input
                id="tos-checkbox"
                type="checkbox"
                checked={tosAccepted}
                onChange={(e) => {
                  setTosAccepted(e.target.checked);
                  if (tosError) setTosError("");
                }}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 focus:ring-2 focus:ring-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:focus:ring-neutral-400"
                aria-describedby={tosError ? "tos-error" : undefined}
              />
              <label
                htmlFor="tos-checkbox"
                className="text-sm text-neutral-700 dark:text-neutral-300"
              >
                I confirm I own the rights to this 3D model and have permission
                to share it.
              </label>
            </div>
            {tosError && (
              <p
                id="tos-error"
                role="alert"
                className="mt-1 text-sm text-red-600"
              >
                {tosError}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("pick_extra_images")}
              className={btnSecondary}
            >
              Back
            </button>
            <button
              type="button"
              onClick={handlePublish}
              className={btnPrimary}
            >
              Publish
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Uploading                                                     */}
      {/* ------------------------------------------------------------------ */}
      {step === "uploading" && (
        <section aria-labelledby="uploading-heading">
          <h2 id="uploading-heading" className="text-xl font-medium mb-4">
            Publishing your world...
          </h2>
          <div aria-live="polite">{renderProgressRows()}</div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Done                                                          */}
      {/* ------------------------------------------------------------------ */}
      {step === "done" && (
        <section aria-labelledby="done-heading">
          <h2 id="done-heading" className="text-xl font-medium mb-2">
            World published!
          </h2>
          <p className="text-neutral-600 dark:text-neutral-400 text-sm">
            Redirecting you now...
          </p>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Error                                                         */}
      {/* ------------------------------------------------------------------ */}
      {step === "error" && (
        <section aria-labelledby="error-heading">
          <h2
            id="error-heading"
            className="text-xl font-medium mb-2 text-red-700"
          >
            Upload failed
          </h2>
          <p
            id="upload-error-message"
            role="alert"
            className="text-sm text-red-600 mb-4 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900"
          >
            {errorMessage}
          </p>

          <div className="mb-6" aria-live="polite">
            {renderProgressRows()}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className={btnPrimary}
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleStartOver}
              className={btnSecondary}
            >
              Start Over
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
