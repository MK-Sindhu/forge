/**
 * Tests for src/lib/scene-graph/schema.ts
 *
 * No mocks needed — this module is pure Zod logic with no external I/O.
 * Tests are spec-first: they describe what the schema SHOULD do per the
 * Phase 2 plan (plan-slice-7-hazy-crystal.md §5 "Scene-graph TypeScript
 * schema"). The implementation is consulted only for exact symbol names.
 */

import { describe, it, expect } from "vitest";
import {
  SCENE_GRAPH_SCHEMA_VERSION,
  ObjectSchema,
  LightSchema,
  EnvironmentSchema,
  SceneGraphV1,
  parseSceneGraph,
  emptySceneGraph,
} from "./schema";

// ============================================================================
// SCENE_GRAPH_SCHEMA_VERSION constant
// ============================================================================

describe("SCENE_GRAPH_SCHEMA_VERSION", () => {
  it("equals 1", () => {
    expect(SCENE_GRAPH_SCHEMA_VERSION).toBe(1);
  });
});

// ============================================================================
// emptySceneGraph() helper
// ============================================================================

describe("emptySceneGraph()", () => {
  it("returns a value that satisfies SceneGraphV1.safeParse", () => {
    const result = SceneGraphV1.safeParse(emptySceneGraph());
    expect(result.success).toBe(true);
  });

  it("populates objects as an empty array", () => {
    expect(emptySceneGraph().objects).toEqual([]);
  });

  it("populates lights with exactly 2 entries — 1 ambient and 1 sun", () => {
    const { lights } = emptySceneGraph();
    expect(lights).toHaveLength(2);
    const types = lights.map((l) => l.type).sort();
    expect(types).toEqual(["ambient", "sun"]);
  });

  it("sets environment.skybox to 'studio' and environment.fog to null", () => {
    const { environment } = emptySceneGraph();
    expect(environment.skybox).toBe("studio");
    expect(environment.fog).toBeNull();
  });

  it("populates spawnPoints with a single entry whose id is 'default'", () => {
    const { spawnPoints } = emptySceneGraph();
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].id).toBe("default");
  });

  it("sets camera.fov to 50", () => {
    expect(emptySceneGraph().camera.fov).toBe(50);
  });
});

// ============================================================================
// parseSceneGraph() — top-level helper
// ============================================================================

describe("parseSceneGraph()", () => {
  it("returns a valid SceneGraphV1 when given { schemaVersion: 1 } (defaults fill in)", () => {
    const result = parseSceneGraph({ schemaVersion: 1 });
    expect(result.schemaVersion).toBe(1);
    expect(result.objects).toEqual([]);
    // Spot-check that defaults were populated
    expect(result.camera.fov).toBe(50);
  });

  it("throws when schemaVersion is 2 (unknown version)", () => {
    expect(() => parseSceneGraph({ schemaVersion: 2 })).toThrow(/2/);
  });

  it("throws when input is null", () => {
    expect(() => parseSceneGraph(null)).toThrow();
  });

  it("throws when input is a plain string", () => {
    expect(() => parseSceneGraph("not an object")).toThrow();
  });

  it("throws when input is an empty object (no schemaVersion)", () => {
    expect(() => parseSceneGraph({})).toThrow();
  });

  it("is idempotent: parsing a JSON round-tripped emptySceneGraph() returns deep-equal output", () => {
    const original = emptySceneGraph();
    const roundTripped = parseSceneGraph(JSON.parse(JSON.stringify(original)));
    expect(roundTripped).toEqual(original);
  });
});

// ============================================================================
// ObjectSchema
// ============================================================================

describe("ObjectSchema", () => {
  const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

  it("accepts a valid object and applies rotation + scale defaults", () => {
    const result = ObjectSchema.safeParse({
      id: "obj_1",
      assetId: VALID_UUID,
      position: [1, 2, 3],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.rotation).toEqual([0, 0, 0]);
    expect(result.data.scale).toEqual([1, 1, 1]);
    expect(result.data.position).toEqual([1, 2, 3]);
  });

  it("rejects an object whose assetId is not a UUID", () => {
    const result = ObjectSchema.safeParse({
      id: "obj_1",
      assetId: "not-a-uuid",
      position: [0, 0, 0],
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// LightSchema — discriminated union
// ============================================================================

describe("LightSchema discriminated union", () => {
  it("accepts a sun light and defaults color to '#ffffff'", () => {
    const result = LightSchema.safeParse({
      type: "sun",
      intensity: 1,
      direction: [1, 1, 1],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.color).toBe("#ffffff");
  });

  it("accepts an ambient light and defaults color to '#ffffff'", () => {
    const result = LightSchema.safeParse({
      type: "ambient",
      intensity: 0.5,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.color).toBe("#ffffff");
  });

  it("rejects a light type that is not in the discriminated union (e.g. 'spotlight')", () => {
    const result = LightSchema.safeParse({
      type: "spotlight",
      intensity: 1,
      direction: [0, -1, 0],
    });
    expect(result.success).toBe(false);
  });
});

// ============================================================================
// EnvironmentSchema
// ============================================================================

describe("EnvironmentSchema", () => {
  it("rejects an unknown skybox preset", () => {
    const result = EnvironmentSchema.safeParse({ skybox: "unknown-preset" });
    expect(result.success).toBe(false);
  });

  it("accepts a known skybox preset ('sunset') and defaults fog to null", () => {
    const result = EnvironmentSchema.safeParse({ skybox: "sunset" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skybox).toBe("sunset");
    expect(result.data.fog).toBeNull();
  });
});

// ============================================================================
// Vec3 arity + ColorHex format
// ============================================================================

describe("Vec3 arity validation", () => {
  it("rejects an object whose position has only 2 elements (wrong arity)", () => {
    const result = ObjectSchema.safeParse({
      id: "obj_bad",
      assetId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      position: [1, 2],  // tuple expects exactly 3 elements
    });
    expect(result.success).toBe(false);
  });
});

describe("ColorHex format validation", () => {
  it("rejects a non-hex color string on a light", () => {
    const result = LightSchema.safeParse({
      type: "ambient",
      intensity: 1,
      color: "not-a-hex",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a 3-digit hex shorthand color (must be full 6-digit #rrggbb)", () => {
    const result = LightSchema.safeParse({
      type: "ambient",
      intensity: 1,
      color: "#abc",
    });
    expect(result.success).toBe(false);
  });
});
