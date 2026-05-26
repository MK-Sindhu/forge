"use client";

import { useEditorStore } from "../../editor-store";
import { ColorInput } from "./ColorInput";

// The 8 skybox presets from EnvironmentSchema
const SKYBOX_OPTIONS = [
  "studio",
  "sunset",
  "dawn",
  "night",
  "warehouse",
  "park",
  "city",
  "forest",
] as const;

type SkyboxPreset = typeof SKYBOX_OPTIONS[number];

const DEFAULT_FOG = { color: "#888888", near: 1, far: 100 };

/**
 * EnvironmentTab — controls skybox preset and fog configuration.
 * Reads/writes via setEnvironment(). No direct API calls.
 */
export function EnvironmentTab() {
  const environment = useEditorStore((s) => s.sceneGraph.environment);
  const setEnvironment = useEditorStore((s) => s.setEnvironment);

  const fogEnabled = environment.fog !== null;

  function handleSkyboxChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setEnvironment({ ...environment, skybox: e.target.value as SkyboxPreset });
  }

  function handleFogToggle(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.checked) {
      setEnvironment({ ...environment, fog: DEFAULT_FOG });
    } else {
      setEnvironment({ ...environment, fog: null });
    }
  }

  function patchFog(patch: Partial<NonNullable<typeof environment.fog>>) {
    if (!environment.fog) return;
    setEnvironment({ ...environment, fog: { ...environment.fog, ...patch } });
  }

  return (
    <div className="flex flex-col gap-4 px-3 py-3 flex-1 overflow-y-auto">
      {/* Skybox */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-zinc-400" htmlFor="skybox-select">
          Skybox
        </label>
        <select
          id="skybox-select"
          value={environment.skybox}
          onChange={handleSkyboxChange}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 capitalize"
        >
          {SKYBOX_OPTIONS.map((preset) => (
            <option key={preset} value={preset} className="capitalize">
              {preset.charAt(0).toUpperCase() + preset.slice(1)}
            </option>
          ))}
        </select>
      </div>

      {/* Fog */}
      <div className="flex flex-col gap-3 border-t border-zinc-800 pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={fogEnabled}
            onChange={handleFogToggle}
            aria-label="Enable fog"
            className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500/40 focus:ring-offset-0"
          />
          <span className="text-xs font-medium text-zinc-400">Enable fog</span>
        </label>

        {fogEnabled && environment.fog && (
          <div className="flex flex-col gap-3 pl-1">
            {/* Fog color */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 w-10 shrink-0">Color</span>
              <ColorInput
                value={environment.fog.color}
                onCommit={(c) => patchFog({ color: c })}
              />
            </div>

            {/* Near */}
            <div className="flex items-center gap-2">
              <label
                className="text-xs text-zinc-400 w-10 shrink-0"
                htmlFor="fog-near"
              >
                Near
              </label>
              <input
                id="fog-near"
                type="number"
                min={0}
                step={0.5}
                value={environment.fog.near}
                aria-label="Fog near distance"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 0) patchFog({ near: v });
                }}
              />
            </div>

            {/* Far */}
            <div className="flex items-center gap-2">
              <label
                className="text-xs text-zinc-400 w-10 shrink-0"
                htmlFor="fog-far"
              >
                Far
              </label>
              <input
                id="fog-far"
                type="number"
                min={0.01}
                step={1}
                value={environment.fog.far}
                aria-label="Fog far distance"
                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-100 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v > 0) patchFog({ far: v });
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
