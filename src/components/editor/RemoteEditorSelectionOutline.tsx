"use client";

/**
 * RemoteEditorSelectionOutline — wireframe bounding box showing which
 * scene-graph object another editor currently has selected.
 *
 * Approach: Box3 fallback (v1)
 * ----------------------------
 * The cleanest approach would be to piggyback on 8.4's ref-registration map
 * (Map<id, Group> in Viewport) — but that map lives in Viewport's local
 * component state and isn't exposed outside the Canvas tree. Threading it to
 * this component would require a viewport context or a second Zustand slice,
 * which is more invasive than wanted for this chunk.
 *
 * Instead we use scene.traverse() to locate the asset group by
 * `userData.objectId` (added to EditorAssetMesh.tsx in this same chunk).
 * This is a one-time compute per selectedObjectId change — NOT every frame —
 * because useMemo re-runs only when `objectId` or `scene` changes.
 *
 * The wireframe is a slightly-expanded bounding box (1.02× on each axis) in
 * the remote editor's color. It's clearly distinguishable from:
 *   - The local self-selection (drei <Outlines>, cyan, solid shader)
 *   - The floor grid (zinc tones, very different visual)
 *
 * Limitations in v1:
 *   - Box3 is axis-aligned (AABB) — rotated objects get a larger box, not a
 *     tight oriented box. Acceptable for v1 UX.
 *   - If the target object hasn't loaded yet (GLB still streaming), the
 *     traverse finds no mesh with geometry and box is empty → renders nothing.
 *     This is the right behaviour — don't show a 0×0×0 box.
 *   - No animation — the box snaps to the new position whenever the remote
 *     editor drags the gizmo and broadcasts a presence update. Sub-100ms lag.
 */

import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Box3, Vector3 } from "three";

interface Props {
  objectId: string;
  color: string;  // HSL string, e.g. "hsl(214, 85%, 60%)"
}

export function RemoteEditorSelectionOutline({ objectId, color }: Props) {
  const { scene } = useThree();

  // Find the first object in the scene whose userData.objectId matches.
  // EditorAssetMesh.tsx tags its outer group with `userData={{ objectId }}`.
  // This memo re-runs when objectId changes (new selection) or scene changes
  // (objects added/removed). It does NOT run every frame — stable reference.
  const target = useMemo(() => {
    let found: import("three").Object3D | null = null;
    scene.traverse((o) => {
      if (!found && o.userData?.objectId === objectId) {
        found = o;
      }
    });
    return found;
  }, [scene, objectId]);

  if (!target) return null;

  // Compute world-aligned bounding box of the target subtree.
  const box = new Box3().setFromObject(target);

  // If the box is empty (object has no geometry yet — GLB still loading),
  // skip rendering to avoid a degenerate 0-size mesh.
  if (box.isEmpty()) return null;

  const size = new Vector3();
  const center = new Vector3();
  box.getSize(size);
  box.getCenter(center);

  // Slightly expand the box (2%) so the wireframe doesn't z-fight with the
  // object's own surface when it's a simple rectangular shape.
  return (
    <mesh
      position={[center.x, center.y, center.z]}
      userData={{ collidable: false }}
    >
      <boxGeometry args={[size.x * 1.02, size.y * 1.02, size.z * 1.02]} />
      <meshBasicMaterial
        color={color}
        wireframe
        transparent
        opacity={0.6}
        depthTest={false}
      />
    </mesh>
  );
}
