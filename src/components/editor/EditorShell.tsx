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
    </>
  );
}
