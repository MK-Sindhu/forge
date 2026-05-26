// In-memory ("synthetic") scene-graph helpers for legacy worlds.
//
// Legacy worlds (worlds with `glb_url` set but no `scene_graph` persisted)
// predate Phase 2's scene-graph migration. The page renderer used to fall
// back to a separate orbit-only WorldViewer for those — meaning non-owners
// couldn't walk in those worlds until the owner clicked "Convert to scene
// graph" (which writes a real scene graph + world_versions row).
//
// To make ALL worlds walkable for everyone immediately, we synthesize a
// scene graph in-memory from the legacy `.glb` on the page render path.
// The shape matches what the convert route persists; the difference is
// it's never written to the DB. When the owner DOES convert later, the
// persisted version transparently takes over (the page reads `sceneGraph`
// from the world row; null falls through to this helper).
//
// Used by:
// - src/app/world/[id]/page.tsx — visitor render path
// - src/app/api/worlds/[id]/convert-to-scene-graph/route.ts — TODO: could
//   refactor to use this helper to DRY the shape. Left as a follow-up.

import type { SceneGraphV1 } from "./schema";

interface SyntheticAsset {
  id: string;
  name: string;
  glbUrl: string;
  sizeBytes: number;
}

/**
 * Build the canonical 1-object scene graph wrapping a single .glb asset.
 * Uses the world's id as the synthetic asset id — both are uuids, so the
 * scene graph's `assetId: uuid` constraint is satisfied. The matching
 * asset entry (see `buildSyntheticAssets`) uses the same id.
 */
export function buildSyntheticSceneGraph(worldId: string): SceneGraphV1 {
  return {
    schemaVersion: 1,
    objects: [
      {
        id: "obj_base",
        assetId: worldId,
        name: "Base",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
    lights: [
      { type: "ambient", intensity: 0.5, color: "#ffffff" },
      { type: "sun", intensity: 1, direction: [5, 5, 5], color: "#ffffff" },
    ],
    environment: { skybox: "studio", fog: null },
    spawnPoints: [
      { id: "default", position: [0, 1.6, 5], rotation: [0, 0, 0] },
    ],
    camera: { position: [3, 3, 5], target: [0, 0, 0], fov: 50 },
  };
}

/**
 * Build the matching asset array. WorldVisitor expects one entry per
 * unique assetId referenced in the scene graph's `objects`. For the
 * synthetic case there's exactly one object pointing at one asset.
 */
export function buildSyntheticAssets(args: {
  worldId: string;
  glbUrl: string;
  glbSizeBytes: number | null;
}): SyntheticAsset[] {
  return [
    {
      id: args.worldId,
      name: "Base",
      glbUrl: args.glbUrl,
      sizeBytes: args.glbSizeBytes ?? 0,
    },
  ];
}
