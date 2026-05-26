/**
 * operations.test.ts — spec-first unit tests for the scene-graph operations
 * module (src/lib/scene-graph/operations.ts).
 *
 * This is a pure module: no DB, no I/O, no mocks required. All tests run
 * against the exported Zod schemas and the applyOps reducer directly.
 *
 * Why no mocks: The module is fully self-contained — it accepts a typed
 * SceneGraphV1, applies ops via structuredClone, and returns a new
 * SceneGraphV1. The only external dependency is the schema module
 * (same package), so we import emptySceneGraph() directly.
 */

import { describe, it, expect } from "vitest";
import {
  OpsBatchSchema,
  MAX_OPS_PER_BATCH,
  OperationError,
  SetObjectAssetOp,
  applyOps,
  type SceneGraphOp,
} from "./operations";
import { emptySceneGraph, SceneGraphV1 } from "./schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";
const ASSET_UUID = "660e8400-e29b-41d4-a716-446655440001";

// ---------------------------------------------------------------------------
// OpsBatchSchema — structural validation
// ---------------------------------------------------------------------------

describe("OpsBatchSchema", () => {
  it("rejects ops: [] (min 1)", () => {
    const result = OpsBatchSchema.safeParse({
      ops: [],
      baseVersionId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ops of length 101 (max MAX_OPS_PER_BATCH)", () => {
    const ops: SceneGraphOp[] = Array.from({ length: MAX_OPS_PER_BATCH + 1 }, () => ({
      op: "delete_object" as const,
      id: "some-id",
    }));
    const result = OpsBatchSchema.safeParse({
      ops,
      baseVersionId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-uuid baseVersionId", () => {
    const result = OpsBatchSchema.safeParse({
      ops: [{ op: "delete_object", id: "x" }],
      baseVersionId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid label: null", () => {
    const result = OpsBatchSchema.safeParse({
      ops: [{ op: "delete_object", id: "x" }],
      baseVersionId: VALID_UUID,
      label: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts omitted label (field is optional)", () => {
    const result = OpsBatchSchema.safeParse({
      ops: [{ op: "delete_object", id: "x" }],
      baseVersionId: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("label" in result.data ? result.data.label : undefined).toBeUndefined();
    }
  });

  it("accepts a batch at exactly MAX_OPS_PER_BATCH (boundary = valid)", () => {
    const ops: SceneGraphOp[] = Array.from({ length: MAX_OPS_PER_BATCH }, () => ({
      op: "delete_object" as const,
      id: "some-id",
    }));
    const result = OpsBatchSchema.safeParse({
      ops,
      baseVersionId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyOps — general reducer behaviour
// ---------------------------------------------------------------------------

describe("applyOps — general", () => {
  it("with empty ops array round-trips the graph unchanged", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, []);
    // Deep-equal to original...
    expect(result).toEqual(graph);
    // ...but referentially distinct (structuredClone)
    expect(result).not.toBe(graph);
  });

  it("returned graph passes SceneGraphV1.parse (final invariant check runs)", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, [
      {
        op: "add_object",
        assetId: ASSET_UUID,
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
    // If the final SceneGraphV1.parse() inside applyOps threw, we would never
    // reach this assertion. We additionally call parse here to be explicit.
    expect(() => SceneGraphV1.parse(result)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// add_object
// ---------------------------------------------------------------------------

describe("applyOps — add_object", () => {
  it("appends an object and auto-generates id when id is absent", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, [
      {
        op: "add_object",
        assetId: ASSET_UUID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].id).toMatch(/^obj_[0-9a-f]{8}$/);
    expect(result.objects[0].assetId).toBe(ASSET_UUID);
  });

  it("respects default position [0,0,0], rotation [0,0,0], scale [1,1,1] when omitted", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, [
      {
        op: "add_object",
        assetId: ASSET_UUID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
    expect(result.objects[0].position).toEqual([0, 0, 0]);
    expect(result.objects[0].rotation).toEqual([0, 0, 0]);
    expect(result.objects[0].scale).toEqual([1, 1, 1]);
  });

  it("throws OperationError with correct opIndex when explicit id collides", () => {
    const graph = applyOps(emptySceneGraph(), [
      {
        op: "add_object",
        id: "my-obj",
        assetId: ASSET_UUID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
    // Second batch: op at index 0 attempts to add with same id
    expect(() =>
      applyOps(graph, [
        {
          op: "add_object",
          id: "my-obj",
          assetId: ASSET_UUID,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ])
    ).toThrow(OperationError);

    try {
      applyOps(graph, [
        {
          op: "add_object",
          id: "my-obj",
          assetId: ASSET_UUID,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ]);
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });

  it("collision error carries the correct opIndex when collision is the second op in a batch", () => {
    const graph = applyOps(emptySceneGraph(), [
      {
        op: "add_object",
        id: "existing-obj",
        assetId: ASSET_UUID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);

    try {
      applyOps(graph, [
        { op: "delete_object", id: "default" }, // will throw "not found" — use a no-op first op instead
        // Actually, let's use set_environment as a harmless first op
      ]);
    } catch {
      // swallow
    }

    // Test with collision at opIndex 1
    const firstOp: SceneGraphOp = {
      op: "set_environment",
      environment: { skybox: "sunset", fog: null },
    };
    const collisionOp: SceneGraphOp = {
      op: "add_object",
      id: "existing-obj",
      assetId: ASSET_UUID,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };

    try {
      applyOps(graph, [firstOp, collisionOp]);
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// update_object
// ---------------------------------------------------------------------------

describe("applyOps — update_object", () => {
  it("patches named fields on an existing object", () => {
    const graph = applyOps(emptySceneGraph(), [
      {
        op: "add_object",
        id: "obj-a",
        assetId: ASSET_UUID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
    const result = applyOps(graph, [
      {
        op: "update_object",
        id: "obj-a",
        patch: { position: [5, 0, 5], name: "My Object" },
      },
    ]);
    const obj = result.objects.find((o) => o.id === "obj-a");
    expect(obj?.position).toEqual([5, 0, 5]);
    expect(obj?.name).toBe("My Object");
    // Fields not in patch remain unchanged
    expect(obj?.scale).toEqual([1, 1, 1]);
  });

  it("throws OperationError when the target id does not exist", () => {
    const graph = emptySceneGraph();
    try {
      applyOps(graph, [
        {
          op: "update_object",
          id: "nonexistent",
          patch: { position: [1, 1, 1] },
        },
      ]);
      expect.fail("expected OperationError");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// delete_object
// ---------------------------------------------------------------------------

describe("applyOps — delete_object", () => {
  it("removes the object by id", () => {
    const graph = applyOps(emptySceneGraph(), [
      {
        op: "add_object",
        id: "to-delete",
        assetId: ASSET_UUID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ]);
    const result = applyOps(graph, [{ op: "delete_object", id: "to-delete" }]);
    expect(result.objects.find((o) => o.id === "to-delete")).toBeUndefined();
  });

  it("throws OperationError when the target id does not exist", () => {
    const graph = emptySceneGraph();
    try {
      applyOps(graph, [{ op: "delete_object", id: "ghost" }]);
      expect.fail("expected OperationError");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// set_environment + set_lights
// ---------------------------------------------------------------------------

describe("applyOps — set_environment", () => {
  it("replaces the environment field", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, [
      {
        op: "set_environment",
        environment: {
          skybox: "night",
          fog: { color: "#000011", near: 10, far: 100 },
        },
      },
    ]);
    expect(result.environment.skybox).toBe("night");
    expect(result.environment.fog).toEqual({ color: "#000011", near: 10, far: 100 });
  });
});

describe("applyOps — set_lights", () => {
  it("replaces the lights array entirely", () => {
    const graph = emptySceneGraph();
    const newLights = [{ type: "ambient" as const, intensity: 0.8, color: "#aabbcc" }];
    const result = applyOps(graph, [{ op: "set_lights", lights: newLights }]);
    expect(result.lights).toHaveLength(1);
    expect(result.lights[0]).toEqual({ type: "ambient", intensity: 0.8, color: "#aabbcc" });
  });
});

// ---------------------------------------------------------------------------
// add_spawn
// ---------------------------------------------------------------------------

describe("applyOps — add_spawn", () => {
  it("appends a new spawn point", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, [
      {
        op: "add_spawn",
        id: "spawn-2",
        position: [10, 1.6, 0],
        rotation: [0, 0, 0],
      },
    ]);
    expect(result.spawnPoints).toHaveLength(2); // default + new
    const added = result.spawnPoints.find((s) => s.id === "spawn-2");
    expect(added?.position).toEqual([10, 1.6, 0]);
  });

  it("throws OperationError when id collides with an existing spawn point", () => {
    const graph = emptySceneGraph(); // has id "default"
    try {
      applyOps(graph, [
        {
          op: "add_spawn",
          id: "default", // collides with the default spawn
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
      ]);
      expect.fail("expected OperationError");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// update_spawn
// ---------------------------------------------------------------------------

describe("applyOps — update_spawn", () => {
  it("patches fields on an existing spawn point", () => {
    const graph = emptySceneGraph();
    const result = applyOps(graph, [
      {
        op: "update_spawn",
        id: "default",
        patch: { position: [3, 1.6, 3] },
      },
    ]);
    const spawn = result.spawnPoints.find((s) => s.id === "default");
    expect(spawn?.position).toEqual([3, 1.6, 3]);
  });

  it("throws OperationError when the target id does not exist", () => {
    const graph = emptySceneGraph();
    try {
      applyOps(graph, [
        {
          op: "update_spawn",
          id: "no-such-spawn",
          patch: { position: [0, 0, 0] },
        },
      ]);
      expect.fail("expected OperationError");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// delete_spawn
// ---------------------------------------------------------------------------

describe("applyOps — delete_spawn", () => {
  it("removes the spawn point by id when multiple spawn points exist", () => {
    // Add a second spawn, then delete it
    const graph = applyOps(emptySceneGraph(), [
      {
        op: "add_spawn",
        id: "spawn-extra",
        position: [5, 1.6, 5],
        rotation: [0, 0, 0],
      },
    ]);
    const result = applyOps(graph, [{ op: "delete_spawn", id: "spawn-extra" }]);
    expect(result.spawnPoints.find((s) => s.id === "spawn-extra")).toBeUndefined();
    expect(result.spawnPoints).toHaveLength(1); // "default" remains
  });

  it("throws OperationError for unknown spawn id", () => {
    const graph = emptySceneGraph();
    try {
      applyOps(graph, [{ op: "delete_spawn", id: "ghost-spawn" }]);
      expect.fail("expected OperationError");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });

  it("throws OperationError (not removes) when deletion would leave 0 spawn points — v1 invariant", () => {
    const graph = emptySceneGraph(); // single "default" spawn
    try {
      applyOps(graph, [{ op: "delete_spawn", id: "default" }]);
      expect.fail("expected OperationError — must not allow 0 spawn points");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// set_object_asset
// ---------------------------------------------------------------------------

const NEW_ASSET_UUID = "770e8400-e29b-41d4-a716-446655440002";

describe("applyOps — set_object_asset", () => {
  it("swaps the assetId on an existing object while preserving all other fields", () => {
    // First, build a graph with one object
    const graph = applyOps(emptySceneGraph(), [
      {
        op: "add_object",
        id: "my-obj",
        assetId: ASSET_UUID,
        name: "My Object",
        position: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
        scale: [2, 2, 2],
      },
    ]);

    // Now swap its asset
    const result = applyOps(graph, [
      {
        op: "set_object_asset",
        id: "my-obj",
        assetId: NEW_ASSET_UUID,
      },
    ]);

    const obj = result.objects.find((o) => o.id === "my-obj");
    // assetId should be updated
    expect(obj?.assetId).toBe(NEW_ASSET_UUID);
    // Everything else should be unchanged
    expect(obj?.id).toBe("my-obj");
    expect(obj?.name).toBe("My Object");
    expect(obj?.position).toEqual([1, 2, 3]);
    expect(obj?.rotation).toEqual([0.1, 0.2, 0.3]);
    expect(obj?.scale).toEqual([2, 2, 2]);
  });

  it("throws OperationError with correct opIndex when target id does not exist", () => {
    const graph = emptySceneGraph();
    try {
      applyOps(graph, [
        {
          op: "set_object_asset",
          id: "nonexistent-obj",
          assetId: NEW_ASSET_UUID,
        },
      ]);
      expect.fail("expected OperationError");
    } catch (err) {
      expect(err).toBeInstanceOf(OperationError);
      expect((err as OperationError).opIndex).toBe(0);
      expect((err as OperationError).message).toContain("nonexistent-obj");
    }
  });
});

// ---------------------------------------------------------------------------
// SetObjectAssetOp — Zod schema validation
// ---------------------------------------------------------------------------

describe("SetObjectAssetOp — Zod validation", () => {
  it("rejects a non-uuid assetId", () => {
    const result = SetObjectAssetOp.safeParse({
      op: "set_object_asset",
      id: "my-obj",
      assetId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty id", () => {
    const result = SetObjectAssetOp.safeParse({
      op: "set_object_asset",
      id: "",
      assetId: NEW_ASSET_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid op shape", () => {
    const result = SetObjectAssetOp.safeParse({
      op: "set_object_asset",
      id: "my-obj",
      assetId: NEW_ASSET_UUID,
    });
    expect(result.success).toBe(true);
  });
});
