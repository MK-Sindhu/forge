"use client";

import dynamic from "next/dynamic";

const WorldViewer = dynamic(
  () => import("@/components/world-viewer/WorldViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-neutral-100">
        <div className="text-sm text-neutral-500">Loading 3D viewer…</div>
      </div>
    ),
  }
);

interface Props {
  glbUrl: string;
  ariaLabel: string;
}

export function WorldViewerClient({ glbUrl, ariaLabel }: Props) {
  return <WorldViewer glbUrl={glbUrl} ariaLabel={ariaLabel} />;
}
