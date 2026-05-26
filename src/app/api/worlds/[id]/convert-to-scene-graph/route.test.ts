import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting — must be hoisted above any import of the route module
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockRequireWorldRole,
  mockTransaction,
  // Spies into the fake tx object operations
  mockTxSelect,
  mockTxInsert,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  mockRequireWorldRole: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxSelect: vi.fn(),
  mockTxInsert: vi.fn(),
  mockTxUpdate: vi.fn(),
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

// Mock @/db — only dbPool.transaction is used by this route.
vi.mock("@/db", () => ({
  dbPool: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

import { POST } from "./route";
import { worlds, worldAssets, worldVersions } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const ASSET_UUID = "aa0e8400-e29b-41d4-a716-446655440001";
const VERSION_UUID = "bb0e8400-e29b-41d4-a716-446655440002";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";
const GLB_URL = "https://pub-xxx.r2.dev/worlds/user-1/world-1/world.glb";

const DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

// A legacy world row — no scene_graph, has glb_url
const LEGACY_WORLD = {
  id: WORLD_UUID,
  userId: DB_USER_ID,
  title: "My World",
  description: null,
  glbUrl: GLB_URL,
  glbSizeBytes: 1024,
  likesCount: 0,
  views: 0,
  createdAt: new Date("2026-01-01"),
  sceneGraph: null,
  publishedVersionId: null,
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callPost(worldId: string) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/convert-to-scene-graph`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Fake transaction builder
//
// The route calls, in order:
//   1. tx.select().from(worlds).where(...).limit(1)  — re-fetch world
//   2. tx.insert(worldAssets).values(...).returning({ id })
//   3. tx.insert(worldVersions).values(...).returning({ id, versionNumber })
//   4. tx.update(worlds).set(...).where(...)
// ---------------------------------------------------------------------------

function makeFakeTx(options: {
  freshWorld?: typeof LEGACY_WORLD | null;
  assetId?: string;
  versionId?: string;
  versionNumber?: number;
} = {}) {
  const {
    freshWorld = LEGACY_WORLD,
    assetId = ASSET_UUID,
    versionId = VERSION_UUID,
    versionNumber = 1,
  } = options;

  // Track which table is being inserted into so we can return the right shape
  let insertCallCount = 0;

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            mockTxSelect(worlds);
            return Promise.resolve(freshWorld ? [freshWorld] : []);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: (_cols: unknown) => {
          insertCallCount++;
          mockTxInsert(table, values);
          if (insertCallCount === 1) {
            // First insert = worldAssets
            return Promise.resolve([{ id: assetId }]);
          } else {
            // Second insert = worldVersions
            return Promise.resolve([{ id: versionId, versionNumber }]);
          }
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          mockTxUpdate(table, values);
          return Promise.resolve();
        },
      }),
    }),
  };
}

// Standard authenticated + owner happy-path setup
function setupAuth() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue({
    id: CLERK_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
  mockRequireWorldRole.mockResolvedValue({
    world: LEGACY_WORLD,
    role: "owner",
  });
}

// ---------------------------------------------------------------------------
// Test 1 — 401 when not authenticated
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/convert-to-scene-graph — 401 unauthenticated", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(WORLD_UUID);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — 403 when not owner
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/convert-to-scene-graph — 403 not owner", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireWorldRole returns a 403 NextResponse", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // Not the world owner — requireWorldRole returns a 403
    mockRequireWorldRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPost(WORLD_UUID);

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — 409 when world already has a scene graph
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/convert-to-scene-graph — 409 already converted", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 409 with existing sceneGraph when world.sceneGraph is non-null", async () => {
    const existingSceneGraph = {
      schemaVersion: 1,
      objects: [{ id: "obj_base", assetId: ASSET_UUID, position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      lights: [
        { type: "ambient", intensity: 0.5, color: "#ffffff" },
        { type: "sun", intensity: 1, direction: [5, 5, 5], color: "#ffffff" },
      ],
      environment: { skybox: "studio", fog: null },
      spawnPoints: [{ id: "default", position: [0, 1.6, 5], rotation: [0, 0, 0] }],
      camera: { position: [3, 3, 5], target: [0, 0, 0], fov: 50 },
    };

    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // requireWorldRole returns a world that already has a scene graph
    mockRequireWorldRole.mockResolvedValue({
      world: { ...LEGACY_WORLD, sceneGraph: existingSceneGraph },
      role: "owner",
    });

    const res = await callPost(WORLD_UUID);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("world is already a scene graph");
    expect(body.sceneGraph).toBeTruthy();
    expect(body.sceneGraph.schemaVersion).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — 400 when world has no glbUrl (defensive case)
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/convert-to-scene-graph — 400 no glbUrl", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when the world has no glbUrl", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // requireWorldRole returns a world without a glbUrl
    const worldWithoutGlb = { ...LEGACY_WORLD, glbUrl: null as unknown as string, glbSizeBytes: 0 };
    mockRequireWorldRole.mockResolvedValue({
      world: worldWithoutGlb,
      role: "owner",
    });

    const res = await callPost(WORLD_UUID);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("world has no .glb to convert");
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Happy path
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/convert-to-scene-graph — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with { worldId, sceneGraph, versionId, versionNumber, assetId }", async () => {
    setupAuth();
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worldId).toBe(WORLD_UUID);
    expect(body.assetId).toBe(ASSET_UUID);
    expect(body.versionId).toBe(VERSION_UUID);
    expect(body.versionNumber).toBe(1);
    expect(body.sceneGraph).toBeTruthy();
    expect(body.sceneGraph.schemaVersion).toBe(1);
    // The initial scene graph must have exactly one object — the base GLB
    expect(body.sceneGraph.objects).toHaveLength(1);
    expect(body.sceneGraph.objects[0].id).toBe("obj_base");
    expect(body.sceneGraph.objects[0].assetId).toBe(ASSET_UUID);
  });

  it("inserts a world_assets row reusing the existing glbUrl", async () => {
    setupAuth();
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    await callPost(WORLD_UUID);

    // The first insert call should target worldAssets with the existing glbUrl
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldAssets,
      expect.objectContaining({
        worldId: WORLD_UUID,
        uploaderId: DB_USER_ID,
        glbUrl: GLB_URL,
        kind: "glb",
      })
    );
  });

  it("inserts a world_versions row with status=published, versionNumber=1, parentVersionId=null", async () => {
    setupAuth();
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    await callPost(WORLD_UUID);

    // The second insert call should target worldVersions
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldVersions,
      expect.objectContaining({
        worldId: WORLD_UUID,
        authorId: DB_USER_ID,
        status: "published",
        versionNumber: 1,
        parentVersionId: null,
      })
    );
  });

  it("updates worlds with sceneGraph and publishedVersionId", async () => {
    setupAuth();
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    await callPost(WORLD_UUID);

    expect(mockTxUpdate).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({
        sceneGraph: expect.any(Object),
        publishedVersionId: VERSION_UUID,
      })
    );
  });
});
