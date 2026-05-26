"use client";

/**
 * Viewport — the live Three.js canvas for the in-browser world editor.
 *
 * Responsibilities:
 *  - Render scene-graph lights, environment, fog, and objects reactively
 *    from the Zustand editor store.
 *  - TransformControls gizmo on the selected object (attach via ref map).
 *  - OrbitControls camera (disabled while dragging a gizmo to avoid fighting).
 *  - Click-to-select (on objects) + click-to-deselect (on empty canvas area).
 *  - Delete / Backspace shortcut to delete the selected object.
 *  - Floor grid so the editor feels like a real 3D tool.
 *
 * What this does NOT do (intentionally):
 *  - Bounds auto-fit — correct for read-only viewer but wrong for editor
 *    (would jump camera on every add/move). Manual orbit is the right UX.
 *  - Persist camera position back to the scene graph — camera in the scene
 *    graph is the DEFAULT view; runtime orbit is ephemeral (matches Blender /
 *    Unity editor UX).
 *  - Shadows — marked lower priority in the spec; omitted to keep complexity low.
 *
 * Ref registration pattern (how TransformControls attaches):
 *  A Map<string, Group> is held in a useRef inside this component.
 *  Each EditorAssetMesh calls onRefChange(id, groupRef) on mount and
 *  onRefChange(id, null) on unmount. When selectedObjectId changes, the
 *  viewport reads the map to find the matching Three.js Object3D and passes
 *  it to <TransformControls object={...} />.
 *
 * Drag lifecycle (one op per drag, not 60fps × every frame):
 *  1. TransformControls fires dragging-changed {value: true}  → disable OrbitControls.
 *  2. TransformControls fires dragging-changed {value: false} → re-enable OrbitControls,
 *     read final position/rotation/scale from the group ref, dispatch updateObject().
 *  This creates exactly one op per drag, which is what the undo stack and
 *  autosave want.
 */

import { useRef, useEffect, useCallback, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  TransformControls,
  Environment,
  Grid,
  useProgress,
} from "@react-three/drei";
import { useEditorStore } from "../editor-store";
import { EditorAssetMesh } from "../EditorAssetMesh";
import { useEditorPresence } from "../use-editor-presence";
import { EditorPresenceLayer } from "../EditorPresenceLayer";
import { ViewerLoading } from "@/components/world-viewer/WorldViewerFallback";
import type { Group, Object3D } from "three";
import type { Asset } from "../EditorAssetMesh";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  assets: Asset[];
}

// ---------------------------------------------------------------------------
// LoadingOverlay — outside the Canvas, reads THREE.DefaultLoadingManager
// ---------------------------------------------------------------------------

function LoadingOverlay() {
  const { active } = useProgress();
  if (!active) return null;
  return <ViewerLoading />;
}

// ---------------------------------------------------------------------------
// EditorPresenceWiring — zero-render wrapper that calls useEditorPresence().
//
// A hook cannot be called directly in SceneContent's JSX without being inside
// a component. Wrapping it here makes mounting/unmounting clean — the parent
// can conditionally exclude this component (e.g., future "focus mode") without
// changing SceneContent.
// ---------------------------------------------------------------------------

function EditorPresenceWiring() {
  useEditorPresence();
  return null;
}

// ---------------------------------------------------------------------------
// SceneContent — everything rendered inside the Canvas Suspense boundary.
//
// Split out so we can use useThree (only valid inside Canvas). Also keeps the
// JSX tree cleaner since all Three.js hooks must be in a Canvas child.
// ---------------------------------------------------------------------------

function SceneContent({
  assets,
  refMap,
  orbitRef,
  transformRef,
}: {
  assets: Asset[];
  refMap: React.MutableRefObject<Map<string, Group>>;
  orbitRef: React.RefObject<OrbitControlsImpl | null>;
  transformRef: React.RefObject<TransformControlsImpl | null>;
}) {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const gizmoMode = useEditorStore((s) => s.gizmoMode);
  const selectObject = useEditorStore((s) => s.selectObject);
  const updateObject = useEditorStore((s) => s.updateObject);

  // Find the Object3D for the currently-selected object (may be undefined while
  // the component hasn't mounted yet or the selection just cleared).
  const selectedObject: Object3D | null = selectedObjectId
    ? (refMap.current.get(selectedObjectId) ?? null)
    : null;

  // Stable callback passed to each EditorAssetMesh to register / unregister refs.
  const handleRefChange = useCallback(
    (id: string, ref: Group | null) => {
      if (ref) {
        refMap.current.set(id, ref);
      } else {
        refMap.current.delete(id);
      }
    },
    [refMap]
  );

  // Empty-click handler: deselects when the user clicks a clear area of canvas.
  // We attach onClick to a large invisible plane at the floor so R3F's raycaster
  // can fire the event consistently. onClick only fires here when no object mesh
  // stops propagation first (child meshes call e.stopPropagation()).
  function handleFloorClick() {
    selectObject(null);
  }

  return (
    <>
      {/* ----- Lights ----- */}
      {sceneGraph.lights.map((light, i) => {
        if (light.type === "ambient") {
          return (
            <ambientLight
              key={`light-${i}`}
              intensity={light.intensity}
              color={light.color}
            />
          );
        }
        if (light.type === "sun") {
          return (
            <directionalLight
              key={`light-${i}`}
              intensity={light.intensity}
              position={light.direction}
              color={light.color}
            />
          );
        }
        return null;
      })}

      {/* ----- Environment (IBL skybox) ----- */}
      {sceneGraph.environment.skybox && (
        <Environment preset={sceneGraph.environment.skybox} />
      )}

      {/* ----- Fog ----- */}
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

      {/* ----- Floor grid ----- */}
      <Grid
        args={[80, 80]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#3f3f46"      // zinc-700
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#52525b"   // zinc-600
        fadeDistance={40}
        fadeStrength={1}
        infiniteGrid
        position={[0, -0.001, 0]} // slightly below y=0 so objects sit on it cleanly
      />

      {/* ----- Invisible deselect plane ----- */}
      {/*
       * Large flat mesh at y=0. onClick fires when the user clicks empty space
       * (object meshes stop propagation, so this only triggers on miss).
       * The mesh is invisible (no material rendered) but still raycast-able.
       */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.002, 0]}
        onClick={handleFloorClick}
      >
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* ----- Scene graph objects ----- */}
      {sceneGraph.objects.map((obj) => (
        <EditorAssetMesh
          key={obj.id}
          object={obj}
          assets={assets}
          onRefChange={handleRefChange}
        />
      ))}

      {/* ----- Transform gizmo ----- */}
      {selectedObjectId !== null && selectedObject !== null && (
        <TransformControls
          ref={transformRef}
          object={selectedObject}
          mode={gizmoMode}
          onMouseDown={() => {
            // Disable orbit while dragging so pan/rotate don't fight the gizmo
            if (orbitRef.current) orbitRef.current.enabled = false;
          }}
          onMouseUp={() => {
            // Re-enable orbit when drag ends
            if (orbitRef.current) orbitRef.current.enabled = true;

            // Read final transform from the group and emit exactly one op
            const group = refMap.current.get(selectedObjectId);
            if (!group) return;

            const p = group.position;
            const r = group.rotation;
            const s = group.scale;

            updateObject(selectedObjectId, {
              position: [p.x, p.y, p.z],
              rotation: [r.x, r.y, r.z],
              scale: [s.x, s.y, s.z],
            });
          }}
        />
      )}

      {/* ----- Camera + orbit ----- */}
      <OrbitControls
        ref={orbitRef}
        enableDamping
        dampingFactor={0.05}
        minDistance={0.5}
        maxDistance={500}
        // target from scene graph camera — where the camera looks at by default
        target={sceneGraph.camera.target}
      />

      {/* ----- Editor presence (Slice 10.1) ----- */}
      {/* Broadcasts local cursor + selection + gizmo mode to Liveblocks ~10x/sec */}
      <EditorPresenceWiring />
      {/* Renders remote editors' cursor spheres + selection outlines */}
      <EditorPresenceLayer />
    </>
  );
}

// ---------------------------------------------------------------------------
// Viewport — public component
// ---------------------------------------------------------------------------

export function Viewport({ assets }: Props) {
  const sceneGraph = useEditorStore((s) => s.sceneGraph);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);
  const deleteSelectedObject = useEditorStore((s) => s.deleteSelectedObject);

  // Map from object id → Group ref, maintained by each EditorAssetMesh.
  // Stored in a ref (not state) — mutations don't need to trigger re-renders;
  // TransformControls reads the current value imperatively on selection change.
  const refMap = useRef<Map<string, Group>>(new Map());

  const orbitRef = useRef<OrbitControlsImpl>(null);
  const transformRef = useRef<TransformControlsImpl>(null);

  // ----- Delete shortcut -----
  // Handles Delete and Backspace when focus is not in a text input.
  // T / R / S / Escape / Cmd+Z are already handled by EditorTopBar; we only
  // add Delete here to avoid duplicating the other shortcuts.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!selectedObjectId) return;

      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelectedObject();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedObjectId, deleteSelectedObject]);

  return (
    <div
      className="flex-1 relative bg-zinc-900"
      role="application"
      aria-label="3D viewport — orbit: left-drag, zoom: scroll, pan: right-drag"
    >
      <Canvas
        camera={{
          position: sceneGraph.camera.position,
          fov: sceneGraph.camera.fov,
        }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Suspense fallback={null}>
          <SceneContent
            assets={assets}
            refMap={refMap}
            orbitRef={orbitRef}
            transformRef={transformRef}
          />
        </Suspense>
      </Canvas>

      {/* Loading overlay — reads THREE.DefaultLoadingManager outside the Canvas */}
      <LoadingOverlay />

      {/* Keyboard hints — shown as a subtle overlay at bottom of canvas */}
      <div
        className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-3 text-[10px] text-zinc-500"
        aria-hidden="true"
      >
        <span>Orbit: drag</span>
        <span>Zoom: scroll</span>
        <span>Pan: right-drag</span>
        <span>Select: click</span>
        <span>Delete: Del</span>
        <span>T / R / S: gizmo mode</span>
      </div>
    </div>
  );
}
