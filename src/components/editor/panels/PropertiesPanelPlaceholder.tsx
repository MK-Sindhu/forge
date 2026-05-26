"use client";

import { useEditorStore } from "../editor-store";

export function PropertiesPanelPlaceholder() {
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);

  return (
    <aside
      className="w-80 shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-y-auto"
      aria-label="Properties panel (coming in Chunk E)"
    >
      <div className="px-3 py-2 border-b border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Properties (Chunk E)
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        {selectedObjectId ? (
          <div className="text-center space-y-1">
            <p className="text-xs text-zinc-400">Selected object:</p>
            <p className="text-xs font-mono text-zinc-300 break-all">{selectedObjectId}</p>
          </div>
        ) : (
          <p className="text-xs text-zinc-600 italic text-center">
            Select an object in the viewport
          </p>
        )}
      </div>
    </aside>
  );
}
