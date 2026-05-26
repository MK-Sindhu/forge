"use client";

import { useEditorStore } from "../editor-store";
import { ObjectTab } from "./properties/ObjectTab";
import { LightsTab } from "./properties/LightsTab";
import { EnvironmentTab } from "./properties/EnvironmentTab";
import { SpawnPointsTab } from "./properties/SpawnPointsTab";
import type { PropertiesTab } from "../editor-store";

const TABS: { id: PropertiesTab; label: string }[] = [
  { id: "object", label: "Object" },
  { id: "lights", label: "Lights" },
  { id: "environment", label: "Environment" },
  { id: "spawn-points", label: "Spawn" },
];

/**
 * PropertiesPanel — right column of the editor.
 * 4-tab layout: Object | Lights | Environment | Spawn.
 * Tab state is stored in the editor store (propertiesTab).
 */
export function PropertiesPanel() {
  const propertiesTab = useEditorStore((s) => s.propertiesTab);
  const setPropertiesTab = useEditorStore((s) => s.setPropertiesTab);

  return (
    <aside
      className="w-80 shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-hidden"
      aria-label="Properties panel"
    >
      {/* Tab bar */}
      <div
        className="flex shrink-0 border-b border-zinc-800"
        role="tablist"
        aria-label="Properties tabs"
      >
        {TABS.map((tab) => {
          const isActive = propertiesTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`properties-tabpanel-${tab.id}`}
              id={`properties-tab-${tab.id}`}
              type="button"
              onClick={() => setPropertiesTab(tab.id)}
              className={`flex-1 h-10 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                isActive
                  ? "text-zinc-100 bg-zinc-800 border-b-2 border-blue-500"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div
        id={`properties-tabpanel-${propertiesTab}`}
        role="tabpanel"
        aria-labelledby={`properties-tab-${propertiesTab}`}
        className="flex-1 flex flex-col overflow-hidden"
      >
        {propertiesTab === "object" && <ObjectTab />}
        {propertiesTab === "lights" && <LightsTab />}
        {propertiesTab === "environment" && <EnvironmentTab />}
        {propertiesTab === "spawn-points" && <SpawnPointsTab />}
      </div>
    </aside>
  );
}
