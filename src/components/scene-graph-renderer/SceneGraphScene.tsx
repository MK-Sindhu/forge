"use client";

import { useMemo } from "react";
import { useGLTF, Environment } from "@react-three/drei";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Asset {
  id: string;
  glbUrl: string;
  name: string;
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// AssetObject — loads one GLB asset and renders it at the given transform.
//
// IMPORTANT: drei's useGLTF returns a SHARED scene graph cached by URL. If
// two objects reference the same assetUrl, both would end up pointing at the
// same THREE.Object3D tree — applying different transforms to it would fight.
// scene.clone(true) gives each instance its own independent copy of the tree
// while still hitting the useGLTF URL cache (the binary is not re-fetched).
//
// Note: scene.clone(true) does NOT deep-clone SkinnedMesh skeletons correctly.
// Phase 2 v1 does not support skinned animations, so plain clone is sufficient.
// If/when animation support lands, switch to SkeletonUtils.clone.
// ---------------------------------------------------------------------------

export function AssetObject({
  assetUrl,
  position,
  rotation,
  scale,
}: {
  assetUrl: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}) {
  const { scene } = useGLTF(assetUrl);
  // Re-clone only when the underlying scene reference changes (i.e., a new
  // GLB loaded). This avoids cloning on every render.
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <primitive object={cloned} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// SceneGraphScene — the actual Three.js content inside a Canvas.
// Renders lights, environment, fog, and all positioned asset instances.
//
// This component is extracted so it can be embedded inside different Canvas
// wrappers (e.g. SceneGraphRenderer for orbit viewing, WorldVisitor for
// walk mode) each with their own camera and controls.
// ---------------------------------------------------------------------------

export function SceneGraphScene({
  sceneGraph,
  assetsById,
}: {
  sceneGraph: SceneGraphV1;
  assetsById: Record<string, Asset>;
}) {
  return (
    <>
      {/* Lights — discriminated union on `type` */}
      {sceneGraph.lights.map((light, i) => {
        if (light.type === "ambient") {
          return (
            <ambientLight
              key={i}
              intensity={light.intensity}
              color={light.color}
            />
          );
        }
        if (light.type === "sun") {
          return (
            <directionalLight
              key={i}
              intensity={light.intensity}
              position={light.direction}
              color={light.color}
            />
          );
        }
        // Future light types (e.g. point, spot) fall through here silently
        // until the renderer supports them.
        return null;
      })}

      {/* Environment (IBL skybox) — skip if skybox is null/undefined */}
      {sceneGraph.environment.skybox && (
        <Environment preset={sceneGraph.environment.skybox} />
      )}

      {/* Fog — three.js fog via JSX attach */}
      {sceneGraph.environment.fog && (
        <fog
          attach="fog"
          args={[
            sceneGraph.environment.fog.color,
            sceneGraph.environment.fog.near,
            sceneGraph.environment.fog.far,
          ]}
        />
      )}

      {/* Objects — one AssetObject per scene-graph object entry */}
      {sceneGraph.objects.map((obj) => {
        const asset = assetsById[obj.assetId];
        if (!asset) {
          console.warn(
            `[SceneGraphScene] Missing asset ${obj.assetId} for object ${obj.id} — skipping`
          );
          return null;
        }
        return (
          <AssetObject
            key={obj.id}
            assetUrl={asset.glbUrl}
            position={obj.position}
            rotation={obj.rotation}
            scale={obj.scale}
          />
        );
      })}
    </>
  );
}
