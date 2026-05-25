"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Bounds,
  useGLTF,
  Environment,
  useProgress,
} from "@react-three/drei";
import { WorldViewerErrorBoundary } from "@/components/world-viewer/WorldViewerErrorBoundary";
import { ViewerLoading, ViewerError } from "@/components/world-viewer/WorldViewerFallback";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Asset {
  id: string;
  glbUrl: string;
  name: string;
  sizeBytes: number;
}

interface Props {
  sceneGraph: SceneGraphV1;
  assets: Asset[];
  ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// LoadingOverlay — reads THREE.DefaultLoadingManager via useProgress (a
// zustand hook), so it can live outside the Canvas and overlay the canvas.
// ---------------------------------------------------------------------------

function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <ViewerLoading />;
}

// ---------------------------------------------------------------------------
// FullscreenButton — toggle browser fullscreen on the containing div.
// Syncs its icon state via the fullscreenchange DOM event so pressing Escape
// doesn't leave the icon stale.
// ---------------------------------------------------------------------------

function FullscreenButton({
  containerRef,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [containerRef]);

  const toggle = async () => {
    if (!containerRef.current) return;
    try {
      if (isFullscreen) {
        await document.exitFullscreen();
      } else {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn("[SceneGraphRenderer] fullscreen toggle failed:", err);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      className="absolute right-3 top-3 z-10 rounded-md bg-black/50 p-2 text-white opacity-70 transition hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white"
    >
      {isFullscreen ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 3v4a1 1 0 0 1-1 1H3" />
          <path d="M21 8h-4a1 1 0 0 1-1-1V3" />
          <path d="M3 16h4a1 1 0 0 1 1 1v4" />
          <path d="M16 21v-4a1 1 0 0 1 1-1h4" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 8V5a2 2 0 0 1 2-2h3" />
          <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
          <path d="M3 16v3a2 2 0 0 0 2 2h3" />
          <path d="M21 16v3a2 2 0 0 1-2 2h-3" />
        </svg>
      )}
    </button>
  );
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

function AssetObject({
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
// SceneGraphScene — the actual Three.js content inside the Canvas.
// Renders lights, environment, fog, and all positioned asset instances.
// ---------------------------------------------------------------------------

function SceneGraphScene({
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
            `[SceneGraphRenderer] Missing asset ${obj.assetId} for object ${obj.id} — skipping`
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

// ---------------------------------------------------------------------------
// SceneGraphRenderer — public API
//
// Props:
//   sceneGraph  — parsed SceneGraphV1 (from worlds.scene_graph jsonb)
//   assets      — array of asset rows for this world (from world_assets table)
//   ariaLabel   — accessible label for the canvas (defaults to "3D world viewer")
//
// Camera: initial position + fov come from sceneGraph.camera. The `target`
// field is intentionally NOT applied at init — <Bounds> takes over the camera
// position at mount to auto-fit all objects. Passing a target that fights with
// Bounds causes a frame-0 jitter. The OrbitControls `target` is left at its
// default [0,0,0]; for v1 this is correct because Bounds re-centers the view.
// Revisit in v2 if a use case arises where the authored target should override
// Bounds (e.g., a fixed look-at after an initial fit).
// ---------------------------------------------------------------------------

export default function SceneGraphRenderer({
  sceneGraph,
  assets,
  ariaLabel = "3D world viewer",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const assetsById = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, a])),
    [assets]
  );

  return (
    <WorldViewerErrorBoundary fallback={<ViewerError />}>
      {/*
       * role="img" is the closest semantic role for a non-interactive visual
       * scene. aria-label gives screen readers a meaningful description.
       */}
      <div
        ref={containerRef}
        className="relative h-full w-full bg-neutral-100 dark:bg-neutral-950"
        role="img"
        aria-label={ariaLabel}
      >
        <FullscreenButton containerRef={containerRef} />
        <Canvas
          camera={{
            position: sceneGraph.camera.position,
            fov: sceneGraph.camera.fov,
          }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          {/*
           * Suspense inside the Canvas: fallback={null} because there is no
           * React node that renders meaningfully inside a WebGL context.
           * The visible loading UI lives outside the Canvas via LoadingOverlay.
           */}
          <Suspense fallback={null}>
            {/*
             * Bounds auto-fits all child objects' bounding boxes into the
             * camera frustum at mount. margin={1.4} matches WorldViewer.
             */}
            <Bounds fit clip observe margin={1.4}>
              <SceneGraphScene
                sceneGraph={sceneGraph}
                assetsById={assetsById}
              />
            </Bounds>
          </Suspense>

          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            minDistance={0.5}
            maxDistance={50}
          />
        </Canvas>

        {/*
         * LoadingOverlay is rendered in the DOM (outside the Canvas) and reads
         * THREE.DefaultLoadingManager state via useProgress. Absolutely
         * positioned so it overlays the canvas while the GLBs are loading.
         */}
        <LoadingOverlay />
      </div>
    </WorldViewerErrorBoundary>
  );
}
