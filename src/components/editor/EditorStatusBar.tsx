"use client";

import { useOthers } from "@liveblocks/react";
import { useEditorStore } from "./editor-store";
import type { UserPresence } from "@/lib/liveblocks/types";
import { isEditor } from "@/lib/liveblocks/types";

/**
 * EditorStatusBar — bottom h-8 bar showing autosave status + version id.
 *
 * Reads autosaveStatus, pendingOps, lastSaveError, and baseVersionId from
 * the editor store. Status is displayed as text on the left; the short
 * version id (last 8 chars) on the right.
 *
 * "Saved" status persists until the next autosave cycle begins (idle →
 * saving → ...). This is intentional: the status bar is informational and
 * the timing-based fade is deferred to avoid fighting React's strict-mode
 * lint rules around setState-in-effects.
 */
export function EditorStatusBar() {
  const autosaveStatus = useEditorStore((s) => s.autosaveStatus);
  const pendingOpsCount = useEditorStore((s) => s.pendingOps.length);
  const lastSaveError = useEditorStore((s) => s.lastSaveError);
  const baseVersionId = useEditorStore((s) => s.baseVersionId);

  // Count of OTHER users whose presence mode is "editor".
  // Visitors in walk mode share the same room but are not counted here.
  const others = useOthers();
  const editorCount = others.filter((o) => {
    const presence = o.presence as unknown as UserPresence | null;
    return isEditor(presence);
  }).length;

  // Short version id — last 8 chars
  const shortVersion = baseVersionId ? baseVersionId.slice(-8) : "—";

  return (
    <footer
      className="h-8 shrink-0 flex items-center justify-between px-4 border-t border-zinc-800 bg-zinc-950 text-xs text-zinc-500"
      aria-label="Editor status bar"
    >
      {/* Left: collaborator count + save status */}
      <div className="flex items-center gap-3" role="status" aria-live="polite">
        {/* Collaborator presence text — muted, leftmost slot */}
        <span className="text-zinc-600 shrink-0">
          {editorCount === 0
            ? "Just you editing"
            : editorCount === 1
            ? "1 other editor here"
            : `${editorCount} other editors here`}
        </span>

        <span aria-hidden className="text-zinc-700">&middot;</span>

        {autosaveStatus === "error" ? (
          <span className="flex items-center gap-1.5 text-red-400">
            <span aria-hidden>!</span>
            Save failed{lastSaveError ? `: ${lastSaveError}` : ""}
          </span>
        ) : autosaveStatus === "saving" ? (
          <span className="text-zinc-400">Saving&hellip;</span>
        ) : autosaveStatus === "saved" ? (
          <span className="text-zinc-400">Saved</span>
        ) : autosaveStatus === "pending" ? (
          <span className="text-zinc-500">&bull; Unsaved changes</span>
        ) : (
          <span className="text-zinc-600">All saved</span>
        )}

        {pendingOpsCount > 0 && (
          <>
            <span aria-hidden>&middot;</span>
            <span>
              {pendingOpsCount} {pendingOpsCount === 1 ? "op" : "ops"} pending
            </span>
          </>
        )}
      </div>

      {/* Right: version id */}
      <div
        className="font-mono text-zinc-600"
        aria-label={`Version ${baseVersionId || "none"}`}
      >
        Version {shortVersion}
      </div>
    </footer>
  );
}
