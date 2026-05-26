/**
 * Scene-graph operations — the discriminated-union mutation vocabulary that
 * every editing surface (browser editor, future Blender plugin, future desktop
 * shell, future AI agent) sends to POST /api/worlds/[id]/scene-graph/ops.
 *
 * Operations-based (not document-replacement) for two reasons:
 *  (1) They're commutative-friendly when designed carefully, which is what
 *      makes future Phase 3 CRDT realtime collaboration cheap.
 *  (2) They make the audit log meaningful — each world_versions row's
 *      sceneGraph is the result of applying an explicit ops batch on top of
 *      a known base, which is far easier to reason about than diffing two
 *      whole JSON blobs.
 *
 * Pure module — no DB, no I/O, no Zod.parse() of external input except via the
 * exported schemas. Reducer uses structuredClone (native in Node 18+) for
 * immutability without an external dep.
 */

import { z } from "zod";
import {
  SceneGraphV1,
  ObjectSchema,
  EnvironmentSchema,
  LightSchema,
  SpawnPointSchema,
  type SceneGraphV1 as SG,
} from "./schema";

// ---------------------------------------------------------------------------
// Op schemas
// ---------------------------------------------------------------------------

export const AddObjectOp = z.object({
  op: z.literal("add_object"),
  assetId: z.string().uuid(),
  id: z.string().min(1).max(80).optional(),
  name: z.string().max(80).optional(),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]),
});

export const UpdateObjectOp = z.object({
  op: z.literal("update_object"),
  id: z.string().min(1),
  patch: ObjectSchema.partial().omit({ id: true, assetId: true }),
});

export const DeleteObjectOp = z.object({
  op: z.literal("delete_object"),
  id: z.string().min(1),
});

export const SetEnvironmentOp = z.object({
  op: z.literal("set_environment"),
  environment: EnvironmentSchema,
});

export const SetLightsOp = z.object({
  op: z.literal("set_lights"),
  lights: z.array(LightSchema),
});

export const AddSpawnOp = z.object({
  op: z.literal("add_spawn"),
  id: z.string().min(1).max(80),
  position: z.tuple([z.number(), z.number(), z.number()]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
});

export const UpdateSpawnOp = z.object({
  op: z.literal("update_spawn"),
  id: z.string().min(1),
  patch: SpawnPointSchema.partial().omit({ id: true }),
});

export const DeleteSpawnOp = z.object({
  op: z.literal("delete_spawn"),
  id: z.string().min(1),
});

export const SceneGraphOp = z.discriminatedUnion("op", [
  AddObjectOp,
  UpdateObjectOp,
  DeleteObjectOp,
  SetEnvironmentOp,
  SetLightsOp,
  AddSpawnOp,
  UpdateSpawnOp,
  DeleteSpawnOp,
]);

export type SceneGraphOp = z.infer<typeof SceneGraphOp>;

export const MAX_OPS_PER_BATCH = 100;

export const OpsBatchSchema = z.object({
  ops: z.array(SceneGraphOp).min(1).max(MAX_OPS_PER_BATCH),
  baseVersionId: z.string().uuid(),
  label: z.string().max(120).optional().nullable(),
});

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export class OperationError extends Error {
  constructor(message: string, readonly opIndex: number) {
    super(message);
    this.name = "OperationError";
  }
}

/**
 * Apply ops in order, return a new scene graph. Pure function.
 *
 * Throws OperationError with opIndex on:
 *  - update_object / delete_object → missing object id
 *  - update_spawn / delete_spawn → missing spawn id
 *  - add_object whose explicit id collides with existing object
 *  - add_spawn whose id collides with existing spawn
 *  - delete_spawn that would leave 0 spawn points (v1 invariant: >= 1)
 *
 * Auto-generates ids for add_object without explicit id: obj_<8-char-hex>.
 *
 * After all ops apply, runs SceneGraphV1.parse(next) as a final invariant
 * check — catches anything the per-op checks missed (e.g., setting a fog
 * far < near via set_environment).
 */
export function applyOps(graph: SG, ops: SceneGraphOp[]): SG {
  // Clone defensively — every input from this point is mutable
  const next = structuredClone(graph) as SG;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    switch (op.op) {
      case "add_object": {
        const id = op.id ?? `obj_${randomShortId()}`;
        if (next.objects.some((o) => o.id === id)) {
          throw new OperationError(`add_object: id "${id}" already exists`, i);
        }
        next.objects.push({
          id,
          assetId: op.assetId,
          name: op.name,
          position: op.position,
          rotation: op.rotation,
          scale: op.scale,
        });
        break;
      }
      case "update_object": {
        const idx = next.objects.findIndex((o) => o.id === op.id);
        if (idx === -1) {
          throw new OperationError(`update_object: id "${op.id}" not found`, i);
        }
        next.objects[idx] = { ...next.objects[idx], ...op.patch };
        break;
      }
      case "delete_object": {
        const before = next.objects.length;
        next.objects = next.objects.filter((o) => o.id !== op.id);
        if (next.objects.length === before) {
          throw new OperationError(`delete_object: id "${op.id}" not found`, i);
        }
        break;
      }
      case "set_environment": {
        next.environment = op.environment;
        break;
      }
      case "set_lights": {
        next.lights = op.lights;
        break;
      }
      case "add_spawn": {
        if (next.spawnPoints.some((s) => s.id === op.id)) {
          throw new OperationError(`add_spawn: id "${op.id}" already exists`, i);
        }
        next.spawnPoints.push({
          id: op.id,
          position: op.position,
          rotation: op.rotation,
        });
        break;
      }
      case "update_spawn": {
        const idx = next.spawnPoints.findIndex((s) => s.id === op.id);
        if (idx === -1) {
          throw new OperationError(`update_spawn: id "${op.id}" not found`, i);
        }
        next.spawnPoints[idx] = { ...next.spawnPoints[idx], ...op.patch };
        break;
      }
      case "delete_spawn": {
        const before = next.spawnPoints.length;
        next.spawnPoints = next.spawnPoints.filter((s) => s.id !== op.id);
        if (next.spawnPoints.length === before) {
          throw new OperationError(`delete_spawn: id "${op.id}" not found`, i);
        }
        if (next.spawnPoints.length === 0) {
          throw new OperationError(
            `delete_spawn: refused — scene graph requires at least 1 spawn point`,
            i
          );
        }
        break;
      }
    }
  }

  // Final invariant check — catches anything per-op checks missed.
  return SceneGraphV1.parse(next);
}

function randomShortId(): string {
  // crypto.randomUUID is available in Node 18+ and browsers; no import needed.
  // We use the first 8 hex chars as a short ID.
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
