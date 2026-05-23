"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Bounds,
  useGLTF,
  Environment,
  useProgress,
} from "@react-three/drei";
import { WorldViewerErrorBoundary } from "./WorldViewerErrorBoundary";
import { ViewerLoading, ViewerError } from "./WorldViewerFallback";

interface WorldViewerProps {
  glbUrl: string;
  /**
   * Optional human-readable description for screen readers.
   * Defaults to "3D world viewer" if not provided.
   */
  ariaLabel?: string;
}

/**
 * Renders inside the Canvas. Loads the GLB via useGLTF (which suspends
 * until the file is ready) and attaches the parsed scene graph.
 * `primitive` accepts `object: object` per R3F's ThreeElements definition,
 * so THREE.Group / THREE.Scene from useGLTF satisfies the type directly.
 */
function Model({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

/**
 * Reads THREE.DefaultLoadingManager progress via drei's useProgress zustand
 * store. Because it's a zustand hook (not an R3F hook), it can be called
 * outside the Canvas. We render the overlay only while a load is active so
 * it disappears cleanly once the GLB finishes.
 */
function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <ViewerLoading />;
}

export default function WorldViewer({ glbUrl, ariaLabel }: WorldViewerProps) {
  return (
    <WorldViewerErrorBoundary fallback={<ViewerError />}>
      {/*
       * role="img" is the closest semantic role for a non-interactive visual
       * scene. aria-label gives screen readers a meaningful description.
       */}
      <div
        className="relative h-full w-full bg-neutral-100 dark:bg-neutral-950"
        role="img"
        aria-label={ariaLabel ?? "3D world viewer"}
      >
        <Canvas
          camera={{ position: [3, 3, 5], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          {/* Static lighting: ambient fill + key directional light */}
          <ambientLight intensity={0.5} />
          <directionalLight position={[5, 5, 5]} intensity={1} />

          {/*
           * Suspense inside the Canvas uses fallback={null} — there is no
           * React node that meaningfully renders inside a WebGL context.
           * The loading UI lives outside the Canvas via LoadingOverlay below.
           */}
          <Suspense fallback={null}>
            {/* IBL from drei's built-in studio preset */}
            <Environment preset="studio" />
            {/*
             * Bounds fits the camera to the loaded model's bounding box.
             * fit + clip + observe keep it updated if the scene graph changes.
             * margin={1.2} adds breathing room so the model isn't flush against
             * the frustum edges.
             */}
            <Bounds fit clip observe margin={1.2}>
              <Model url={glbUrl} />
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
         * LoadingOverlay is rendered in the DOM (outside the Canvas) and
         * reads THREE.DefaultLoadingManager state via useProgress. It is
         * absolutely positioned so it overlays the Canvas while active.
         */}
        <LoadingOverlay />
      </div>
    </WorldViewerErrorBoundary>
  );
}
