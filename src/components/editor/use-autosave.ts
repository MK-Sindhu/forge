"use client";

/**
 * use-autosave.ts — 2-second autosave hook for the in-browser world editor.
 *
 * Runs a setInterval at AUTOSAVE_INTERVAL_MS. On each tick:
 *  1. Guard against re-entry with inFlightRef (slow-network safety).
 *  2. beginSave() on the store — returns null if nothing pending or already saving.
 *  3. POST ops to the API via saveOps().
 *  4. On success: completeSave().
 *  5. On conflict: rebaseOnServerVersion() then retry next tick.
 *     After MAX_CONFLICT_RETRIES consecutive conflicts: failSave() + stop retrying.
 *  6. On any other error: failSave().
 *  7. Reset conflict counter on a successful save.
 *
 * The hook is silent — no notification UI. Status bar reads autosaveStatus from
 * the store and renders it.
 */

import { useEffect, useRef } from "react";
import { useEditorStore } from "./editor-store";
import { saveOps } from "./save-client";

const AUTOSAVE_INTERVAL_MS = 2_000;
const MAX_CONFLICT_RETRIES = 3;

export function useAutosave(worldId: string) {
  const inFlightRef = useRef(false);
  const conflictRetriesRef = useRef(0);

  useEffect(() => {
    if (!worldId) return;

    const interval = setInterval(() => {
      void runSaveCycle();
    }, AUTOSAVE_INTERVAL_MS);

    async function runSaveCycle() {
      // Guard against re-entry on slow networks
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      try {
        const begun = useEditorStore.getState().beginSave();
        if (!begun) return; // nothing pending or already saving

        const result = await saveOps({
          worldId,
          ops: begun.ops,
          baseVersionId: begun.baseVersionId,
          // No label for autosave
        });

        if (result.ok) {
          useEditorStore.getState().completeSave({
            versionId: result.versionId,
            sceneGraph: result.sceneGraph,
          });
          conflictRetriesRef.current = 0;
        } else if (result.kind === "conflict") {
          conflictRetriesRef.current += 1;

          if (conflictRetriesRef.current >= MAX_CONFLICT_RETRIES) {
            useEditorStore
              .getState()
              .failSave(
                "Couldn't reconcile changes — refresh and try again."
              );
            // Reset so a manual save can still attempt a new cycle
            conflictRetriesRef.current = 0;
          } else {
            // Rebase local state on the server's current version.
            // Surviving ops remain in pendingOps and will be flushed next tick.
            useEditorStore.getState().rebaseOnServerVersion({
              versionId: result.currentVersion.versionId,
              sceneGraph: result.currentVersion.sceneGraph,
            });
          }
        } else if (result.kind === "operation-error") {
          useEditorStore
            .getState()
            .failSave(`Invalid edit: ${result.message} (op #${result.opIndex})`);
        } else {
          useEditorStore.getState().failSave(result.message);
        }
      } catch (err) {
        useEditorStore
          .getState()
          .failSave(err instanceof Error ? err.message : "Save failed.");
      } finally {
        inFlightRef.current = false;
      }
    }

    return () => clearInterval(interval);
  }, [worldId]);
}
