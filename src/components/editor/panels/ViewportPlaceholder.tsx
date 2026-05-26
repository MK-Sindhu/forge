"use client";

import { useEditorStore } from "../editor-store";

export function ViewportPlaceholder() {
  const objects = useEditorStore((s) => s.sceneGraph.objects);
  const lights = useEditorStore((s) => s.sceneGraph.lights);
  const spawns = useEditorStore((s) => s.sceneGraph.spawnPoints);

  return (
    <div
      className="flex flex-1 items-center justify-center bg-zinc-900 text-zinc-400"
      aria-label="3D viewport (coming in Chunk C)"
    >
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-zinc-300">Viewport (Chunk C)</p>
        <p className="text-xs">
          {objects.length} {objects.length === 1 ? "object" : "objects"} &middot;{" "}
          {lights.length} {lights.length === 1 ? "light" : "lights"} &middot;{" "}
          {spawns.length} {spawns.length === 1 ? "spawn point" : "spawn points"}
        </p>
      </div>
    </div>
  );
}
