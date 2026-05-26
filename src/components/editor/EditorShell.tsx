"use client";

import { useEffect } from "react";
import { useEditorStore } from "./editor-store";
import { useAutosave } from "./use-autosave";
import { PhoneNotice } from "./PhoneNotice";
import { EditorTopBar } from "./EditorTopBar";
import { EditorStatusBar } from "./EditorStatusBar";
import { AssetPanel } from "./panels/AssetPanel";
import { Viewport } from "./panels/Viewport";
import { PropertiesPanel } from "./panels/PropertiesPanel";
import { ChatPanel } from "@/components/world-visitor/ChatPanel";
import { RebaseToast } from "./RebaseToast";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

export interface EditorShellProps {
  worldId: string;
  worldTitle: string;
  sceneGraph: SceneGraphV1;
  baseVersionId: string;
  assets: Array<{ id: string; name: string; glbUrl: string; sizeBytes: number | null }>;
}

export function EditorShell({
  worldId,
  worldTitle,
  sceneGraph,
  baseVersionId,
  assets,
}: EditorShellProps) {
  // Initialize the store ONCE on mount.
  // Deps: worldId + baseVersionId are stable for the lifetime of this page.
  // sceneGraph ref is stable — same object passed from the server.
  useEffect(() => {
    useEditorStore.getState().initialize({ worldId, sceneGraph, baseVersionId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, baseVersionId]);

  // Wire the 2-second autosave cycle. Silent — no notification UI.
  useAutosave(worldId);

  return (
    <>
      {/* Phone / small-screen gate — visible only below md breakpoint */}
      <PhoneNotice worldId={worldId} worldTitle={worldTitle} />

      {/* Full editor layout — hidden below md breakpoint */}
      <div className="hidden md:flex h-screen flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
        <EditorTopBar worldId={worldId} worldTitle={worldTitle} />

        {/* Three-panel middle row */}
        <div className="flex flex-1 overflow-hidden">
          <AssetPanel worldId={worldId} initialAssets={assets} />
          <Viewport assets={assets} />
          <PropertiesPanel />
        </div>

        <EditorStatusBar />
      </div>

      {/*
       * Chat panel — fixed bottom-right overlay, same as the visitor side.
       * z-index 40: above the 3D canvas (z=0) but below any future modal
       * overlays (z=60+). The properties panel is 320px wide on the right
       * column; the chat panel floats over its bottom portion — acceptable v1
       * (properties panel scrolls; chat is a small floating element).
       *
       * T-key note: EditorTopBar's keydown handler sets gizmo mode to
       * "translate" on T. ChatPanel's keydown handler focuses the input on T
       * (when no input is already focused). Both handlers fire because neither
       * calls stopPropagation. The net effect: pressing T outside any input
       * switches gizmo mode to translate AND focuses the chat input. The gizmo
       * mode change is a harmless side effect — the user is about to type, not
       * drag a gizmo. If the user wants rotate-then-chat: press R (gizmo →
       * rotate), THEN T (chat focuses). T → gizmo translate is transient and
       * can always be changed back. Accepted v1 quirk; document in frontend.md.
       */}
      <ChatPanel />

      {/*
       * Rebase toast — floating bottom-center pill, z-50, clears after 5s.
       * Surfaces the silent autosave rebase-on-409 so editors know their
       * changes were merged on top of another editor's save. Positioned at
       * bottom-20 (80px) to clear the EditorStatusBar (h-8). Does not
       * conflict with ChatPanel which is fixed bottom-right.
       */}
      <RebaseToast />
    </>
  );
}
