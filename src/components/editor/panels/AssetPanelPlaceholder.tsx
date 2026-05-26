"use client";

interface Props {
  assets: Array<{ id: string; name: string; glbUrl: string; sizeBytes: number | null }>;
}

export function AssetPanelPlaceholder({ assets }: Props) {
  return (
    <aside
      className="w-64 shrink-0 flex flex-col border-r border-zinc-800 bg-zinc-900 overflow-y-auto"
      aria-label="Asset panel (coming in Chunk D)"
    >
      <div className="px-3 py-2 border-b border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Assets (Chunk D)
        </p>
      </div>
      <ul className="flex-1 px-3 py-2 space-y-1" role="list">
        {assets.length === 0 && (
          <li className="text-xs text-zinc-600 italic">No assets</li>
        )}
        {assets.map((a) => (
          <li key={a.id} className="text-xs text-zinc-400 truncate" title={a.name}>
            {a.name}
          </li>
        ))}
      </ul>
    </aside>
  );
}
