"use client";

import { useEditorStore } from "../../editor-store";
import { Vec3Input } from "./Vec3Input";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

type SpawnPoint = SceneGraphV1["spawnPoints"][number];

/**
 * SpawnPointsTab — list of spawn points with position/rotation editing.
 *
 * ID is read-only (stable identifiers — renaming would break any targeting by id).
 * Rotation displayed in degrees; stored in radians.
 * Delete is disabled when only 1 spawn point remains (invariant from Chunk A).
 */
export function SpawnPointsTab() {
  const spawnPoints = useEditorStore((s) => s.sceneGraph.spawnPoints);
  const addSpawn = useEditorStore((s) => s.addSpawn);
  const updateSpawn = useEditorStore((s) => s.updateSpawn);
  const deleteSpawn = useEditorStore((s) => s.deleteSpawn);

  function handleAddSpawn() {
    const id = "spawn_" + crypto.randomUUID().slice(0, 8);
    addSpawn({
      id,
      position: [0, 1.6, 0],
      rotation: [0, 0, 0],
    });
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3 flex-1 overflow-y-auto">
      {spawnPoints.map((spawn) => (
        <SpawnCard
          key={spawn.id}
          spawn={spawn}
          isLast={spawnPoints.length === 1}
          onUpdate={(patch) => updateSpawn(spawn.id, patch)}
          onDelete={() => deleteSpawn(spawn.id)}
        />
      ))}

      {/* Add spawn */}
      <div className="pt-2 border-t border-zinc-800">
        <button
          type="button"
          onClick={handleAddSpawn}
          className="w-full py-1.5 px-3 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
        >
          + Add spawn point
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpawnCard
// ---------------------------------------------------------------------------

interface SpawnCardProps {
  spawn: SpawnPoint;
  isLast: boolean;
  onUpdate: (patch: Partial<Omit<SpawnPoint, "id">>) => void;
  onDelete: () => void;
}

function SpawnCard({ spawn, isLast, onUpdate, onDelete }: SpawnCardProps) {
  const rotDeg: [number, number, number] = [
    spawn.rotation[0] * RAD_TO_DEG,
    spawn.rotation[1] * RAD_TO_DEG,
    spawn.rotation[2] * RAD_TO_DEG,
  ];

  function commitRotation(deg: [number, number, number]) {
    onUpdate({
      rotation: [
        deg[0] * DEG_TO_RAD,
        deg[1] * DEG_TO_RAD,
        deg[2] * DEG_TO_RAD,
      ],
    });
  }

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2.5 flex flex-col gap-2.5">
      {/* Header: ID + delete */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-[10px] font-mono text-zinc-500 truncate"
          title={spawn.id}
        >
          {spawn.id}
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={isLast}
          title={isLast ? "At least 1 spawn point required." : `Delete ${spawn.id}`}
          aria-label={`Delete spawn ${spawn.id}`}
          aria-disabled={isLast}
          className={`shrink-0 text-xs px-1.5 py-0.5 rounded transition-colors focus:outline-none focus:ring-1 ${
            isLast
              ? "text-zinc-700 cursor-not-allowed"
              : "text-zinc-500 hover:text-red-400 focus:ring-red-500/30"
          }`}
        >
          Delete
        </button>
      </div>

      {/* Position */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-zinc-400">Position</span>
        <Vec3Input
          value={spawn.position}
          onCommit={(pos) => onUpdate({ position: pos })}
          precision={3}
        />
      </div>

      {/* Rotation (degrees) */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-zinc-400">Rotation</span>
        <Vec3Input
          value={rotDeg}
          onCommit={commitRotation}
          precision={1}
          unit="°"
        />
      </div>
    </div>
  );
}
