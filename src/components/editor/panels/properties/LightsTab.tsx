"use client";

import { useState } from "react";
import { useEditorStore } from "../../editor-store";
import { Vec3Input } from "./Vec3Input";
import { ColorInput } from "./ColorInput";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

type Light = SceneGraphV1["lights"][number];
type SunLight = Extract<Light, { type: "sun" }>;
type AmbientLight = Extract<Light, { type: "ambient" }>;

/**
 * LightsTab — editable list of scene lights.
 * Each light card exposes intensity, color, and (for sun) direction.
 * The "+ Add light" button appends a new sun or ambient with defaults.
 */
export function LightsTab() {
  const lights = useEditorStore((s) => s.sceneGraph.lights);
  const setLights = useEditorStore((s) => s.setLights);
  const [addType, setAddType] = useState<"sun" | "ambient">("sun");

  function patchLight(index: number, patch: Partial<Light>) {
    const next = lights.map((l, i) => (i === index ? { ...l, ...patch } as Light : l));
    setLights(next);
  }

  function removeLight(index: number) {
    const next = lights.filter((_, i) => i !== index);
    setLights(next);
  }

  function addLight() {
    if (addType === "sun") {
      const newLight: SunLight = {
        type: "sun",
        intensity: 1,
        direction: [5, 5, 5],
        color: "#ffffff",
      };
      setLights([...lights, newLight]);
    } else {
      const newLight: AmbientLight = {
        type: "ambient",
        intensity: 0.5,
        color: "#ffffff",
      };
      setLights([...lights, newLight]);
    }
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-3 flex-1 overflow-y-auto">
      {lights.length === 0 && (
        <p className="text-xs text-zinc-600 italic py-2">
          No lights — scene will be dark. Add a light below.
        </p>
      )}

      {lights.map((light, i) => (
        <LightCard
          key={i}
          light={light}
          onPatch={(patch) => patchLight(i, patch)}
          onRemove={() => removeLight(i)}
        />
      ))}

      {/* Add light row */}
      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
        <select
          value={addType}
          onChange={(e) => setAddType(e.target.value as "sun" | "ambient")}
          aria-label="Light type to add"
          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
        >
          <option value="sun">Sun light</option>
          <option value="ambient">Ambient light</option>
        </select>
        <button
          type="button"
          onClick={addLight}
          className="shrink-0 px-3 py-1 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-colors"
        >
          + Add
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LightCard
// ---------------------------------------------------------------------------

interface LightCardProps {
  light: Light;
  onPatch: (patch: Partial<Light>) => void;
  onRemove: () => void;
}

function LightCard({ light, onPatch, onRemove }: LightCardProps) {
  const isSun = light.type === "sun";

  return (
    <div className="rounded border border-zinc-700 bg-zinc-800/50 p-2.5 flex flex-col gap-2.5">
      {/* Header row: type badge + remove button */}
      <div className="flex items-center justify-between">
        <span
          className={`text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
            isSun
              ? "bg-amber-900/60 text-amber-300"
              : "bg-purple-900/60 text-purple-300"
          }`}
        >
          {isSun ? "Sun" : "Ambient"}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-zinc-500 hover:text-red-400 text-xs px-1.5 py-0.5 rounded focus:outline-none focus:ring-1 focus:ring-red-500/30 transition-colors"
          aria-label={`Remove ${isSun ? "sun" : "ambient"} light`}
        >
          Remove
        </button>
      </div>

      {/* Intensity */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-400 w-16 shrink-0" htmlFor={undefined}>
          Intensity
        </label>
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={light.intensity}
          aria-label="Light intensity"
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onPatch({ intensity: Math.max(0, Math.min(10, v)) } as Partial<Light>);
          }}
        />
      </div>

      {/* Color */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 w-16 shrink-0">Color</span>
        <ColorInput
          value={light.color}
          onCommit={(c) => onPatch({ color: c } as Partial<Light>)}
        />
      </div>

      {/* Direction (sun only) */}
      {isSun && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Direction</span>
          <Vec3Input
            value={(light as SunLight).direction}
            onCommit={(dir) => onPatch({ direction: dir } as Partial<Light>)}
            precision={2}
          />
        </div>
      )}
    </div>
  );
}
