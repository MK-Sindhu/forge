"use client";

import { useEffect } from "react";
import { useEditorStore } from "./editor-store";
import type { GizmoMode } from "./editor-store";
import { saveOps, publishVersion } from "./save-client";
import { EditorCollaborators } from "./EditorCollaborators";

interface Props {
  worldId: string;
  worldTitle: string;
}

const GIZMO_MODES: { mode: GizmoMode; label: string; shortcut: string }[] = [
  { mode: "translate", label: "Translate", shortcut: "T" },
  { mode: "rotate", label: "Rotate", shortcut: "R" },
  { mode: "scale", label: "Scale", shortcut: "S" },
];

export function EditorTopBar({ worldId, worldTitle }: Props) {
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const autosaveStatus = useEditorStore((s) => s.autosaveStatus);
  const setGizmoMode = useEditorStore((s) => s.setGizmoMode);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const selectObject = useEditorStore((s) => s.selectObject);
  const isDirty = useEditorStore((s) => s.isDirty);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      // Don't intercept shortcuts when typing in input/textarea/contenteditable
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        target.isContentEditable
      ) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.shiftKey && e.key.toLowerCase() === "z") {
        // Ctrl/Cmd+Shift+Z → redo
        e.preventDefault();
        redo();
        return;
      }

      if (modKey && (e.key.toLowerCase() === "z")) {
        // Ctrl/Cmd+Z → undo
        e.preventDefault();
        undo();
        return;
      }

      if (modKey && (e.key.toLowerCase() === "y")) {
        // Ctrl/Cmd+Y → redo (Windows convention)
        e.preventDefault();
        redo();
        return;
      }

      // T / R / S gizmo shortcuts (no modifier)
      if (!modKey && !e.shiftKey && !e.altKey) {
        if (e.key === "t" || e.key === "T") {
          setGizmoMode("translate");
          return;
        }
        if (e.key === "r" || e.key === "R") {
          setGizmoMode("rotate");
          return;
        }
        if (e.key === "s" || e.key === "S") {
          setGizmoMode("scale");
          return;
        }
        if (e.key === "Escape") {
          selectObject(null);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, setGizmoMode, selectObject]);

  const dirty = isDirty();

  // ---------------------------------------------------------------------------
  // Save as version handler
  // ---------------------------------------------------------------------------
  async function handleSaveAsVersion() {
    const label = window.prompt("Label this version (optional):");
    if (label === null) return; // user cancelled the prompt

    const begun = useEditorStore.getState().beginSave();
    if (!begun) {
      // Nothing pending or already saving — nothing to do
      return;
    }

    const result = await saveOps({
      worldId,
      ops: begun.ops,
      baseVersionId: begun.baseVersionId,
      label: label || "Manual save",
    });

    if (result.ok) {
      useEditorStore
        .getState()
        .completeSave({ versionId: result.versionId, sceneGraph: result.sceneGraph });
    } else if (result.kind === "conflict") {
      useEditorStore.getState().rebaseOnServerVersion({
        versionId: result.currentVersion.versionId,
        sceneGraph: result.currentVersion.sceneGraph,
      });
      useEditorStore
        .getState()
        .failSave("Your changes conflict with another save — autosave will retry.");
    } else {
      // operation-error or other
      const msg = result.kind === "operation-error"
        ? `Invalid edit: ${result.message} (op #${result.opIndex})`
        : result.message;
      useEditorStore.getState().failSave(msg);
    }
  }

  // ---------------------------------------------------------------------------
  // Publish handler
  // ---------------------------------------------------------------------------
  async function handlePublish() {
    const confirmed = window.confirm(
      "Publish the current version? Visitors will see this immediately."
    );
    if (!confirmed) return;

    // Flush any pending changes first so we publish the user's latest work
    const state = useEditorStore.getState();
    if (state.isDirty()) {
      const begun = state.beginSave();
      if (begun) {
        const saveResult = await saveOps({
          worldId,
          ops: begun.ops,
          baseVersionId: begun.baseVersionId,
          label: "Pre-publish save",
        });
        if (saveResult.ok) {
          useEditorStore.getState().completeSave({
            versionId: saveResult.versionId,
            sceneGraph: saveResult.sceneGraph,
          });
        } else {
          const msg =
            saveResult.kind === "operation-error"
              ? `Invalid edit: ${saveResult.message} (op #${saveResult.opIndex})`
              : saveResult.kind === "conflict"
              ? "Version conflict — autosave will retry before you can publish."
              : saveResult.message;
          useEditorStore.getState().failSave("Couldn't save before publish: " + msg);
          return;
        }
      }
    }

    // Publish the current (now up-to-date) base version
    const versionToPublish = useEditorStore.getState().baseVersionId;
    if (!versionToPublish) {
      useEditorStore.getState().failSave("Nothing to publish yet.");
      return;
    }

    const publishResult = await publishVersion({ worldId, versionId: versionToPublish });
    if (!publishResult.ok) {
      useEditorStore.getState().failSave("Publish failed: " + publishResult.message);
    }
    // On success: status bar already shows "Saved" (completeSave set it).
    // The version history panel (on the world page) will reflect the publish
    // after the user navigates there.
  }

  return (
    <header className="h-12 shrink-0 flex items-center gap-2 px-3 border-b border-zinc-800 bg-zinc-950">
      {/* Breadcrumb */}
      <a
        href={`/world/${worldId}`}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-100 transition-colors shrink-0"
        aria-label={`Back to ${worldTitle}`}
      >
        <span aria-hidden>&#8592;</span>
        <span className="max-w-[160px] truncate">{worldTitle}</span>
      </a>

      <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" aria-hidden />

      {/* Gizmo mode selector */}
      <div
        className="flex items-center gap-0.5"
        role="group"
        aria-label="Transform mode"
      >
        {GIZMO_MODES.map(({ mode, label, shortcut }) => (
          <button
            key={mode}
            onClick={() => setGizmoMode(mode)}
            aria-pressed={gizmoMode === mode}
            aria-label={`${label} (${shortcut})`}
            title={`${label} — ${shortcut}`}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              gizmoMode === mode
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            {shortcut}
          </button>
        ))}
      </div>

      <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" aria-hidden />

      {/* Undo / Redo */}
      <div className="flex items-center gap-0.5" role="group" aria-label="History">
        <button
          onClick={() => undo()}
          disabled={!canUndo()}
          aria-label="Undo (Ctrl+Z)"
          title="Undo — Ctrl+Z"
          className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Undo
        </button>
        <button
          onClick={() => redo()}
          disabled={!canRedo()}
          aria-label="Redo (Ctrl+Shift+Z)"
          title="Redo — Ctrl+Shift+Z"
          className="px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Redo
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Collaborator avatar stack — lowest-priority item; hidden below xl */}
      <div className="hidden xl:flex items-center mr-2">
        <EditorCollaborators />
      </div>

      {/* Dirty indicator */}
      {dirty && (
        <span
          className="flex items-center gap-1 text-xs text-amber-400 shrink-0"
          aria-label="Unsaved changes"
        >
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400 inline-block" />
          Unsaved
        </span>
      )}

      <div className="h-4 w-px bg-zinc-800 mx-1 shrink-0" aria-hidden />

      {/* Save + Publish */}
      <div className="flex items-center gap-1" role="group" aria-label="Save actions">
        <button
          onClick={() => void handleSaveAsVersion()}
          className="px-3 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded transition-colors"
          title="Save as a named version"
          aria-label="Save as version"
        >
          Save version
        </button>
        <button
          onClick={() => void handlePublish()}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          title="Publish current version — visitors will see it immediately"
          aria-label="Publish"
        >
          Publish
        </button>
      </div>

      {/* Autosave status pip */}
      {autosaveStatus === "saving" && (
        <span className="text-xs text-zinc-500 shrink-0" aria-live="polite">
          Saving&hellip;
        </span>
      )}
      {autosaveStatus === "error" && (
        <span className="text-xs text-red-400 shrink-0" aria-live="assertive" role="alert">
          Save failed
        </span>
      )}
    </header>
  );
}
