"use client";

import dynamic from "next/dynamic";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

const SceneGraphRenderer = dynamic(
  () => import("@/components/scene-graph-renderer/SceneGraphRenderer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-neutral-100">
        <div className="text-sm text-neutral-500">Loading 3D viewer…</div>
      </div>
    ),
  }
);

interface Asset {
  id: string;
  glbUrl: string;
  name: string;
  sizeBytes: number;
}

interface Props {
  sceneGraph: SceneGraphV1;
  assets: Asset[];
  ariaLabel: string;
}

export function SceneGraphRendererClient({
  sceneGraph,
  assets,
  ariaLabel,
}: Props) {
  return (
    <SceneGraphRenderer
      sceneGraph={sceneGraph}
      assets={assets}
      ariaLabel={ariaLabel}
    />
  );
}
