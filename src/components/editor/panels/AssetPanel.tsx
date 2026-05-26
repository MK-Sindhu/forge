"use client";

/**
 * AssetPanel — the real left-column asset panel for the in-browser editor.
 *
 * Responsibilities:
 *  1. List existing world assets (passed in as initialAssets from the server).
 *     Clicking an asset card calls store.addObject(asset.id) to place a new
 *     instance at the origin and then selectObject(newId) to auto-select it.
 *  2. Upload new assets from inside the editor:
 *     - Click the "Upload" button → file picker (.glb only, ≤50 MB)
 *     - Drag-drop a .glb file onto the panel
 *     On success the new asset is appended to a local list and ready to click.
 *
 * State-source decision (from spec):
 *  - Initial list from props (server-fetched in editor page).
 *  - After upload, new asset is appended to local useState — no server refetch.
 */

import { useState, useRef, useCallback } from "react";
import { useEditorStore } from "../editor-store";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Asset {
  id: string;
  name: string;
  glbUrl: string;
  sizeBytes: number | null;
}

export interface AssetPanelProps {
  worldId: string;
  initialAssets: Asset[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, "");
}

const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB

// ---------------------------------------------------------------------------
// Upload flow
// ---------------------------------------------------------------------------

interface UploadState {
  status: "idle" | "uploading" | "error";
  filename: string;
  progress: number; // 0-100
  error: string;
}

function makeIdleUpload(): UploadState {
  return { status: "idle", filename: "", progress: 0, error: "" };
}

function uploadWithProgress(
  url: string,
  file: File,
  contentType: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(file);
  });
}

// ---------------------------------------------------------------------------
// AssetCard
// ---------------------------------------------------------------------------

interface AssetCardProps {
  asset: Asset;
  onPlace: (assetId: string) => void;
}

function AssetCard({ asset, onPlace }: AssetCardProps) {
  const [flash, setFlash] = useState(false);

  function handleClick() {
    onPlace(asset.id);
    setFlash(true);
    setTimeout(() => setFlash(false), 600);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLLIElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  }

  return (
    <li
      role="button"
      tabIndex={0}
      aria-label={`Place ${asset.name}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={[
        "flex items-center gap-2 px-2 py-2 rounded cursor-pointer select-none",
        "hover:bg-zinc-700/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400",
        flash ? "bg-zinc-600/80" : "",
        "transition-colors",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Icon placeholder */}
      <span
        className="shrink-0 w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-zinc-400"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-xs text-zinc-200 truncate" title={asset.name}>
          {asset.name}
        </p>
        {asset.sizeBytes !== null && (
          <p className="text-[10px] text-zinc-500">{formatBytes(asset.sizeBytes)}</p>
        )}
      </div>

      {flash && (
        <span className="shrink-0 text-[10px] text-emerald-400 font-medium" aria-live="polite">
          Added
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// AssetPanel
// ---------------------------------------------------------------------------

export function AssetPanel({ worldId, initialAssets }: AssetPanelProps) {
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [upload, setUpload] = useState<UploadState>(makeIdleUpload);
  const [isDragActive, setIsDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0); // tracks nested drag-enter/leave pairs

  // ---------------------------------------------------------------------------
  // Place an asset in the world (click on card)
  // ---------------------------------------------------------------------------

  function handlePlaceAsset(assetId: string) {
    const store = useEditorStore.getState();
    const newId = store.addObject(assetId);
    store.selectObject(newId);
  }

  // ---------------------------------------------------------------------------
  // Validate + start upload
  // ---------------------------------------------------------------------------

  async function startUpload(file: File) {
    // Validate extension
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "glb") {
      setUpload({
        status: "error",
        filename: file.name,
        progress: 0,
        error: "Only .glb files are supported.",
      });
      return;
    }

    // Validate size
    if (file.size > MAX_ASSET_BYTES) {
      setUpload({
        status: "error",
        filename: file.name,
        progress: 0,
        error: `File is too large (${formatBytes(file.size)}). Maximum is 50 MB.`,
      });
      return;
    }

    setUpload({ status: "uploading", filename: file.name, progress: 0, error: "" });

    const assetId = crypto.randomUUID();
    const contentType = file.type || "model/gltf-binary";

    // Step 1: presign
    let uploadUrl: string;
    let objectKey: string;
    try {
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "asset",
          worldId,
          assetId,
          fileName: file.name,
          contentType,
          contentLength: file.size,
          sizeBytes: file.size,
        }),
      });
      if (!signRes.ok) {
        const text = await signRes.text();
        setUpload({
          status: "error",
          filename: file.name,
          progress: 0,
          error: `Could not get upload URL: ${text}`,
        });
        return;
      }
      ({ uploadUrl, objectKey } = await signRes.json());
      // objectKey is returned but not needed here — server infers it from assetId
      void objectKey;
    } catch {
      setUpload({
        status: "error",
        filename: file.name,
        progress: 0,
        error: "Network error while requesting upload URL.",
      });
      return;
    }

    // Step 2: PUT to R2
    try {
      await uploadWithProgress(uploadUrl, file, contentType, (pct) => {
        setUpload((prev) => ({ ...prev, progress: pct }));
      });
    } catch (err) {
      setUpload({
        status: "error",
        filename: file.name,
        progress: 0,
        error: err instanceof Error ? err.message : "Upload failed.",
      });
      return;
    }

    // Step 3: finalize
    const name = stripExt(file.name);
    try {
      const finalRes = await fetch(`/api/worlds/${worldId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId, name, sizeBytes: file.size }),
      });
      if (!finalRes.ok) {
        const text = await finalRes.text();
        setUpload({
          status: "error",
          filename: file.name,
          progress: 0,
          error: `Upload registered but could not be saved: ${text}`,
        });
        return;
      }
      const newAsset: Asset = await finalRes.json();
      setAssets((prev) => [newAsset, ...prev]);
      setUpload(makeIdleUpload());

      // Reset file input so the same file can be re-uploaded if desired
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch {
      setUpload({
        status: "error",
        filename: file.name,
        progress: 0,
        error: "Network error while finalizing upload.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // File input change
  // ---------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      void startUpload(file);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag-drop handlers
  // ---------------------------------------------------------------------------

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragActive(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault(); // required for drop to work
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      void startUpload(file);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId]);

  // ---------------------------------------------------------------------------
  // Dismiss upload error
  // ---------------------------------------------------------------------------

  function dismissError() {
    setUpload(makeIdleUpload());
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const count = assets.length;

  return (
    <aside
      className={[
        "w-64 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900 overflow-hidden",
        isDragActive ? "ring-2 ring-inset ring-blue-500 bg-zinc-800" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Assets panel"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center gap-2 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
          Assets
        </span>
        <span
          className="ml-auto text-[10px] font-medium bg-zinc-700 text-zinc-300 rounded-full px-1.5 py-0.5 tabular-nums"
          aria-label={`${count} asset${count === 1 ? "" : "s"}`}
        >
          {count}
        </span>
      </div>

      {/* Upload button */}
      <div className="px-3 py-2 shrink-0 border-b border-zinc-800">
        <label
          htmlFor="asset-upload-input"
          className="block w-full text-center text-xs font-medium py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 cursor-pointer focus-within:ring-2 focus-within:ring-zinc-400 transition-colors"
        >
          {upload.status === "uploading" ? "Uploading..." : "Upload .glb"}
        </label>
        <input
          id="asset-upload-input"
          ref={fileInputRef}
          type="file"
          accept=".glb,model/gltf-binary"
          className="sr-only"
          aria-label="Upload a .glb asset file"
          onChange={handleFileChange}
          disabled={upload.status === "uploading"}
        />
      </div>

      {/* Upload progress */}
      {upload.status === "uploading" && (
        <div className="px-3 py-2 border-b border-zinc-800 shrink-0" aria-live="polite">
          <p className="text-[11px] text-zinc-400 truncate mb-1" title={upload.filename}>
            {upload.filename}
          </p>
          <div className="w-full h-1.5 rounded bg-zinc-700 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${upload.progress}%` }}
              role="progressbar"
              aria-valuenow={upload.progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${upload.filename}: ${upload.progress}%`}
            />
          </div>
          <p className="text-[10px] text-zinc-500 mt-0.5">{upload.progress}%</p>
        </div>
      )}

      {/* Upload error */}
      {upload.status === "error" && (
        <div
          role="alert"
          className="mx-3 my-2 px-2 py-2 rounded bg-red-900/40 border border-red-700 shrink-0"
        >
          <p className="text-[11px] text-red-300 break-words">{upload.error}</p>
          <button
            type="button"
            onClick={dismissError}
            className="mt-1 text-[10px] text-red-400 underline hover:text-red-200 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Drag-active overlay message */}
      {isDragActive && (
        <div
          className="mx-3 my-2 px-2 py-3 rounded border-2 border-dashed border-blue-400 text-center text-xs text-blue-300 shrink-0"
          aria-live="polite"
        >
          Drop .glb to upload
        </div>
      )}

      {/* Asset list */}
      <div className="flex-1 overflow-y-auto">
        {assets.length === 0 && upload.status !== "uploading" ? (
          <p className="px-3 py-4 text-xs text-zinc-500 text-center leading-relaxed">
            Drop a .glb here or click Upload to add your first asset.
          </p>
        ) : (
          <ul
            className="px-2 py-2 space-y-0.5"
            role="list"
            aria-label="World assets"
          >
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} onPlace={handlePlaceAsset} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
