"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Step =
  | "pick_glb"
  | "pick_thumbnail"
  | "metadata"
  | "uploading"
  | "done"
  | "error";

interface UploadProgress {
  glbSigning: "idle" | "pending" | "done" | "error";
  glbUpload: number | "done" | "error"; // 0-100, then "done" or "error"
  thumbnailSigning: "idle" | "pending" | "done" | "error";
  thumbnailUpload: number | "done" | "error";
  creating: "idle" | "pending" | "done" | "error";
}

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type FailedSubstep =
  | "glb_sign"
  | "glb_upload"
  | "thumbnail_sign"
  | "thumbnail_upload"
  | "create";

const MAX_GLB_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_THUMBNAIL_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

  // Metadata
  const [title, setTitle] = useState<string>("");
  const [titleError, setTitleError] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [tosAccepted, setTosAccepted] = useState<boolean>(false);
  const [tosError, setTosError] = useState<string>("");

  // Upload state — persisted across retries so we can resume from failure
  const [progress, setProgress] = useState<UploadProgress>({
    glbSigning: "idle",
    glbUpload: 0,
    thumbnailSigning: "idle",
    thumbnailUpload: 0,
    creating: "idle",
  });

  // Stores the results of completed sign requests so retry can skip re-signing
  const glbKeyRef = useRef<string | null>(null);
  const glbUploadUrlRef = useRef<string | null>(null);
  const thumbnailKeyRef = useRef<string | null>(null);
  const thumbnailUploadUrlRef = useRef<string | null>(null);

  // Tracks which sub-step failed for targeted retry
  const failedSubstepRef = useRef<FailedSubstep | null>(null);

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
    setStep("metadata");
  }

  // ---------------------------------------------------------------------------
  // Step 3: Metadata
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
    startFrom:
      | "glb_sign"
      | "glb_upload"
      | "thumbnail_sign"
      | "thumbnail_upload"
      | "create"
  ) {
    failedSubstepRef.current = null;
    const file = glbFile!;
    const thumb = thumbnailFile!;

    try {
      // --- 1. Sign GLB -------------------------------------------------------
      if (startFrom === "glb_sign") {
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
          throw Object.assign(new Error(`Sign failed: ${await signRes.text()}`), {
            substep: "glb_sign" as const,
          });
        }
        const { uploadUrl, objectKey } = await signRes.json();
        glbUploadUrlRef.current = uploadUrl;
        glbKeyRef.current = objectKey;
        setProgress((p) => ({ ...p, glbSigning: "done", glbUpload: 0 }));
        startFrom = "glb_upload";
      }

      // --- 2. Upload GLB -----------------------------------------------------
      if (startFrom === "glb_upload") {
        await uploadFileWithProgress(
          glbUploadUrlRef.current!,
          file,
          (pct) => setProgress((p) => ({ ...p, glbUpload: pct }))
        ).catch((err: Error) => {
          throw Object.assign(err, { substep: "glb_upload" as const });
        });
        setProgress((p) => ({ ...p, glbUpload: "done" }));
        startFrom = "thumbnail_sign";
      }

      // --- 3. Sign thumbnail --------------------------------------------------
      if (startFrom === "thumbnail_sign") {
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
        startFrom = "thumbnail_upload";
      }

      // --- 4. Upload thumbnail ------------------------------------------------
      if (startFrom === "thumbnail_upload") {
        await uploadFileWithProgress(
          thumbnailUploadUrlRef.current!,
          thumb,
          (pct) => setProgress((p) => ({ ...p, thumbnailUpload: pct }))
        ).catch((err: Error) => {
          throw Object.assign(err, { substep: "thumbnail_upload" as const });
        });
        setProgress((p) => ({ ...p, thumbnailUpload: "done" }));
        startFrom = "create";
      }

      // --- 5. Create world ---------------------------------------------------
      if (startFrom === "create") {
        setProgress((p) => ({ ...p, creating: "pending" }));
        const createRes = await fetch("/api/worlds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            worldId,
            title: resolvedTitle,
            description: description || undefined,
            tosAccepted: true,
            glbKey: glbKeyRef.current,
            glbSizeBytes: file.size,
            thumbnailKey: thumbnailKeyRef.current,
            thumbnailSizeBytes: thumb.size,
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
        switch (e.substep) {
          case "glb_sign":
            next.glbSigning = "error";
            break;
          case "glb_upload":
            next.glbUpload = "error";
            break;
          case "thumbnail_sign":
            next.thumbnailSigning = "error";
            break;
          case "thumbnail_upload":
            next.thumbnailUpload = "error";
            break;
          case "create":
            next.creating = "error";
            break;
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
      switch (substep) {
        case "glb_sign":
          next.glbSigning = "idle";
          break;
        case "glb_upload":
          next.glbUpload = 0;
          break;
        case "thumbnail_sign":
          next.thumbnailSigning = "idle";
          break;
        case "thumbnail_upload":
          next.thumbnailUpload = 0;
          break;
        case "create":
          next.creating = "idle";
          break;
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
    setTitle("");
    setTitleError("");
    setDescription("");
    setTosAccepted(false);
    setTosError("");
    setErrorMessage("");
    glbKeyRef.current = null;
    glbUploadUrlRef.current = null;
    thumbnailKeyRef.current = null;
    thumbnailUploadUrlRef.current = null;
    failedSubstepRef.current = null;
    setProgress({
      glbSigning: "idle",
      glbUpload: 0,
      thumbnailSigning: "idle",
      thumbnailUpload: 0,
      creating: "idle",
    });
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
          <span className={status === "error" ? "text-red-600" : "text-neutral-700"}>
            {label}
          </span>
          <span
            className={
              status === "error"
                ? "text-red-600"
                : status === "done"
                ? "text-green-600"
                : "text-neutral-500"
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
            Step 1 of 3 — Select your 3D model
          </h2>
          <p className="text-sm text-neutral-500 mb-4">
            Accepted formats: .glb, .gltf. Maximum size: 50 MB.
          </p>

          <div className="mb-4">
            <label
              htmlFor="glb-input"
              className="block text-sm font-medium text-neutral-700 mb-1"
            >
              3D model file
            </label>
            <input
              id="glb-input"
              type="file"
              accept=".glb,.gltf,model/gltf-binary,model/gltf+json,application/octet-stream"
              onChange={handleGlbChange}
              className="block w-full text-sm text-neutral-700 border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              aria-describedby={glbError ? "glb-error" : undefined}
            />
            {glbError && (
              <p id="glb-error" role="alert" className="mt-1 text-sm text-red-600">
                {glbError}
              </p>
            )}
          </div>

          {glbFile && (
            <div className="mb-4 p-3 bg-neutral-100 rounded-md text-sm">
              <p className="font-medium text-neutral-800">{glbFile.name}</p>
              <p className="text-neutral-500">{formatBytes(glbFile.size)}</p>
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={handleGlbContinue}
              disabled={!glbFile}
              className="px-5 py-2.5 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
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
            Step 2 of 3 — Add a thumbnail
          </h2>
          <p className="text-sm text-neutral-500 mb-4">
            Accepted formats: JPEG, PNG, WebP. Maximum size: 2 MB.
          </p>

          <div className="mb-4">
            <label
              htmlFor="thumbnail-input"
              className="block text-sm font-medium text-neutral-700 mb-1"
            >
              Thumbnail image
            </label>
            <input
              id="thumbnail-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleThumbnailChange}
              className="block w-full text-sm text-neutral-700 border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
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
              <img
                src={thumbnailPreview}
                alt="Thumbnail preview"
                className="max-h-48 rounded-md border border-neutral-200 object-cover"
              />
              {thumbnailFile && (
                <p className="mt-1 text-sm text-neutral-500">
                  {thumbnailFile.name} — {formatBytes(thumbnailFile.size)}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            <button
              type="button"
              onClick={() => setStep("pick_glb")}
              className="px-5 py-2.5 rounded-md border border-neutral-300 text-neutral-700 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleThumbnailContinue}
              disabled={!thumbnailFile}
              className="px-5 py-2.5 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 3: Metadata                                                    */}
      {/* ------------------------------------------------------------------ */}
      {step === "metadata" && (
        <section aria-labelledby="step3-heading">
          <h2 id="step3-heading" className="text-xl font-medium mb-1">
            Step 3 of 3 — Describe your world
          </h2>
          <p className="text-sm text-neutral-500 mb-4">
            Give your world a title so others can find it.
          </p>

          <div className="mb-4">
            <label
              htmlFor="title-input"
              className="block text-sm font-medium text-neutral-700 mb-1"
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
              className="block w-full text-sm border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
              aria-describedby={titleError ? "title-error" : undefined}
            />
            {titleError && (
              <p id="title-error" role="alert" className="mt-1 text-sm text-red-600">
                {titleError}
              </p>
            )}
          </div>

          <div className="mb-4">
            <label
              htmlFor="description-input"
              className="block text-sm font-medium text-neutral-700 mb-1"
            >
              Description <span className="text-neutral-400">(optional)</span>
            </label>
            <textarea
              id="description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={4}
              placeholder="Describe your world..."
              className="block w-full text-sm border border-neutral-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-y"
            />
            <p className="mt-1 text-xs text-neutral-400">
              {description.length} / 1000
            </p>
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
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 focus:ring-2 focus:ring-neutral-900"
                aria-describedby={tosError ? "tos-error" : undefined}
              />
              <label htmlFor="tos-checkbox" className="text-sm text-neutral-700">
                I confirm I own the rights to this 3D model and have permission
                to share it.
              </label>
            </div>
            {tosError && (
              <p id="tos-error" role="alert" className="mt-1 text-sm text-red-600">
                {tosError}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep("pick_thumbnail")}
              className="px-5 py-2.5 rounded-md border border-neutral-300 text-neutral-700 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handlePublish}
              className="px-5 py-2.5 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
            >
              Publish
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 4: Uploading                                                   */}
      {/* ------------------------------------------------------------------ */}
      {step === "uploading" && (
        <section aria-labelledby="uploading-heading">
          <h2 id="uploading-heading" className="text-xl font-medium mb-4">
            Publishing your world...
          </h2>
          <div aria-live="polite">
            <ProgressRow
              label="Signing GLB upload"
              status={progress.glbSigning}
            />
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
            <ProgressRow label="Creating world" status={progress.creating} />
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 5: Done                                                        */}
      {/* ------------------------------------------------------------------ */}
      {step === "done" && (
        <section aria-labelledby="done-heading">
          <h2 id="done-heading" className="text-xl font-medium mb-2">
            World published!
          </h2>
          <p className="text-neutral-600 text-sm">Redirecting you now...</p>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step: Error                                                         */}
      {/* ------------------------------------------------------------------ */}
      {step === "error" && (
        <section aria-labelledby="error-heading">
          <h2 id="error-heading" className="text-xl font-medium mb-2 text-red-700">
            Upload failed
          </h2>
          <p
            id="upload-error-message"
            role="alert"
            className="text-sm text-red-600 mb-4 bg-red-50 border border-red-200 rounded-md px-3 py-2"
          >
            {errorMessage}
          </p>

          {/* Show what completed before the failure */}
          <div className="mb-6" aria-live="polite">
            <ProgressRow
              label="Signing GLB upload"
              status={progress.glbSigning}
            />
            <ProgressRow
              label="Uploading GLB"
              status={progress.glbUpload}
            />
            <ProgressRow
              label="Signing thumbnail upload"
              status={progress.thumbnailSigning}
            />
            <ProgressRow
              label="Uploading thumbnail"
              status={progress.thumbnailUpload}
            />
            <ProgressRow label="Creating world" status={progress.creating} />
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="px-5 py-2.5 rounded-md bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleStartOver}
              className="px-5 py-2.5 rounded-md border border-neutral-300 text-neutral-700 text-sm font-medium hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:ring-offset-2"
            >
              Start Over
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
