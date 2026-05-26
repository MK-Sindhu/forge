/**
 * Unit tests for the computeEditorPresence() pure helper.
 *
 * The helper lives in use-editor-presence.ts and is separated from the React
 * hook wrapper precisely so it can be tested without WebGL or a Canvas
 * environment.  Real Three.js instances work fine in Vitest's node environment
 * — they do only math (no GPU calls).
 *
 * Test strategy:
 *  - Create real THREE.PerspectiveCamera, THREE.Scene, THREE.Raycaster.
 *  - Place meshes at known world positions.
 *  - Assert cursorWorldPos / selectedObjectId / gizmoMode / mode on the
 *    returned EditorPresence.
 *
 * No mocks are needed for Three.js itself.  The only external boundary mocked
 * is nothing — this module has zero external I/O.
 */

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { computeEditorPresence } from "./use-editor-presence";

// ---------------------------------------------------------------------------
// Scene setup helpers
// ---------------------------------------------------------------------------

/** Build a camera looking down the -Z axis from (0, 0, 5). */
function makeCamera(): THREE.PerspectiveCamera {
  // fov=75, aspect=1, near=0.1, far=100
  const cam = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  cam.position.set(0, 0, 5);
  cam.updateMatrixWorld(true);
  return cam;
}

/** Build a collidable unit-box mesh at the given position. */
function makeCollidableMesh(
  position: [number, number, number]
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(...position);
  mesh.updateMatrixWorld(true);
  // Default: no userData.collidable flag = treated as collidable (filter keeps
  // it because `userData.collidable !== false` is true when the key is absent).
  return mesh;
}

// NDC origin — the centre of the canvas, pointing straight at the -Z axis
// from our camera at (0,0,5).
const CENTER_POINTER = { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeEditorPresence — happy path: pointer over a collidable mesh", () => {
  it("returns non-null cursorWorldPos matching the raycast hit point", () => {
    const camera = makeCamera();
    const scene = new THREE.Scene();
    const raycaster = new THREE.Raycaster();

    // Place a box at the origin — the ray from (0,0,5) along -Z will hit it.
    const mesh = makeCollidableMesh([0, 0, 0]);
    scene.add(mesh);

    const result = computeEditorPresence({
      pointer: CENTER_POINTER,
      camera,
      scene,
      raycaster,
      selectedObjectId: null,
      gizmoMode: "translate",
    });

    expect(result.mode).toBe("editor");
    // The ray from (0,0,5) toward -Z hits the front face of a box at z=0.
    // The box is 1 unit deep; its front face is at z=0.5.
    expect(result.cursorWorldPos).not.toBeNull();
    // cursorWorldPos should be close to (0, 0, 0.5) — front face of the box.
    const [x, y, z] = result.cursorWorldPos!;
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(0, 3);
    // z should be ~0.5 (front face) — a positive value less than 5
    expect(z).toBeGreaterThan(0);
    expect(z).toBeLessThan(5);
  });
});

describe("computeEditorPresence — no hit: empty scene", () => {
  it("returns cursorWorldPos=null when no mesh is in the scene", () => {
    const camera = makeCamera();
    const scene = new THREE.Scene();
    const raycaster = new THREE.Raycaster();

    const result = computeEditorPresence({
      pointer: CENTER_POINTER,
      camera,
      scene,
      raycaster,
      selectedObjectId: null,
      gizmoMode: "translate",
    });

    expect(result.mode).toBe("editor");
    expect(result.cursorWorldPos).toBeNull();
  });
});

describe("computeEditorPresence — non-collidable mesh filtered", () => {
  it("returns cursorWorldPos=null when the only intersected mesh has userData.collidable=false", () => {
    const camera = makeCamera();
    const scene = new THREE.Scene();
    const raycaster = new THREE.Raycaster();

    // Place a mesh in the ray's path but mark it non-collidable.
    const mesh = makeCollidableMesh([0, 0, 0]);
    mesh.userData.collidable = false;
    scene.add(mesh);

    const result = computeEditorPresence({
      pointer: CENTER_POINTER,
      camera,
      scene,
      raycaster,
      selectedObjectId: null,
      gizmoMode: "translate",
    });

    expect(result.mode).toBe("editor");
    // The ray would have hit the mesh, but the filter discards it.
    expect(result.cursorWorldPos).toBeNull();
  });
});

describe("computeEditorPresence — selectedObjectId and gizmoMode passthrough", () => {
  it("reflects selectedObjectId + gizmoMode from the store on the returned presence", () => {
    const camera = makeCamera();
    const scene = new THREE.Scene();
    const raycaster = new THREE.Raycaster();
    // Scene is empty — cursorWorldPos will be null, but we just care about
    // the passthrough fields.

    const result = computeEditorPresence({
      pointer: CENTER_POINTER,
      camera,
      scene,
      raycaster,
      selectedObjectId: "obj_X",
      gizmoMode: "rotate",
    });

    expect(result.mode).toBe("editor");
    expect(result.selectedObjectId).toBe("obj_X");
    expect(result.gizmoMode).toBe("rotate");
    // cursorWorldPos is null because scene is empty — that's fine here.
    expect(result.cursorWorldPos).toBeNull();
  });
});
