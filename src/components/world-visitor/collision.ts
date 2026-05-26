import { Vector3, Raycaster, Scene } from "three";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How close to a wall the player can get (camera units). */
export const SKIN_WIDTH = 0.3;

/** How far below the camera origin to look for a floor. */
export const FLOOR_PROBE_DISTANCE = 5;

// ---------------------------------------------------------------------------
// CollisionInput — inputs to applyCollision for one frame.
// ---------------------------------------------------------------------------

export interface CollisionInput {
  /** The Three.js scene to raycast against. */
  scene: Scene;
  /**
   * Raycaster instance — provided by the caller (allocated once in WalkMode).
   * applyCollision mutates `.set()` and `.far` on this object.
   */
  raycaster: Raycaster;
  /** Current camera position (head, eye height above floor). */
  currentPos: Vector3;
  /** Desired world-space movement delta from computeMovement (Y should be 0). */
  desiredDelta: Vector3;
  /** Distance from the floor to the camera (eye) position. Typically 1.6 units. */
  eyeHeight: number;
}

// ---------------------------------------------------------------------------
// applyCollision — pure collision resolver.
//
// Takes a desired movement vector + scene reference, and returns the safe next
// camera position after:
//   1. Wall-slide: project movement onto the wall plane if a wall is ahead.
//   2. Floor-snap: raycast downward and snap camera Y to (hitY + eyeHeight).
//
// Side-effect-free EXCEPT for the Raycaster (its .set() and .far are updated).
// Tests supply a fresh Raycaster so there is no cross-call state leakage.
//
// Collidable filter: meshes are considered solid unless they explicitly set
//   mesh.userData.collidable = false
// This allows trigger zones / invisible helper objects to be skipped.
// ---------------------------------------------------------------------------

export function applyCollision(input: CollisionInput): Vector3 {
  const { scene, raycaster, currentPos, desiredDelta, eyeHeight } = input;

  // -------------------------------------------------------------------------
  // Step 1 — Wall check
  // -------------------------------------------------------------------------

  // Work with only the horizontal (XZ) component of the desired delta.
  const horizontal = new Vector3(desiredDelta.x, 0, desiredDelta.z);

  if (horizontal.lengthSq() > 0) {
    const dir = horizontal.clone().normalize();
    raycaster.set(currentPos, dir);
    // Cast far enough to detect any geometry within the movement range + skin.
    raycaster.far = horizontal.length() + SKIN_WIDTH;

    const hits = raycaster
      .intersectObjects(scene.children, true)
      .filter((h) => h.object.userData?.collidable !== false);

    if (hits.length > 0) {
      const hit = hits[0];
      const face = hit.face;

      if (!face) {
        // Defensive: no face normal available — zero out movement entirely.
        horizontal.set(0, 0, 0);
      } else {
        // Transform the face normal from local mesh space to world space.
        // applyMatrix4 on a direction vector needs the normal matrix, but for
        // uniform-scale meshes (which cover the vast majority of FORGE worlds)
        // using the object's matrixWorld and then re-normalizing is correct.
        // If non-uniform scaling causes issues, switch to normalMatrix.
        const worldNormal = face.normal
          .clone()
          .applyMatrix4(hit.object.matrixWorld)
          .normalize();

        // Wall-slide: remove the component of movement that points into the wall.
        // dot < 0 means we are moving toward the wall.
        const dot = horizontal.dot(worldNormal);
        if (dot < 0) {
          // Project out the wall-normal component: slide along the wall plane.
          horizontal.sub(worldNormal.clone().multiplyScalar(dot));
        }
        // dot >= 0 means we are already moving away from the wall (shouldn't
        // happen given raycaster direction, but guard anyway).
      }
    }
  }

  // Candidate next position after wall slide — Y stays at currentPos.y for now.
  const nextPos = currentPos.clone().add(new Vector3(horizontal.x, 0, horizontal.z));

  // -------------------------------------------------------------------------
  // Step 2 — Floor snap
  // -------------------------------------------------------------------------

  // Raycast straight down from just above the candidate XZ position.
  // Origin is at head height so we look down through the full eye height + probe.
  const downOrigin = new Vector3(nextPos.x, currentPos.y, nextPos.z);
  raycaster.set(downOrigin, new Vector3(0, -1, 0));
  raycaster.far = eyeHeight + FLOOR_PROBE_DISTANCE;

  const floorHits = raycaster
    .intersectObjects(scene.children, true)
    .filter((h) => h.object.userData?.collidable !== false);

  if (floorHits.length > 0) {
    // Snap Y so the camera sits exactly eyeHeight above the hit surface.
    // This handles both snapping down (walking down stairs) and snapping up
    // (walking up ramps or over small bumps).
    nextPos.y = floorHits[0].point.y + eyeHeight;
  }
  // No floor hit → keep current Y (mid-air; gravity is a future phase concern).

  return nextPos;
}
