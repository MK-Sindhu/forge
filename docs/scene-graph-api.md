# FORGE Scene-Graph API — Public Reference

> **Audience:** External clients: browser editor, Blender plugin, desktop shell, AI agent, or any future "web-native" editing surface.
> **Scope:** Phase 2 (sub-slice 8.2). Shipped routes, data shapes, and concurrency protocol.
> **Implementation:** Source lives in `src/app/api/worlds/[id]/` and `src/lib/scene-graph/`.

---

## Contents

1. [Overview](#1-overview)
2. [Quickstart](#2-quickstart)
3. [Operation type reference](#3-operation-type-reference)
4. [Endpoint reference](#4-endpoint-reference)
5. [Optimistic concurrency](#5-optimistic-concurrency)
6. [Permission model](#6-permission-model)
7. [Versioning model](#7-versioning-model)
8. [Asset model](#8-asset-model)
9. [Limits and caps](#9-limits-and-caps)
10. [Example flows](#10-example-flows)
11. [Implementation locations](#11-implementation-locations)

---

## 1. Overview

### World-as-document

A FORGE world is a versioned JSON document — the **scene graph** — stored in `worlds.scene_graph` (jsonb). The scene graph describes which `.glb` assets are placed in 3D space, the world's lights, environment settings, spawn points, and camera defaults. Each `.glb` asset is a row in `world_assets`, scoped to a single world in Phase 2.

The scene graph document shape is defined by `SceneGraphV1` in [`src/lib/scene-graph/schema.ts`](../src/lib/scene-graph/schema.ts). That file is the single source of truth for field names, types, and defaults.

### Operations-based mutations

Clients do **not** POST a whole replacement document. Instead they POST a **batch of named operations** (add object, update object, delete spawn point, etc.) on top of a known base version. The server applies the operations atomically and creates a new `world_versions` row.

**Why operations, not replacements:**

- Operations are commutative-friendly by design, which is what makes Phase 3 real-time CRDT collaboration cheap to add. The server can merge two concurrent op batches when there is no structural conflict.
- Each `world_versions` row is the *result* of applying a concrete op batch on a known parent. That makes the version history an audit log rather than a series of opaque JSON diffs.
- Operations are small on the wire. A batch of 10 `add_object` ops is a few hundred bytes; the equivalent whole-document replacement could be tens of kilobytes.

### Schema versioning

Every scene-graph document contains `"schemaVersion": 1`. When v2 ships (Phase 4+), `SceneGraphAny` becomes a discriminated union on that field and a v1→v2 migrator handles old rows. Clients should pass through the `schemaVersion` field they received — never hard-code `1` unless starting a new document.

---

## 2. Quickstart

A complete new-world editing session in three steps.

### Step 1 — Presign an asset upload

```bash
# Obtain a Clerk session token and set:
#   FORGE_TOKEN=<your __session JWT>
#   WORLD_ID=<uuid of an existing world you own>
#   ASSET_ID=$(python3 -c "import uuid; print(uuid.uuid4())")

curl -s -X POST https://forge-black-eta.vercel.app/api/uploads/sign \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"kind\": \"asset\",
    \"worldId\": \"$WORLD_ID\",
    \"assetId\": \"$ASSET_ID\",
    \"contentType\": \"model/gltf-binary\",
    \"sizeBytes\": 204800
  }"
# → { "uploadUrl": "https://...", "objectKey": "assets/<clerkUserId>/<assetId>/asset.glb" }
```

### Step 2 — Upload to R2, then finalize the asset row

```bash
# PUT the file body directly to R2 (never through our server)
curl -s -X PUT "$UPLOAD_URL" \
  -H "Content-Type: model/gltf-binary" \
  -H "Content-Length: 204800" \
  --data-binary @my-model.glb

# Finalize: tell FORGE the asset exists
curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/$WORLD_ID/assets" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$ASSET_ID\",
    \"name\": \"My Model\",
    \"sizeBytes\": 204800
  }"
# → HTTP 201 { "id": "<assetId>", "name": "My Model", "glbUrl": "...", "sizeBytes": 204800, "createdAt": "..." }
```

### Step 3 — Apply an ops batch to add the object, then publish

```bash
# Get the current base version first
SCENE=$(curl -s "https://forge-black-eta.vercel.app/api/worlds/$WORLD_ID/scene-graph")
BASE_VERSION_ID=$(echo $SCENE | python3 -c "import sys,json; print(json.load(sys.stdin)['versionId'])")

# Apply an add_object op
curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/$WORLD_ID/scene-graph/ops" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"baseVersionId\": \"$BASE_VERSION_ID\",
    \"ops\": [
      {
        \"op\": \"add_object\",
        \"assetId\": \"$ASSET_ID\",
        \"name\": \"My Model\",
        \"position\": [0, 0, 0]
      }
    ]
  }"
# → { "versionId": "<newVersionId>", "versionNumber": 2, "sceneGraph": { ... } }

# Publish the new version
NEW_VERSION_ID=<from above response>
curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/$WORLD_ID/versions/$NEW_VERSION_ID/publish" \
  -H "Authorization: Bearer $FORGE_TOKEN"
# → { "versionId": "...", "versionNumber": 2, "status": "published" }
```

---

## 3. Operation type reference

All 9 operations are members of the `SceneGraphOp` discriminated union, keyed on the `"op"` field. Source: [`src/lib/scene-graph/operations.ts`](../src/lib/scene-graph/operations.ts).

A batch is wrapped in `OpsBatchSchema`:

```ts
{
  ops: SceneGraphOp[],        // 1..100 ops (required)
  baseVersionId: string,      // UUID of the version to apply on top of (required)
  label?: string | null,      // Optional label for this batch (max 120 chars)
}
```

---

### 3.1 `add_object`

Add a `.glb` asset to the scene at a given position.

**TypeScript / Zod shape:**
```ts
{
  op: "add_object",
  assetId: string,            // UUID — must reference a world_assets row
  id?: string,                // Optional explicit object id (max 80 chars). Server auto-generates "obj_<8hex>" if absent.
  name?: string,              // Optional human label (max 80 chars)
  position?: [number, number, number],  // Default: [0, 0, 0]
  rotation?: [number, number, number],  // Euler radians. Default: [0, 0, 0]
  scale?: [number, number, number],     // Default: [1, 1, 1]
}
```

**JSON example:**
```json
{
  "op": "add_object",
  "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Tree",
  "position": [5, 0, -3],
  "rotation": [0, 1.5708, 0],
  "scale": [1, 1, 1]
}
```

**Invariants enforced:**
- If `id` is provided and already exists in `objects`, throws `OperationError` (400 from route).
- If `id` is omitted, server generates `obj_<8-char-hex>` using `crypto.randomUUID().replace(/-/g,"").slice(0,8)`.
- `assetId` is not validated against `world_assets` at op-apply time — validation is the client's responsibility. A corrupt reference will simply render as missing in the viewer.

---

### 3.2 `update_object`

Patch one or more fields on an existing object. `id` and `assetId` are immutable and excluded from the patch shape.

**TypeScript / Zod shape:**
```ts
{
  op: "update_object",
  id: string,                 // Object id to update (required, min 1 char)
  patch: {
    name?: string,
    position?: [number, number, number],
    rotation?: [number, number, number],
    scale?: [number, number, number],
  }
}
```

**JSON example:**
```json
{
  "op": "update_object",
  "id": "obj_a1b2c3d4",
  "patch": { "position": [10, 0, 0] }
}
```

**Invariants enforced:**
- Throws `OperationError` if `id` is not found in the current `objects` array.
- Fields not included in `patch` retain their existing values (true partial update).

---

### 3.3 `set_object_asset`

Swap an object's asset in-place, preserving its `id`, `name`, `position`, `rotation`, and `scale`.

Use this for identity-preserving asset replacement (folder-watcher CLI, future "replace asset" UI). For transform/name changes, use `update_object`. To remove an object entirely and add a different one, use `delete_object` + `add_object`.

**TypeScript / Zod shape:**
```ts
{
  op: "set_object_asset",
  id: string,       // Object id whose asset is being swapped (required, min 1 char)
  assetId: string,  // UUID — the new asset to point to
}
```

**JSON example:**
```json
{
  "op": "set_object_asset",
  "id": "obj_a1b2c3d4",
  "assetId": "b2c3d4e5-f6a7-8901-bcde-f01234567890"
}
```

**Invariants enforced:**
- Throws `OperationError` if `id` is not found in the current `objects` array.
- All other fields on the object (`name`, `position`, `rotation`, `scale`) are unchanged.

**Gotcha — assetId is not validated against `world_assets`:** The reducer does not verify the `assetId` references an existing `world_assets` row. The route layer will fail with 503 on FK violation at insert time. Clients SHOULD verify the `assetId` is in `GET /api/worlds/[id]/assets` before posting the op.

---

### 3.5 `delete_object`

Remove an object from the scene by id.

**TypeScript / Zod shape:**
```ts
{
  op: "delete_object",
  id: string,                 // Object id to remove (required, min 1 char)
}
```

**JSON example:**
```json
{
  "op": "delete_object",
  "id": "obj_a1b2c3d4"
}
```

**Invariants enforced:**
- Throws `OperationError` if `id` is not found in the current `objects` array.

---

### 3.6 `set_environment`

Replace the entire environment configuration (skybox + fog) in one operation. No partial patch — supply all fields you want to keep.

**TypeScript / Zod shape:**
```ts
{
  op: "set_environment",
  environment: {
    skybox: "studio" | "sunset" | "dawn" | "night" | "warehouse" | "park" | "city" | "forest",
    fog: {
      color: string,          // "#rrggbb" (lowercase 6-digit hex)
      near: number,           // >= 0
      far: number,            // > 0
    } | null,                 // null = no fog
  }
}
```

**JSON example:**
```json
{
  "op": "set_environment",
  "environment": {
    "skybox": "sunset",
    "fog": { "color": "#aabbcc", "near": 10, "far": 200 }
  }
}
```

**Invariants enforced:**
- `skybox` must be one of the 8 enum values; unknown values fail Zod validation before the reducer runs (400).
- `fog.far` must be positive (`> 0`). `fog.near` must be non-negative (`>= 0`). The final `SceneGraphV1.parse()` check at the end of `applyOps` catches a fog where `near >= far`.

---

### 3.7 `set_lights`

Replace the entire lights array. Light types are a discriminated union on `"type"`.

**TypeScript / Zod shape:**
```ts
{
  op: "set_lights",
  lights: Array<
    | {
        type: "sun",
        intensity: number,   // 0..10
        direction: [number, number, number],  // unit-ish vector; renderer normalizes
        color: string,       // Default "#ffffff"
      }
    | {
        type: "ambient",
        intensity: number,   // 0..10
        color: string,       // Default "#ffffff"
      }
  >
}
```

**JSON example:**
```json
{
  "op": "set_lights",
  "lights": [
    { "type": "ambient", "intensity": 0.3, "color": "#ffffff" },
    { "type": "sun", "intensity": 1.5, "direction": [1, 2, 1], "color": "#fffaee" }
  ]
}
```

**Invariants enforced:**
- Unknown `type` values (e.g. `"spotlight"`) fail Zod schema validation before the reducer runs (400).
- An empty array (`[]`) is valid — the scene will have no lights (renders dark; client should warn before allowing this).

---

### 3.8 `add_spawn`

Add a player spawn point to the scene.

**TypeScript / Zod shape:**
```ts
{
  op: "add_spawn",
  id: string,                 // Spawn id (required, 1..80 chars)
  position: [number, number, number],  // Required — no default
  rotation?: [number, number, number], // Default: [0, 0, 0]
}
```

**JSON example:**
```json
{
  "op": "add_spawn",
  "id": "spawn_upper_deck",
  "position": [0, 5, 0],
  "rotation": [0, 0, 0]
}
```

**Invariants enforced:**
- Throws `OperationError` if `id` already exists in `spawnPoints`.

---

### 3.9 `update_spawn`

Patch one or more fields on an existing spawn point.

**TypeScript / Zod shape:**
```ts
{
  op: "update_spawn",
  id: string,                 // Spawn id to update (required, min 1 char)
  patch: {
    position?: [number, number, number],
    rotation?: [number, number, number],
  }
}
```

**JSON example:**
```json
{
  "op": "update_spawn",
  "id": "default",
  "patch": { "position": [2, 1.6, 5] }
}
```

**Invariants enforced:**
- Throws `OperationError` if `id` is not found in `spawnPoints`.
- `id` is immutable and excluded from `patch`.

---

### 3.10 `delete_spawn`

Remove a spawn point by id.

**TypeScript / Zod shape:**
```ts
{
  op: "delete_spawn",
  id: string,                 // Spawn id to remove (required, min 1 char)
}
```

**JSON example:**
```json
{
  "op": "delete_spawn",
  "id": "spawn_upper_deck"
}
```

**Invariants enforced:**
- Throws `OperationError` if `id` is not found in `spawnPoints`.
- **Throws `OperationError` if deletion would leave 0 spawn points.** A v1 scene graph requires at least one spawn point at all times. To replace the last spawn point, `add_spawn` a new one first, then `delete_spawn` the old one in the same batch.

---

## 4. Endpoint reference

Base URL: `https://forge-black-eta.vercel.app` (production). Replace with `http://localhost:3000` for local dev.

All endpoints:
- Return JSON (`Content-Type: application/json`) for all responses including errors.
- Accept `Authorization: Bearer <session_token>` for auth (Clerk JWT).
- Return `400` with `{ "error": "<message>", "issues"?: ZodIssue[] }` on validation failure.
- Return `503` with `{ "error": "Database temporarily unavailable, please try again" }` on transient DB errors.

---

### 4.1 GET `/api/worlds/[id]/scene-graph`

Bootstrap the editor or renderer for a world. Returns the latest scene graph and version metadata.

**Auth:** None (public).

**Path params:** `id` — world UUID.

**Response (200):**
```ts
{
  sceneGraph: SceneGraphV1 | null,      // null if legacy world or parse failure
  versionId: string | null,             // UUID of latest world_versions row
  versionNumber: number | null,         // sequential integer
  status: "draft" | "published" | null, // status of latest version
  publishedVersionId: string | null,    // worlds.published_version_id
}
```

**Error codes:**

| Status | Condition |
|--------|-----------|
| 400 | `id` is not a valid UUID |
| 404 | World not found |
| 503 | DB unavailable |

**curl example:**
```bash
curl -s "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/scene-graph"
```

**Notes:**
- Legacy worlds (no `world_versions` rows) return all version fields as `null` but still include `publishedVersionId` (which will also be `null`).
- `sceneGraph` is parsed defensively — a corrupt `world_versions.scene_graph` column returns `null` and logs a server-side error rather than 500.
- The client should track `versionId` and pass it as `baseVersionId` on the next ops batch.

---

### 4.2 POST `/api/worlds/[id]/scene-graph/ops`

Apply a batch of scene-graph operations. The canonical mutation surface.

**Auth:** Required. World owner only.

**Path params:** `id` — world UUID.

**Request body (`OpsBatchSchema`):**
```ts
{
  ops: SceneGraphOp[],        // 1..100 ops (required)
  baseVersionId: string,      // UUID (required)
  label?: string | null,      // Optional commit message (max 120 chars)
}
```

**Response (200):**
```ts
{
  versionId: string,          // UUID of the newly created version
  versionNumber: number,      // Sequential integer (base + 1)
  sceneGraph: SceneGraphV1,   // The scene graph after applying all ops
}
```

**Error codes:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "...", "issues": [...] }` | Zod validation failure (malformed ops, bad baseVersionId, etc.) |
| 400 | `{ "error": "<op message>", "opIndex": number }` | `OperationError` thrown by `applyOps` — 0-based index of the failing op |
| 401 | `{ "error": "Unauthorized" }` | Not signed in |
| 403 | `{ "error": "Forbidden" }` | Signed in but not the world owner |
| 404 | `{ "error": "Base version not found" }` | `baseVersionId` does not belong to this world |
| 409 | See [§5 Optimistic concurrency](#5-optimistic-concurrency) | A newer version exists on top of `baseVersionId` |
| 503 | `{ "error": "..." }` | DB unavailable |

**curl example:**
```bash
curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/scene-graph/ops" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "baseVersionId": "BASE_VERSION_UUID",
    "ops": [
      {
        "op": "add_object",
        "assetId": "ASSET_UUID",
        "name": "Lamp Post",
        "position": [3, 0, 2]
      }
    ]
  }'
```

---

### 4.3 GET `/api/worlds/[id]/versions`

Paginated version history for a world. Intentionally omits the `sceneGraph` JSONB from list items — use `GET /scene-graph` for the full document.

**Auth:** None (public).

**Path params:** `id` — world UUID.

**Query params:**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `cursor` | ISO 8601 string | (first page) | `createdAt` of the last item from the previous page |
| `limit` | integer 1..50 | 20 | Items per page |

**Response (200):**
```ts
{
  versions: Array<{
    id: string,
    versionNumber: number,
    status: "draft" | "published",
    label: string | null,
    parentVersionId: string | null,
    createdAt: string,           // ISO 8601
    author: {
      id: string,
      username: string,
      avatarUrl: string | null,
    },
  }>,
  nextCursor: string | null,     // ISO 8601 createdAt for the next page, or null
}
```

**Error codes:**

| Status | Condition |
|--------|-----------|
| 400 | `id` not a UUID, or invalid query params |
| 404 | World not found |
| 503 | DB unavailable |

**curl example:**
```bash
# First page
curl -s "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/versions?limit=10"

# Second page (use nextCursor from previous response)
curl -s "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/versions?limit=10&cursor=2026-05-26T12:00:00.000Z"
```

---

### 4.4 POST `/api/worlds/[id]/versions/[v]/publish`

Mark a specific version as published. Sets `world_versions.status = "published"` and `worlds.published_version_id = v`. Does **not** update `worlds.scene_graph` (that column tracks the latest draft).

**Auth:** Required. World owner only.

**Path params:** `id` — world UUID. `v` — version UUID.

**Request body:** None (empty body is fine).

**Response (200):**
```ts
{
  versionId: string,           // Same as path param v
  versionNumber: number,
  status: "published",         // Always "published" on success
}
```

**Error codes:**

| Status | Condition |
|--------|-----------|
| 400 | `id` or `v` not valid UUIDs |
| 401 | Not signed in |
| 403 | Not world owner |
| 404 | World not found, or version `v` does not belong to world `id` (cross-world spoofing guard) |
| 503 | DB unavailable |

**Idempotent:** Calling this on an already-published version returns the same 200 body with no side effects.

**curl example:**
```bash
curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/versions/VERSION_UUID/publish" \
  -H "Authorization: Bearer $FORGE_TOKEN"
```

---

### 4.5 GET `/api/worlds/[id]/assets`

List all world assets, newest first. Capped at 100 items.

**Auth:** None (public).

**Path params:** `id` — world UUID.

**Response (200):**
```ts
{
  assets: Array<{
    id: string,            // UUID (world_assets.id)
    name: string,
    glbUrl: string,        // Public R2 URL
    sizeBytes: number,     // File size in bytes
    createdAt: string,     // ISO 8601
  }>,
}
```

**Error codes:**

| Status | Condition |
|--------|-----------|
| 400 | `id` not a UUID |
| 404 | World not found |
| 503 | DB unavailable |

**curl example:**
```bash
curl -s "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/assets"
```

---

### 4.6 POST `/api/worlds/[id]/assets`

Record a `world_assets` row after the client has uploaded the `.glb` file to R2. This is step 3 of the 3-step asset upload flow. See [§8 Asset model](#8-asset-model) for the full flow.

**Auth:** Required. World owner only.

**Path params:** `id` — world UUID.

**Request body:**
```ts
{
  assetId: string,         // UUID (must match the assetId used in uploads/sign)
  name: string,            // Human-readable label (1..120 chars)
  sizeBytes: number,       // Positive integer — must match the actual R2 object size
}
```

**Response (201):**
```ts
{
  id: string,              // UUID (same as assetId)
  name: string,
  glbUrl: string,          // Public R2 URL
  sizeBytes: number,
  createdAt: string,       // ISO 8601
}
```

**Error codes:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Validation failed", "issues": [...] }` | Zod validation failure |
| 400 | `{ "error": "asset not uploaded" }` | R2 HEAD returned 404 — file was never uploaded |
| 400 | `{ "error": "size mismatch", "expected": N, "actual": M }` | R2 content-length doesn't match `sizeBytes` |
| 401 | `{ "error": "Unauthorized" }` | Not signed in |
| 403 | `{ "error": "Forbidden" }` | Not world owner |
| 404 | `{ "error": "World not found" }` | World does not exist |
| 503 | `{ "error": "..." }` | DB unavailable, or UUID collision (generate fresh `assetId` and retry) |

**No idempotency:** If the same `assetId` is submitted twice, the second call returns 503 due to the primary key collision. The client must generate a fresh UUID on each attempt.

**curl example:**
```bash
curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/assets" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "ASSET_UUID",
    "name": "Tree Pack v1",
    "sizeBytes": 102400
  }'
```

---

### 4.7 DELETE `/api/worlds/[id]/assets/[assetId]`

Strict-integrity delete. Refuses to delete an asset that is referenced by any `world_versions` row.

**Auth:** Required. World owner only.

**Path params:** `id` — world UUID. `assetId` — asset UUID.

**Request body:** None.

**Response (200):**
```ts
{
  deleted: true,
  assetId: string,         // Same as path param assetId
}
```

**Error codes:**

| Status | Body | Condition |
|--------|------|-----------|
| 400 | `{ "error": "Invalid ..." }` | Path params not valid UUIDs |
| 401 | `{ "error": "Unauthorized" }` | Not signed in |
| 403 | `{ "error": "Forbidden" }` | Not world owner |
| 404 | `{ "error": "Asset not found" }` | Asset row missing, or belongs to a different world |
| 409 | `{ "error": "asset in use", "referencedBy": { "versionId": "...", "versionNumber": N } }` | Asset is referenced in at least one version's scene_graph |
| 503 | `{ "error": "..." }` | DB unavailable |

**curl example:**
```bash
curl -s -X DELETE "https://forge-black-eta.vercel.app/api/worlds/WORLD_ID/assets/ASSET_UUID" \
  -H "Authorization: Bearer $FORGE_TOKEN"
```

---

### 4.8 POST `/api/uploads/sign` (extended for assets)

Presign an R2 PUT URL. The asset-specific behavior added in Phase 2 is documented here; for the full original endpoint see `docs/backend.md`.

**Auth:** Required. Active user (not suspended).

**Request body (for `kind: "asset"`):**
```ts
{
  kind: "asset",
  worldId: string,         // UUID of the world this asset belongs to (ownership check)
  assetId: string,         // UUID generated by the client — used for the R2 key
  contentType: "model/gltf-binary" | "model/gltf+json" | "application/octet-stream",
  sizeBytes: number,       // Positive integer, max 52428800 (50 MB)
}
```

**Response (200):**
```ts
{
  uploadUrl: string,       // Presigned R2 PUT URL (valid 10 minutes)
  objectKey: string,       // "assets/<clerkUserId>/<assetId>/asset.glb"
}
```

**Error codes:**

| Status | Condition |
|--------|-----------|
| 400 | Missing `assetId`, invalid content type, size exceeds 50 MB cap |
| 401 | Not signed in |
| 403 | Suspended, or `worldId` belongs to another user |
| 404 | `worldId` not found |

**curl example:**
```bash
curl -s -X POST "https://forge-black-eta.vercel.app/api/uploads/sign" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "kind": "asset",
    "worldId": "WORLD_UUID",
    "assetId": "ASSET_UUID",
    "contentType": "model/gltf-binary",
    "sizeBytes": 204800
  }'
```

---

## 5. Optimistic concurrency

The ops endpoint implements last-write-wins optimistic concurrency via the `baseVersionId` field. This prevents two concurrent editor sessions from silently overwriting each other's work.

### The protocol

1. Client bootstraps from `GET /scene-graph` and records `versionId` as its `baseVersionId`.
2. Client makes local edits, accumulates ops.
3. Client POSTs the batch to `/scene-graph/ops` with `baseVersionId`.
4. Server loads the base version and the **latest** version for the world inside a single transaction.
5. **If `latest.id === baseVersionId`** — no conflict. Server applies ops, inserts a new version, returns 200.
6. **If `latest.id !== baseVersionId`** — another write happened first. Server returns **409** with the full current version body.

### 409 response body

```ts
{
  error: "version conflict",
  currentVersion: {
    versionId: string,        // The version the client must rebase onto
    versionNumber: number,
    sceneGraph: SceneGraphV1 | null,
    status: "draft" | "published",
  }
}
```

### Rebase recipe

When a client receives a 409, the correct recovery is:

```
pseudocode:

receive 409 response with currentVersion
  currentGraph = currentVersion.sceneGraph    // the server's current state
  pendingOps = ops the client tried to apply  // what the client wanted to do

  // Attempt to replay pending ops on top of the server's current graph.
  // This may fail if, for example, the other editor deleted an object
  // that one of the pending ops tries to update.
  try:
    rebased = applyOps(currentGraph, pendingOps)
  catch OperationError(opIndex):
    // The conflicting op (at opIndex) cannot be applied.
    // Option A: drop the conflicting op and retry with the remaining ops.
    // Option B: surface a UI conflict dialog to the user.
    // Option C: discard pending ops entirely and reload from currentVersion.
    // The right choice is application-specific. The editor in 8.4 uses Option A.

  // Retry with the new base
  POST /scene-graph/ops {
    baseVersionId: currentVersion.versionId,
    ops: rebased ops,
  }
```

### Transaction rollback on 409

The 409 path is triggered by throwing a `VersionConflict` sentinel instance from inside the `dbPool.transaction()` callback. Drizzle rolls back the transaction on any throw. The sentinel is caught outside the transaction block to return the 409 response. This is the canonical "transaction aborts on business-rule violation" pattern in this codebase — the same shape used by the asset DELETE's integrity check.

---

## 6. Permission model

### Phase 2 (current)

Only the world owner (the user whose `users.id` matches `worlds.user_id`) has permission to write to a world's scene graph, assets, or versions. All read endpoints are public.

The permission check is performed by `requireWorldRole` in [`src/lib/world-permissions.ts`](../src/lib/world-permissions.ts):

```ts
const roleResult = await requireWorldRole(worldId, dbUser, "owner");
if (roleResult instanceof NextResponse) return roleResult;   // 404 or 403
const { world, role } = roleResult;
```

The function returns `{ world, role: "owner" }` on success, or a `NextResponse` (404 / 403 / 503) on failure. All four write endpoints in the scene-graph API use this helper.

### Phase 3 hint: editor/viewer roles

`requireWorldRole` is already designed for Phase 3 extension. The `WorldRole` type is `"owner" | "editor" | "viewer"` and a `ROLE_RANK` map orders them (`owner >= editor >= viewer`). The `requiredRole` parameter is the minimum acceptable role.

In Phase 3, the role-lookup block will be extended to query a `world_collaborators` table (not yet created) for `editor` and `viewer` roles. **All four write endpoints will require zero changes** — they already pass `"owner"` as `requiredRole`, and the helper's internal rank check handles the comparison.

A Blender plugin that only reads data (for preview rendering, for example) should pass `"viewer"` once Phase 3 ships, which will allow it to access private worlds where the plugin user has been given view access.

---

## 7. Versioning model

### Draft vs. published

Every call to `POST /scene-graph/ops` creates a new `world_versions` row with `status = "draft"`. Calling `POST /versions/[v]/publish` changes that row to `status = "published"` and updates `worlds.published_version_id`.

These are independent concerns:
- **Drafting** is continuous (every autosave creates a version).
- **Publishing** is intentional (the creator explicitly marks a version canonical).

### `worlds.scene_graph` semantics

`worlds.scene_graph` holds the result of the **latest ops batch** — whether draft or published. The ops endpoint writes it on every successful save:

```
worlds.scene_graph = applyOps(baseGraph, ops)
```

This means `worlds.scene_graph` is always the most recent draft graph. It is not "the published graph". For the published graph, the renderer should fetch `worlds.published_version_id` and then load the corresponding `world_versions.scene_graph`.

Simplified decision tree for a renderer:

```
if world.published_version_id is null:
  → legacy world; render world.glb_url
else:
  → fetch world_versions row for published_version_id
  → parse its sceneGraph; render the scene graph
```

The editor uses `GET /api/worlds/[id]/scene-graph` which returns the latest version (regardless of draft/published status) plus the `publishedVersionId` for context.

### `worlds.published_version_id` semantics

A NULL `published_version_id` means the world has never been explicitly published via the scene-graph API. These are called "legacy worlds" — they were created via `POST /api/worlds` with a GLB upload before Phase 2.

A non-NULL `published_version_id` points to the `world_versions` row that the creator last called publish on. Multiple versions can exist in draft; only one is the published snapshot.

### Never-pruned history

No version pruning exists in Phase 2. Every save is retained indefinitely. At the current autosave rate (one version per ops batch flush) a heavy editing session might produce 30–50 versions. At an estimated 50 KB average scene-graph size, that is ~2.5 MB per session — negligible compared to the `.glb` assets. This assumption will be revisited in Phase 5 if needed.

---

## 8. Asset model

### Upload flow (3 steps)

```
Step 1: Client → POST /api/uploads/sign
  Body: { kind: "asset", worldId, assetId, contentType, sizeBytes }
  Response: { uploadUrl, objectKey }

Step 2: Client → PUT <uploadUrl>
  Body: raw .glb bytes
  Headers: Content-Type: model/gltf-binary, Content-Length: <sizeBytes>
  Response: 200 (from R2 directly — the server never sees the bytes)

Step 3: Client → POST /api/worlds/[id]/assets
  Body: { assetId, name, sizeBytes }
  Response: 201 { id, name, glbUrl, sizeBytes, createdAt }
```

The server HEADs the R2 key between steps 2 and 3 to confirm the upload completed. If the HEAD returns `exists: false` (upload failed or never happened), the server returns 400. If the HEAD content-length does not match the declared `sizeBytes`, the server returns 400 with `expected` and `actual` values.

### R2 key layout

All asset objects live in the `forge-glb` bucket under an `assets/` prefix:

```
assets/{clerkUserId}/{assetId}/asset.glb
```

The Clerk user ID (not the DB user ID) is used in the path. This is deliberate: it aligns with how `buildAssetKey` is called in `uploads/sign` (where `auth().userId` is the Clerk ID). The server generates all keys — clients must not pick paths.

### 50 MB cap

Assets are capped at 50 MB (`52428800` bytes) — the same limit as the world-level GLB upload. This is enforced both in `uploads/sign` (presign refusal) and as a practical constraint on R2 presigned PUT conditions.

### Strict-delete integrity rule

An asset cannot be deleted if any `world_versions` row for the world references it. The reference check uses a text-cast LIKE query:

```sql
WHERE world_id = $worldId
  AND scene_graph::text LIKE '%"assetId":"<uuid>"%'
LIMIT 1
```

This intentionally scans all version rows (no GIN index on this path) because asset deletions are rare. A false positive (an asset UUID appearing in a `label` or `name` field by coincidence) would cause an unnecessary 409 but not a correctness bug.

**Implication for clients:** If you want to delete an asset that is referenced by old versions, you must first ensure no version uses it. The recommended workflow is:
1. `delete_object` (or `delete_spawn`) the reference from the scene graph via an ops batch.
2. Verify `GET /assets/[assetId]` is no longer referenced (or just check the 409 response body's `versionNumber` to identify the offending version).
3. Retry the DELETE.

Because history is never pruned in Phase 2, an asset referenced by any historical version (including drafts) cannot be deleted at all in the current implementation. Phase 5 will revisit this with an archival/prune mechanism.

### `scene_graph::text LIKE` performance note

The reference check performs a full sequential scan of `world_versions` rows for the world, casting `scene_graph` jsonb to text and applying a LIKE pattern. This is acceptable in Phase 2 (asset deletions are rare and per-world version counts are small). If version counts grow large (thousands of versions per world), switch to a GIN index with the `jsonb_path_exists` operator or a separate `asset_version_refs` join table.

---

## 9. Limits and caps

| Resource | Limit | Notes |
|----------|-------|-------|
| Ops per batch | 100 | `MAX_OPS_PER_BATCH = 100`. Enforced by `OpsBatchSchema`. |
| Asset file size | 50 MB (52428800 bytes) | Same as world GLB. Enforced at presign + HEAD check. |
| Assets per world (list) | 100 | GET `/assets` is capped at 100. The DB has no hard limit — the cap is a practical ceiling for Phase 2. |
| Version history | Unlimited | No pruning. ~2.5 MB growth per heavy session at 50 KB/version. |
| Ops batch `label` | 120 chars | Soft label on a version (optional). |
| `name` on add_object / update_object | 80 chars | Enforced by Zod. |
| `id` on add_object / add_spawn | 80 chars | Enforced by Zod. |
| Asset `name` in POST /assets | 120 chars | Enforced by Zod. |
| Idempotency on POST `/assets` | None | A duplicate `assetId` returns 503 (PK collision). Generate a fresh UUID per attempt. |
| Version list page size | 1..50, default 20 | Enforced by `QuerySchema` on GET `/versions`. |

---

## 10. Example flows

### 10.a Convert a legacy world to a scene-graph world

**Shipped in sub-slice 8.3.** Use `POST /api/worlds/[id]/convert-to-scene-graph` to bootstrap any legacy GLB-only world (one that has `worlds.scene_graph IS NULL`) into the Phase 2 scene-graph format.

The endpoint reuses the existing R2 object — no re-upload, no file copy.

```bash
export FORGE_TOKEN=<your __session JWT>
export WORLD_ID=<uuid of a legacy world you own>

curl -s -X POST "https://forge-black-eta.vercel.app/api/worlds/$WORLD_ID/convert-to-scene-graph" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Successful response (`200`):

```json
{
  "worldId": "550e8400-e29b-41d4-a716-446655440000",
  "sceneGraph": {
    "schemaVersion": 1,
    "objects": [
      {
        "id": "obj_base",
        "assetId": "<new world_assets uuid>",
        "name": "Base",
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      }
    ],
    "lights": [
      { "type": "ambient", "intensity": 0.5, "color": "#ffffff" },
      { "type": "sun", "intensity": 1, "direction": [5, 5, 5], "color": "#ffffff" }
    ],
    "environment": { "skybox": "studio", "fog": null },
    "spawnPoints": [{ "id": "default", "position": [0, 1.6, 5], "rotation": [0, 0, 0] }],
    "camera": { "position": [3, 3, 5], "target": [0, 0, 0], "fov": 50 }
  },
  "versionId": "<world_versions uuid>",
  "versionNumber": 1,
  "assetId": "<world_assets uuid>"
}
```

**What happens on the server (single transaction):**

1. A `world_assets` row is inserted, pointing at the world's existing `glb_url`. No upload, no R2 copy — the same object key is reused.
2. A 1-object `SceneGraphV1` document is built with the new `assetId`, placed at `[0, 0, 0]` as `"obj_base"`.
3. A `world_versions` row is inserted: `status = "published"`, `versionNumber = 1`, `parentVersionId = null`, `label = "Converted from legacy .glb"`.
4. `worlds.scene_graph` and `worlds.published_version_id` are set atomically. `worlds.glb_url` is intentionally kept as a safety reference — the legacy renderer is never invoked once `scene_graph` is non-null.

**After conversion** the world is a full scene-graph world. You can call `GET /scene-graph`, `POST /scene-graph/ops`, `GET /versions`, etc. The initial `"obj_base"` object can be repositioned or replaced using `update_object` or `set_object_asset` ops.

**Idempotency and errors:**

| Condition | Status | Body |
|-----------|--------|------|
| World already converted (`scene_graph IS NOT NULL`) | 409 | `{ "error": "world is already a scene graph", "sceneGraph": <existing> }` |
| World has no `glb_url` (defensive — shouldn't occur) | 400 | `{ "error": "world has no .glb to convert" }` |
| Not authenticated | 401 | `{ "error": "Unauthorized" }` |
| Not the world owner | 403 | `{ "error": "Forbidden" }` |
| World not found | 404 | `{ "error": "World not found" }` |

A second call to a world that has already been converted returns 409 — the conversion cannot be undone via API. The `"obj_base"` object can be deleted from the scene graph using a `delete_object` op if you want to start with an empty graph, but the version history and `world_assets` row are permanent.

---

### 10.b Place 5 objects, save as draft, then publish

```bash
export FORGE_TOKEN=<session token>
export WORLD_ID=<your world uuid>

# ---- Step 1: Upload 5 assets ----

for i in 1 2 3 4 5; do
  ASSET_ID=$(python3 -c "import uuid; print(uuid.uuid4())")
  SIGN=$(curl -s -X POST "http://localhost:3000/api/uploads/sign" \
    -H "Authorization: Bearer $FORGE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"kind\":\"asset\",\"worldId\":\"$WORLD_ID\",\"assetId\":\"$ASSET_ID\",\"contentType\":\"model/gltf-binary\",\"sizeBytes\":10240}")
  UPLOAD_URL=$(echo $SIGN | python3 -c "import sys,json; print(json.load(sys.stdin)['uploadUrl'])")

  # PUT your .glb file
  curl -s -X PUT "$UPLOAD_URL" \
    -H "Content-Type: model/gltf-binary" \
    --data-binary @"model_${i}.glb"

  # Finalize
  curl -s -X POST "http://localhost:3000/api/worlds/$WORLD_ID/assets" \
    -H "Authorization: Bearer $FORGE_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"assetId\":\"$ASSET_ID\",\"name\":\"Model $i\",\"sizeBytes\":10240}"

  ASSET_IDS[$i]=$ASSET_ID
done

# ---- Step 2: Get the base version ----

SCENE=$(curl -s "http://localhost:3000/api/worlds/$WORLD_ID/scene-graph")
BASE_VERSION_ID=$(echo $SCENE | python3 -c "import sys,json; print(json.load(sys.stdin)['versionId'] or '')")

# ---- Step 3: Place all 5 objects in one batch ----

OPS=$(python3 -c "
import json, sys
asset_ids = sys.argv[1:]
ops = [
  {'op':'add_object','assetId':a,'name':f'Model {i+1}','position':[i*3,0,0]}
  for i,a in enumerate(asset_ids)
]
print(json.dumps(ops))
" "${ASSET_IDS[@]}")

SAVE=$(curl -s -X POST "http://localhost:3000/api/worlds/$WORLD_ID/scene-graph/ops" \
  -H "Authorization: Bearer $FORGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"baseVersionId\":\"$BASE_VERSION_ID\",\"ops\":$OPS,\"label\":\"Place 5 models\"}")

NEW_VERSION_ID=$(echo $SAVE | python3 -c "import sys,json; print(json.load(sys.stdin)['versionId'])")
echo "Draft saved as version $NEW_VERSION_ID"

# ---- Step 4: Publish ----

curl -s -X POST "http://localhost:3000/api/worlds/$WORLD_ID/versions/$NEW_VERSION_ID/publish" \
  -H "Authorization: Bearer $FORGE_TOKEN"
# → { "versionId": "...", "versionNumber": N, "status": "published" }
```

---

### 10.c Detect and recover from a 409 conflict

Two editor sessions editing the same world concurrently:

```bash
# Session A and Session B both bootstrap from version V1:
#   Session A: baseVersionId = V1
#   Session B: baseVersionId = V1

# Session A saves first, creating V2:
curl -X POST ".../scene-graph/ops" \
  -d '{"baseVersionId":"V1", "ops":[{"op":"add_object","assetId":"A1","position":[0,0,0]}]}'
# → 200 { "versionId": "V2", ... }

# Session B tries to save on top of V1 — but V2 now exists:
curl -X POST ".../scene-graph/ops" \
  -d '{"baseVersionId":"V1", "ops":[{"op":"add_object","assetId":"A2","position":[5,0,0]}]}'
# → 409 {
#     "error": "version conflict",
#     "currentVersion": {
#       "versionId": "V2",
#       "versionNumber": 2,
#       "sceneGraph": { ... with A1 placed at [0,0,0] ... },
#       "status": "draft"
#     }
#   }

# Session B rebase: try to apply its pending ops on top of currentVersion.sceneGraph
# (In this case there is no conflict — A2 at [5,0,0] doesn't touch A1)
curl -X POST ".../scene-graph/ops" \
  -d '{
    "baseVersionId": "V2",
    "ops": [{"op":"add_object","assetId":"A2","position":[5,0,0]}]
  }'
# → 200 { "versionId": "V3", "versionNumber": 3, ... }
# Both A1 and A2 are now in the scene.
```

---

## 11. Example clients

### 11.a Folder-watcher CLI (`scripts/forge-watch.ts`)

The folder-watcher is the reference implementation of this API for non-browser clients. It demonstrates:

- Cookie-based auth (`Cookie: __session=<value>`) — the same mechanism any non-browser Node script can use
- The complete asset upload flow: `POST /uploads/sign` → `PUT <uploadUrl>` → `POST /assets`
- Optimistic concurrency: reading `versionId` from `GET /scene-graph`, passing it as `baseVersionId`, handling 409 by retrying with `currentVersion.versionId`
- The `set_object_asset` op for identity-preserving asset swap-in-place
- Serialized operation queuing — never posting concurrent ops batches to the same world

**Invocation:**
```bash
npm run forge:watch -- \
  --world-id=<uuid> \
  --folder=<local-path> \
  --session=<clerk-session-cookie> \
  [--base-url=http://localhost:3000]
```

See `scripts/forge-watch.md` for the full user guide including how to extract the `__session` cookie from browser DevTools.

**What an external client needs to implement (illustrated by this CLI):**

1. Bootstrap: `GET /scene-graph` → record `versionId` as the local "base version"
2. For each asset: `POST /uploads/sign` (kind=asset, worldId, assetId) → `PUT uploadUrl` → `POST /assets`
3. For each scene mutation: `POST /scene-graph/ops` with `{ ops, baseVersionId }` → on 200, advance local `baseVersionId`; on 409, re-read `currentVersion.versionId`, rebase pending ops, retry
4. To publish: `POST /versions/[versionId]/publish`

**Auth for non-browser clients (v1):**

All API routes accept `Cookie: __session=<jwt>` in addition to `Authorization: Bearer <jwt>`. The Clerk middleware treats both identically. Copy the `__session` cookie value from browser DevTools and pass it either way.

---

## 12. Implementation locations

Clickable paths for source navigation:

| Component | Path |
|-----------|------|
| Scene graph Zod schema + helpers | [`src/lib/scene-graph/schema.ts`](../src/lib/scene-graph/schema.ts) |
| Operations reducer + op schemas | [`src/lib/scene-graph/operations.ts`](../src/lib/scene-graph/operations.ts) |
| World permission helper | [`src/lib/world-permissions.ts`](../src/lib/world-permissions.ts) |
| GET /scene-graph | [`src/app/api/worlds/[id]/scene-graph/route.ts`](../src/app/api/worlds/%5Bid%5D/scene-graph/route.ts) |
| POST /scene-graph/ops | [`src/app/api/worlds/[id]/scene-graph/ops/route.ts`](../src/app/api/worlds/%5Bid%5D/scene-graph/ops/route.ts) |
| GET /versions | [`src/app/api/worlds/[id]/versions/route.ts`](../src/app/api/worlds/%5Bid%5D/versions/route.ts) |
| POST /versions/[v]/publish | [`src/app/api/worlds/[id]/versions/[v]/publish/route.ts`](../src/app/api/worlds/%5Bid%5D/versions/%5Bv%5D/publish/route.ts) |
| GET + POST /assets | [`src/app/api/worlds/[id]/assets/route.ts`](../src/app/api/worlds/%5Bid%5D/assets/route.ts) |
| DELETE /assets/[assetId] | [`src/app/api/worlds/[id]/assets/[assetId]/route.ts`](../src/app/api/worlds/%5Bid%5D/assets/%5BassetId%5D/route.ts) |
| POST /uploads/sign (modified for assets) | [`src/app/api/uploads/sign/route.ts`](../src/app/api/uploads/sign/route.ts) |
| POST /convert-to-scene-graph | [`src/app/api/worlds/[id]/convert-to-scene-graph/route.ts`](../src/app/api/worlds/%5Bid%5D/convert-to-scene-graph/route.ts) |
| DB schema | [`src/db/schema.ts`](../src/db/schema.ts) |
| Phase 2.2 migration | [`drizzle/0011_phase2_scene_graph_api.sql`](../drizzle/0011_phase2_scene_graph_api.sql) |
| Phase 2.1 migration | [`drizzle/0010_phase2_scene_graph_foundation.sql`](../drizzle/0010_phase2_scene_graph_foundation.sql) |
| R2 helpers (buildAssetKey, deleteObject) | [`src/lib/r2.ts`](../src/lib/r2.ts) |
