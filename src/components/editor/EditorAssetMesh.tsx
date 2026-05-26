"use client";

/**
 * EditorAssetMesh — renders one scene-graph object in the editor viewport.
 *
 * Responsibilities:
 *  - Find the asset record matching the object's assetId.
 *  - Load the asset's GLB via useGLTF (Suspense-based).
 *  - Clone the scene so each instance is transform-independent.
 *  - Apply the object's position / rotation / scale to the wrapping group.
 *  - Fire selectObject() on click, stopping event propagation so the
 *    canvas-level empty-click handler doesn't also fire.
 *  - Show a selection highlight (drei Outlines) when this object is selected.
 *  - Register the group ref in the shared refMap so TransformControls can
 *    attach to it in Viewport.tsx.
 *  - Render a red wireframe fallback cube when the asset record is missing.
 */

import { useRef, useEffect, useMemo } from "react";
import { useGLTF, Outlines } from "@react-three/drei";
import { useEditorStore } from "./editor-store";
import type { Group } from "three";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Asset {
  id: string;
  name: string;
  glbUrl: string;
  sizeBytes: number | null;
}

export interface SceneGraphObject {
  id: string;
  assetId: string;
  name?: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

interface Props {
  object: SceneGraphObject;
  assets: Asset[];
  /** Called on mount with (id, groupRef) and on unmount with (id, null). */
  onRefChange: (id: string, ref: Group | null) => void;
}

// ---------------------------------------------------------------------------
// Sub-component: loaded GLB instance
//
// Separated from EditorAssetMesh so that useGLTF (which Suspends) is ONLY
// called when we have a valid glbUrl — the parent handles the missing-asset
// fallback without entering a Suspense boundary.
// ---------------------------------------------------------------------------

function LoadedMesh({
  glbUrl,
  isSelected,
}: {
  glbUrl: string;
  isSelected: boolean;
}) {
  const { scene } = useGLTF(glbUrl);
  // Clone so each placed instance gets its own transform-independent tree.
  // scene.clone(true) is safe for non-skinned GLBs (v1 doesn't support skinned
  // animations). If skinned mesh support lands, switch to SkeletonUtils.clone.
  const cloned = useMemo(() => scene.clone(true), [scene]);

  return (
    <>
      <primitive object={cloned} />
      {isSelected && (
        <Outlines
          thickness={0.025}
          color="#22d3ee" // cyan-400 — visible against dark bg
          screenspace={false}
          opacity={1}
          transparent={false}
          toneMapped={false}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// EditorAssetMesh — public component
// ---------------------------------------------------------------------------

export function EditorAssetMesh({ object, assets, onRefChange }: Props) {
  const groupRef = useRef<Group>(null);
  const isSelected = useEditorStore((s) => s.selectedObjectId === object.id);
  const selectObject = useEditorStore((s) => s.selectObject);

  // Register this group's ref in the viewport's shared Map so
  // TransformControls can attach to the correct Object3D when selection changes.
  useEffect(() => {
    const el = groupRef.current;
    if (el) {
      onRefChange(object.id, el);
    }
    return () => {
      onRefChange(object.id, null);
    };
    // object.id is stable for the lifetime of this component instance
  }, [object.id, onRefChange]);

  const asset = assets.find((a) => a.id === object.assetId);

  // Missing-asset fallback: render a visible error cube so the world still
  // makes sense and the user knows something is wrong.
  if (!asset) {
    console.warn(
      `[EditorAssetMesh] Asset not found for object ${object.id}: assetId=${object.assetId}`
    );
    return (
      <group
        ref={groupRef}
        name={object.id}
        position={object.position}
        rotation={object.rotation}
        scale={object.scale}
        // userData.objectId: lets EditorPresenceLayer (Slice 10.1) find this
        // group by scene traversal for remote-selection outlines.
        // userData.collidable: not set here (defaults to undefined = collidable)
        // so the missing-asset cube still participates in raycasts.
        userData={{ objectId: object.id }}
        onClick={(e) => {
          e.stopPropagation();
          selectObject(object.id);
        }}
      >
        <mesh>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color="#ef4444" wireframe />
        </mesh>
        {isSelected && (
          <Outlines
            thickness={0.025}
            color="#22d3ee"
            screenspace={false}
            opacity={1}
            transparent={false}
            toneMapped={false}
          />
        )}
      </group>
    );
  }

  return (
    <group
      ref={groupRef}
      name={object.id}
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      // userData.objectId: lets EditorPresenceLayer (Slice 10.1) find this
      // group by scene traversal for remote-selection outlines.
      userData={{ objectId: object.id }}
      onClick={(e) => {
        e.stopPropagation();
        selectObject(object.id);
      }}
    >
      {/*
       * LoadedMesh is a Suspense-capable sub-component. The outer <Suspense>
       * in Viewport.tsx catches the suspension here, showing the global
       * loading overlay rather than crashing the canvas.
       */}
      <LoadedMesh glbUrl={asset.glbUrl} isSelected={isSelected} />
    </group>
  );
}
