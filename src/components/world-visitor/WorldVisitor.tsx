"use client";

// WorldVisitor — top-level visitor wrapper.
//
// Modes:
//   "preview" — orbit camera at the authored camera position. Shows an
//               "Enter world" CTA overlay. No pointer lock.
//   "walking" — first-person walk with PointerLockControls. WASD + mouse look.
//               ESC (or clicking the Exit button) returns to preview.
//
// Note: FullscreenButton and LoadingOverlay are duplicated from
// SceneGraphRenderer.tsx because those components are defined as private
// function declarations in that file (not exported). If they are hoisted into a
// shared utility file in a later chunk, remove the copies below and import from
// there instead.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import { WorldViewerErrorBoundary } from "@/components/world-viewer/WorldViewerErrorBoundary";
import { ViewerLoading, ViewerError } from "@/components/world-viewer/WorldViewerFallback";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import { SceneGraphScene } from "@/components/scene-graph-renderer/SceneGraphScene";
import type { Asset } from "@/components/scene-graph-renderer/SceneGraphScene";
import { PreviewMode } from "./PreviewMode";
import { WalkMode, EYE_HEIGHT, type JoystickInput } from "./WalkMode";
import { EnterWorldOverlay } from "./EnterWorldOverlay";
import { MobileJoysticks } from "./MobileJoysticks";
import { ControlsHint } from "./ControlsHint";
import { useTouchDevice } from "./use-touch-device";
import { PresenceLayer } from "./PresenceLayer";
import { ChatPanel } from "./ChatPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  sceneGraph: SceneGraphV1;
  assets: Asset[];
  ariaLabel?: string;
}

// ---------------------------------------------------------------------------
// LoadingOverlay — reads THREE.DefaultLoadingManager via useProgress (a
// zustand hook), so it can live outside the Canvas and overlay the canvas.
// Duplicated from SceneGraphRenderer.tsx — hoist if that file exports it.
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
// Duplicated from SceneGraphRenderer.tsx — hoist if that file exports it.
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
      console.warn("[WorldVisitor] fullscreen toggle failed:", err);
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
// WorldVisitor — public API
// ---------------------------------------------------------------------------

export default function WorldVisitor({
  sceneGraph,
  assets,
  ariaLabel = "3D world viewer",
}: Props) {
  const [mode, setMode] = useState<"preview" | "walking">("preview");
  const containerRef = useRef<HTMLDivElement>(null);
  const isTouchDevice = useTouchDevice();

  // ---------------------------------------------------------------------------
  // Joystick input ref — owned here so both MobileJoysticks (writer) and
  // WalkMode (reader) share the same ref without prop-drilling callbacks into
  // the Canvas. WorldVisitor creates the callbacks; MobileJoysticks writes via
  // them; WalkMode reads the raw ref every frame (no re-renders).
  // ---------------------------------------------------------------------------
  const joystickInputRef = useRef<JoystickInput>({
    leftX: 0,
    leftY: 0,
    rightX: 0,
    rightY: 0,
  });

  const handleLeftStick = (v: { x: number; y: number }) => {
    joystickInputRef.current.leftX = v.x;
    joystickInputRef.current.leftY = v.y;
  };
  const handleRightStick = (v: { x: number; y: number }) => {
    joystickInputRef.current.rightX = v.x;
    joystickInputRef.current.rightY = v.y;
  };

  // ---------------------------------------------------------------------------
  // Fullscreen keyboard shortcut — desktop walk mode only.
  //
  // Why a key (not the corner button) in walk mode: PointerLockControls
  // captures mouse input while the lock is engaged, so a corner button click
  // is unreachable. Keys still fire normally — bind F to toggle fullscreen on
  // the same container the FullscreenButton operates on.
  //
  // Gated on `mode === "walking"` so it doesn't shadow normal F-key behavior
  // (typing, browser shortcuts) outside walk mode. Skipped on touch (no
  // keyboard) — phones rely on the corner button + native browser controls.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (mode !== "walking" || isTouchDevice) return;

    function onKeyDown(e: KeyboardEvent) {
      // Don't trigger when focus is in an input (e.g., chat panel).
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key !== "f" && e.key !== "F") return;
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      if (document.fullscreenElement === el) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void el.requestFullscreen().catch((err) => {
          console.warn("[WorldVisitor] fullscreen request failed:", err);
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, isTouchDevice]);

  // Build a stable assets-by-id map.
  const assetsById = useMemo(
    () => Object.fromEntries(assets.map((a) => [a.id, a])),
    [assets]
  );

  // Compute the initial spawn point ONCE on mount.
  // Prefer the spawn with id === "default", then fall back to index 0.
  // If there are no spawn points, place the camera at a sensible default.
  const initialSpawn = useMemo((): {
    position: [number, number, number];
    rotation: [number, number, number];
  } => {
    const defaultSpawn =
      sceneGraph.spawnPoints.find((s) => s.id === "default") ??
      sceneGraph.spawnPoints[0];

    if (defaultSpawn) {
      return {
        position: defaultSpawn.position,
        rotation: defaultSpawn.rotation,
      };
    }

    // Fallback: origin at ground level (y=0); WalkMode will add EYE_HEIGHT.
    return { position: [0, 0, 5], rotation: [0, 0, 0] };
  }, [sceneGraph.spawnPoints]);

  // Initial Canvas camera: placed at spawn + eye height so the very first frame
  // is already in roughly the right place whether in preview or walk mode.
  // PreviewMode will immediately reposition to sceneGraph.camera on mount.
  const initialCameraPosition: [number, number, number] = [
    initialSpawn.position[0],
    initialSpawn.position[1] + EYE_HEIGHT,
    initialSpawn.position[2],
  ];

  return (
    <WorldViewerErrorBoundary fallback={<ViewerError />}>
      <div
        ref={containerRef}
        className="relative h-full w-full bg-neutral-100 dark:bg-neutral-950"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Fullscreen button — always visible */}
        <FullscreenButton containerRef={containerRef} />

        {/* Exit button — only in walk mode. Positioned just below the
            fullscreen button in the top-right corner.
            Desktop: calls document.exitPointerLock() → fires pointerlockchange
              → WalkMode's listener calls onExit().
            Touch: no pointer lock in play; call onExit directly.
            Larger tap target on touch (px-4 py-3) for mobile ergonomics. */}
        {mode === "walking" && (
          <button
            type="button"
            onClick={() => {
              if (isTouchDevice) {
                setMode("preview");
              } else if (document.pointerLockElement !== null) {
                document.exitPointerLock();
              } else {
                // Pointer lock already released (e.g. user tabbed out)
                setMode("preview");
              }
            }}
            aria-label="Exit walk mode"
            className={[
              "absolute right-12 top-3 z-10 rounded-md bg-black/50 font-medium text-white opacity-70 transition hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white text-xs",
              isTouchDevice ? "px-4 py-3" : "px-3 py-2",
            ].join(" ")}
          >
            Exit
          </button>
        )}

        <Canvas
          camera={{
            position: initialCameraPosition,
            fov: sceneGraph.camera.fov,
          }}
          shadows={false}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          aria-hidden="true"
        >
          {/*
           * Suspense inside the Canvas: fallback={null} because there is no
           * React node that renders meaningfully inside a WebGL context.
           * The visible loading UI lives outside the Canvas via LoadingOverlay.
           */}
          <Suspense fallback={null}>
            <SceneGraphScene
              sceneGraph={sceneGraph}
              assetsById={assetsById}
            />
            {/*
             * PresenceLayer: renders capsule avatars for all other visitors who
             * are currently in walk mode. Always mounted (preview AND walk mode)
             * so you can see other people moving around before you enter yourself.
             * PresenceLayer is pure R3F groups/meshes — no camera or controls
             * logic — so it's safe inside the same Suspense as the scene.
             */}
            <PresenceLayer />
          </Suspense>

          {mode === "preview" ? (
            <PreviewMode spawn={initialSpawn} sceneGraph={sceneGraph} />
          ) : (
            <WalkMode
              spawn={initialSpawn}
              sceneGraph={sceneGraph}
              onExit={() => setMode("preview")}
              isTouchDevice={isTouchDevice}
              joystickInputRef={joystickInputRef}
            />
          )}
        </Canvas>

        {/*
         * LoadingOverlay: positioned absolutely over the canvas, reads
         * THREE.DefaultLoadingManager state via useProgress (zustand hook,
         * callable outside the Canvas).
         */}
        <LoadingOverlay />

        {/* Enter world CTA — shown in preview mode only */}
        {mode === "preview" && (
          <EnterWorldOverlay onEnter={() => setMode("walking")} />
        )}

        {/*
         * Touch joysticks — pure DOM, MUST be outside the Canvas.
         * Only shown in walking mode on touch devices.
         * Writes into joystickInputRef; WalkMode reads it every frame.
         */}
        {mode === "walking" && isTouchDevice && (
          <MobileJoysticks
            onLeftStick={handleLeftStick}
            onRightStick={handleRightStick}
          />
        )}

        {/*
         * Controls hint banner — shown in walking mode on both desktop and
         * touch. Picks copy based on isTouchDevice. Auto-dismisses after
         * 12 seconds and persists dismissal in localStorage.
         */}
        {mode === "walking" && (
          <ControlsHint isTouchDevice={isTouchDevice} />
        )}

        {/*
         * Chat overlay — pure DOM, outside the Canvas so pointer events work.
         * Only visible in walking mode. Broadcasts + receives ephemeral
         * messages via Liveblocks. T key focuses the input; ESC blurs it.
         * The ChatPanel keyboard handler for T is defined inside ChatPanel
         * itself (not in WalkMode) to avoid editor/visitor key conflicts.
         */}
        {mode === "walking" && <ChatPanel />}
      </div>
    </WorldViewerErrorBoundary>
  );
}
