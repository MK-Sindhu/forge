"use client";

// WorldVisitorClient — dynamic SSR-off wrapper for WorldVisitor.
//
// Keeps Three.js out of the server bundle and out of pages like /feed that
// never render 3D. Consumers import this named export; the page-level import
// of WorldVisitorClient is what triggers the dynamic load.
//
// Pattern mirrors SceneGraphRendererClient.

import dynamic from "next/dynamic";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import type { Asset } from "@/components/scene-graph-renderer/SceneGraphScene";

const WorldVisitor = dynamic(() => import("./WorldVisitor"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-neutral-100 dark:bg-neutral-950" />
  ),
});

interface Props {
  sceneGraph: SceneGraphV1;
  assets: Asset[];
  ariaLabel?: string;
}

export function WorldVisitorClient({ sceneGraph, assets, ariaLabel }: Props) {
  return (
    <WorldVisitor
      sceneGraph={sceneGraph}
      assets={assets}
      ariaLabel={ariaLabel}
    />
  );
}

export default WorldVisitor;
