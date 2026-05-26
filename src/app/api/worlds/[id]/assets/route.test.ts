import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockRequireWorldRole,
  mockDbSelectLimit,
  mockDbFindMany,
  mockDbInsertReturning,
  mockHeadObject,
  mockPublicUrlFor,
  mockBuildAssetKey,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  // Mocked at module level — helper already tested in world-permissions.test.ts
  mockRequireWorldRole: vi.fn(),
  // db.select().from().where().limit() — world existence check (GET path)
  mockDbSelectLimit: vi.fn(),
  // db.query.worldAssets.findMany() — asset list query (GET path)
  mockDbFindMany: vi.fn(),
  // db.insert(worldAssets).values().returning() — asset row insert (POST path)
  mockDbInsertReturning: vi.fn(),
  // External boundary: headObject calls R2 — not available in test runner
  mockHeadObject: vi.fn(),
  // External boundary: publicUrlFor resolves bucket env var — mocked for determinism
  mockPublicUrlFor: vi.fn(),
  // buildAssetKey is pure but mocked to control the objectKey value in tests
  mockBuildAssetKey: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

vi.mock("@/lib/world-permissions", () => ({
  requireWorldRole: mockRequireWorldRole,
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
    query: {
      worldAssets: {
        findMany: (...args: unknown[]) => mockDbFindMany(...args),
      },
    },
    insert: () => ({
      values: () => ({
        returning: (_cols: unknown) => mockDbInsertReturning(),
      }),
    }),
  },
}));

vi.mock("@/lib/r2", () => ({
  buildAssetKey: mockBuildAssetKey,
  headObject: mockHeadObject,
  publicUrlFor: mockPublicUrlFor,
}));

import { GET, POST } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const ASSET_UUID = "660e8400-e29b-41d4-a716-446655440001";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";

const DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const FAKE_GLB_URL = "https://cdn.example.com/assets/clerk_user_abc123/660e8400-e29b-41d4-a716-446655440001/asset.glb";
const FAKE_OBJECT_KEY = "assets/clerk_user_abc123/660e8400-e29b-41d4-a716-446655440001/asset.glb";
const ASSET_SIZE_BYTES = 512_000;

const ASSET_ROW = {
  id: ASSET_UUID,
  name: "myBox",
  glbUrl: FAKE_GLB_URL,
  glbSizeBytes: ASSET_SIZE_BYTES,
  createdAt: new Date("2026-01-01"),
};

function callGet(worldId: string) {
  const req = new Request(`http://localhost/api/worlds/${worldId}/assets`);
  return GET(req, { params: Promise.resolve({ id: worldId }) });
}

function callPost(worldId: string, body: unknown) {
  const req = new Request(`http://localhost/api/worlds/${worldId}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// GET tests
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id]/assets — list shape", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns an assets array with the expected shape", async () => {
    mockDbSelectLimit.mockResolvedValue([{ id: WORLD_UUID }]);
    mockDbFindMany.mockResolvedValue([ASSET_ROW]);

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assets).toHaveLength(1);
    const a = body.assets[0];
    expect(a.id).toBe(ASSET_UUID);
    expect(a.name).toBe("myBox");
    expect(a.glbUrl).toBe(FAKE_GLB_URL);
    // Column is remapped: glbSizeBytes → sizeBytes in the response
    expect(a.sizeBytes).toBe(ASSET_SIZE_BYTES);
    expect(typeof a.createdAt).toBe("string");
    // The raw column name must not leak
    expect(a).not.toHaveProperty("glbSizeBytes");
  });

  it("returns 404 when the world does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST tests — auth + permissions
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/assets — auth + permissions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(WORLD_UUID, {
      assetId: ASSET_UUID,
      name: "myBox",
      sizeBytes: ASSET_SIZE_BYTES,
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when requireWorldRole returns a 403 NextResponse (non-owner)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPost(WORLD_UUID, {
      assetId: ASSET_UUID,
      name: "myBox",
      sizeBytes: ASSET_SIZE_BYTES,
    });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST tests — R2 existence check
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/assets — R2 existence check", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when R2 HEAD reports asset not uploaded (exists: false)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
    mockBuildAssetKey.mockReturnValue(FAKE_OBJECT_KEY);
    mockHeadObject.mockResolvedValue({ exists: false }); // not uploaded

    const res = await callPost(WORLD_UUID, {
      assetId: ASSET_UUID,
      name: "myBox",
      sizeBytes: ASSET_SIZE_BYTES,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not uploaded/i);
  });

  it("returns 400 when R2 HEAD contentLength mismatches the declared sizeBytes", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
    mockBuildAssetKey.mockReturnValue(FAKE_OBJECT_KEY);
    // R2 says 999 bytes, client says ASSET_SIZE_BYTES — mismatch
    mockHeadObject.mockResolvedValue({ exists: true, contentLength: 999, contentType: "model/gltf-binary" });

    const res = await callPost(WORLD_UUID, {
      assetId: ASSET_UUID,
      name: "myBox",
      sizeBytes: ASSET_SIZE_BYTES,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/size mismatch/i);
  });
});

// ---------------------------------------------------------------------------
// POST tests — happy path
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/assets — happy path (201)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 201 with { id, name, glbUrl, sizeBytes, createdAt } after insert", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
    mockBuildAssetKey.mockReturnValue(FAKE_OBJECT_KEY);
    mockHeadObject.mockResolvedValue({
      exists: true,
      contentLength: ASSET_SIZE_BYTES,
      contentType: "model/gltf-binary",
    });
    mockPublicUrlFor.mockReturnValue(FAKE_GLB_URL);
    mockDbInsertReturning.mockResolvedValue([ASSET_ROW]);

    const res = await callPost(WORLD_UUID, {
      assetId: ASSET_UUID,
      name: "myBox",
      sizeBytes: ASSET_SIZE_BYTES,
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(ASSET_UUID);
    expect(body.name).toBe("myBox");
    expect(body.glbUrl).toBe(FAKE_GLB_URL);
    expect(body.sizeBytes).toBe(ASSET_SIZE_BYTES);
    expect(typeof body.createdAt).toBe("string");
  });
});
