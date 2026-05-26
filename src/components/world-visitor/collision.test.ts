import { describe, it, expect, vi } from "vitest";
import { Vector3, Raycaster, Scene, Matrix4 } from "three";
import { applyCollision } from "./collision";

// ---------------------------------------------------------------------------
// No Clerk / DB / R2 mocks needed — applyCollision is a pure function.
// The only external boundary is raycaster.intersectObjects, which we mock
// to control what "the scene" reports back without needing a real WebGL Scene.
//
// Mock rationale:
//   - A real Three.js Scene requires geometry + a WebGL renderer context.
//     Vitest runs in Node (env: "node") — no WebGL available.
//   - We mock raycaster.intersectObjects (the raycaster's external boundary)
//     so tests exercise applyCollision's logic: slide projection, floor snap,
//     collidable filter, and defensive null-face handling.
//   - matrixWorld set to identity Matrix4 so face.normal passes through
//     applyMatrix4 unchanged (no coordinate system transforms to reason about).
// ---------------------------------------------------------------------------

type FakeIntersection = {
  object: { userData?: { collidable?: boolean }; matrixWorld: Matrix4 };
  face?: { normal: Vector3 } | null;
  point: Vector3;
  distance: number;
};

function makeMockScene(children: object[] = []) {
  return { children } as unknown as Scene;
}

function makeMockRaycasterTwoCalls(
  wallIntersections: FakeIntersection[],
  floorIntersections: FakeIntersection[]
) {
  const raycaster = new Raycaster();
  raycaster.intersectObjects = vi
    .fn()
    .mockReturnValueOnce(wallIntersections)
    .mockReturnValueOnce(floorIntersections);
  return raycaster;
}

function identityMatrix(): Matrix4 {
  return new Matrix4(); // identity by default
}

// ---------------------------------------------------------------------------

describe("applyCollision — no obstacles", () => {
  it("returns currentPos + desiredDelta (X+1) with Y unchanged when no hits", () => {
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([], []);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 1.6, 0),
      desiredDelta: new Vector3(1, 0, 0),
      eyeHeight: 1.6,
    });
    expect(result.x).toBeCloseTo(1);
    // No floor hit — Y stays at currentPos.y
    expect(result.y).toBeCloseTo(1.6);
    expect(result.z).toBeCloseTo(0);
  });
});

describe("applyCollision — wall blocks perpendicular movement", () => {
  it("zeroes the X component when moving directly into a +X-facing wall", () => {
    // Wall at +X side, normal facing -X (toward the player moving in +X)
    // dot = (1,0,0) · (-1,0,0) = -1 < 0 → slide removes X component entirely
    const wallHit: FakeIntersection = {
      object: { userData: { collidable: true }, matrixWorld: identityMatrix() },
      face: { normal: new Vector3(-1, 0, 0) },
      point: new Vector3(0.8, 1.6, 0),
      distance: 0.5,
    };
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([wallHit], []);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 1.6, 0),
      desiredDelta: new Vector3(1, 0, 0),
      eyeHeight: 1.6,
    });
    // Movement is purely perpendicular to the wall — full slide removes it
    expect(result.x).toBeCloseTo(0);
    // Y unchanged (no floor hit)
    expect(result.y).toBeCloseTo(1.6);
    expect(result.z).toBeCloseTo(0);
  });
});

describe("applyCollision — wall slide at oblique angle", () => {
  it("zeroes the X component and preserves Z when moving at 45° into a +X wall", () => {
    // desiredDelta = (1, 0, 1): 45° angle toward +X wall (normal = -X)
    // dot = (1,0,1).normalize() · (-1,0,0)
    // slide removes only the X-into-wall component; Z survives
    const wallHit: FakeIntersection = {
      object: { userData: { collidable: true }, matrixWorld: identityMatrix() },
      face: { normal: new Vector3(-1, 0, 0) },
      point: new Vector3(0.8, 1.6, 0),
      distance: 0.5,
    };
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([wallHit], []);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 1.6, 0),
      desiredDelta: new Vector3(1, 0, 1),
      eyeHeight: 1.6,
    });
    // X component (into wall) is zeroed by slide
    expect(result.x).toBeCloseTo(0);
    // Z component is preserved
    expect(result.z).toBeCloseTo(1);
    // Y unchanged (no floor hit)
    expect(result.y).toBeCloseTo(1.6);
  });
});

describe("applyCollision — floor snap", () => {
  it("snaps Y to (floor.point.y + eyeHeight) when a floor hit is found", () => {
    // Floor hit at y=0.5; eyeHeight=1.6 → expected Y = 0.5 + 1.6 = 2.1
    const floorHit: FakeIntersection = {
      object: { userData: { collidable: true }, matrixWorld: identityMatrix() },
      face: { normal: new Vector3(0, 1, 0) },
      point: new Vector3(0, 0.5, 0),
      distance: 1.1,
    };
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([], [floorHit]);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 1.6, 0),
      desiredDelta: new Vector3(1, 0, 0),
      eyeHeight: 1.6,
    });
    expect(result.y).toBeCloseTo(0.5 + 1.6); // 2.1
  });
});

describe("applyCollision — invisible mesh ignored", () => {
  it("treats collidable=false mesh as non-solid (free movement)", () => {
    // This hit would block movement if collidable=true, but it's explicitly false
    const ghostHit: FakeIntersection = {
      object: {
        userData: { collidable: false },
        matrixWorld: identityMatrix(),
      },
      face: { normal: new Vector3(-1, 0, 0) },
      point: new Vector3(0.3, 1.6, 0),
      distance: 0.3,
    };
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([ghostHit], []);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 1.6, 0),
      desiredDelta: new Vector3(1, 0, 0),
      eyeHeight: 1.6,
    });
    // Ghost mesh filtered out → no slide → X advances freely
    expect(result.x).toBeCloseTo(1);
    expect(result.y).toBeCloseTo(1.6);
    expect(result.z).toBeCloseTo(0);
  });
});

describe("applyCollision — no floor hit", () => {
  it("preserves currentPos.y when no floor hit (no levitation or drop)", () => {
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([], []);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 5, 0),
      desiredDelta: new Vector3(1, 0, 0),
      eyeHeight: 1.6,
    });
    expect(result.y).toBeCloseTo(5);
  });
});

describe("applyCollision — null face normal (defensive)", () => {
  it("zeroes movement entirely when wall hit has face: null", () => {
    // Per implementation: "Defensive: no face normal available — zero out movement entirely."
    const nullFaceHit: FakeIntersection = {
      object: { userData: { collidable: true }, matrixWorld: identityMatrix() },
      face: null,
      point: new Vector3(0.3, 1.6, 0),
      distance: 0.3,
    };
    const scene = makeMockScene();
    const raycaster = makeMockRaycasterTwoCalls([nullFaceHit], []);
    const result = applyCollision({
      scene,
      raycaster,
      currentPos: new Vector3(0, 1.6, 0),
      desiredDelta: new Vector3(1, 0, 0),
      eyeHeight: 1.6,
    });
    // horizontal zeroed defensively → X movement is 0
    expect(result.x).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
    // Y still from currentPos (no floor hit)
    expect(result.y).toBeCloseTo(1.6);
  });
});
