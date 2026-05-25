/**
 * Scene Graph v1 — the canonical representation of a FORGE world.
 *
 * A scene graph composes multiple .glb assets in 3D space + lights +
 * environment + spawn points + camera defaults. Stored in the
 * worlds.scene_graph jsonb column (nullable; NULL = legacy single-GLB world).
 *
 * Versioning: schemaVersion: 1 today. When v2 ships, extend SceneGraphAny to
 * a discriminated union on schemaVersion, and add a v1-to-v2 migrator.
 *
 * Design notes (locked in the Phase 2 plan):
 *  - Rotations are Euler (vec3 of radians) in v1 for editor simplicity.
 *    Trade: less precision than quaternions; switch in v2 when an animation
 *    system needs the precision (Phase 4 territory).
 *  - No per-object material override in v1 (materials baked into source .glb)
 *  - No per-object lighting in v1 (lights are world-scope)
 *  - Single default spawn point required (`id: "default"`)
 */

import { z } from "zod";

export const SCENE_GRAPH_SCHEMA_VERSION = 1;

// ---- Building blocks -------------------------------------------------------

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

// Hex color in the form "#rrggbb" (lowercase). Defensive — many tools emit
// 3-digit or uppercase variants; normalize on read in a later helper if needed.
const ColorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---- Objects ---------------------------------------------------------------

export const ObjectSchema = z.object({
  id: z.string().min(1).max(80),       // client-generated short id, e.g. "obj_abc123"
  assetId: z.string().uuid(),          // FK to world_assets.id
  name: z.string().max(80).optional(),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.default([0, 0, 0]),   // Euler radians
  scale: Vec3.default([1, 1, 1]),
});

// ---- Lights (discriminated union by `type`) --------------------------------

const SunLight = z.object({
  type: z.literal("sun"),
  intensity: z.number().min(0).max(10),
  direction: Vec3,                                       // unit-ish vector; renderer normalizes
  color: ColorHex.default("#ffffff"),
});

const AmbientLight = z.object({
  type: z.literal("ambient"),
  intensity: z.number().min(0).max(10),
  color: ColorHex.default("#ffffff"),
});

export const LightSchema = z.discriminatedUnion("type", [SunLight, AmbientLight]);

// ---- Environment + spawn + camera -----------------------------------------

export const EnvironmentSchema = z.object({
  skybox: z.enum(["studio", "sunset", "dawn", "night", "warehouse", "park", "city", "forest"]).default("studio"),
  fog: z.object({
    color: ColorHex,
    near: z.number().nonnegative(),
    far: z.number().positive(),
  }).nullable().default(null),
});

export const SpawnPointSchema = z.object({
  id: z.string().min(1).max(80),
  position: Vec3,
  rotation: Vec3.default([0, 0, 0]),
});

export const CameraSchema = z.object({
  position: Vec3.default([3, 3, 5]),
  target: Vec3.default([0, 0, 0]),
  fov: z.number().min(10).max(120).default(50),
});

// ---- Top-level v1 schema ---------------------------------------------------

export const SceneGraphV1 = z.object({
  schemaVersion: z.literal(1),
  objects: z.array(ObjectSchema).default([]),
  lights: z.array(LightSchema).default([
    { type: "ambient", intensity: 0.5, color: "#ffffff" },
    { type: "sun", intensity: 1, direction: [5, 5, 5], color: "#ffffff" },
  ]),
  environment: EnvironmentSchema.default({ skybox: "studio", fog: null }),
  spawnPoints: z.array(SpawnPointSchema).default([
    { id: "default", position: [0, 1.6, 5], rotation: [0, 0, 0] },
  ]),
  camera: CameraSchema.default({ position: [3, 3, 5], target: [0, 0, 0], fov: 50 }),
});

export type SceneGraphV1 = z.infer<typeof SceneGraphV1>;

// Discriminated union forward-decl: today only v1 exists. When v2 ships,
// change this to: z.discriminatedUnion("schemaVersion", [SceneGraphV1, SceneGraphV2])
export type SceneGraphAny = SceneGraphV1;

// ---- Helpers ---------------------------------------------------------------

/**
 * Parse + normalize an unknown jsonb blob into a typed scene graph.
 *
 * Used at the API boundary (GET /api/worlds/[id] reading worlds.scene_graph
 * jsonb). Returns the parsed scene graph, or THROWS on invalid input — callers
 * decide whether to surface the error or fall through to the legacy renderer.
 *
 * The current implementation only knows about v1; future versions extend the
 * switch.
 */
export function parseSceneGraph(input: unknown): SceneGraphAny {
  if (input == null || typeof input !== "object") {
    throw new Error("scene graph is not an object");
  }
  const version = (input as { schemaVersion?: unknown }).schemaVersion;
  if (version === 1) {
    return SceneGraphV1.parse(input);
  }
  throw new Error(`Unknown scene graph schemaVersion: ${String(version)}`);
}

/**
 * Build an empty v1 scene graph with sensible defaults. Used by 8.5's
 * legacy-to-scene-graph conversion tool (and by tests).
 */
export function emptySceneGraph(): SceneGraphV1 {
  return SceneGraphV1.parse({ schemaVersion: 1 });  // defaults fill the rest
}
