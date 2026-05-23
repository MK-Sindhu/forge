"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Bounds,
  Center,
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

/**
 * A small toggle button that requests/exits browser fullscreen on the
 * provided container element. Listens for the `fullscreenchange` event so
 * the icon stays in sync when the user presses Escape to exit.
 *
 * Positioned absolute top-right so it sits over the Canvas in both normal
 * and fullscreen modes (it's inside the same containing block in both cases).
 */
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
      // Some browsers (or iframe contexts) silently block fullscreen.
      console.warn("[WorldViewer] fullscreen toggle failed:", err);
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
        // Inward-arrows icon — signals "exit fullscreen"
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
        // Outward-arrows icon — signals "enter fullscreen"
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

export default function WorldViewer({ glbUrl, ariaLabel }: WorldViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
        aria-label={ariaLabel ?? "3D world viewer"}
      >
        <FullscreenButton containerRef={containerRef} />
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
            <Bounds fit clip observe margin={1.4}>
              <Center>
                <Model url={glbUrl} />
              </Center>
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
