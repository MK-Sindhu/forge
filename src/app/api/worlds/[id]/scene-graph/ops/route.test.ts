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
  mockTransaction,
  // Spies into the fake tx object
  mockTxInsert,
  mockTxUpdate,
  // Controls what tx.query.worldVersions.findFirst returns per call
  mockTxFindFirst,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  // External boundary: requireWorldRole hits the DB; mocked at module level so
  // tests can inject a pass or a 403/404 NextResponse without a real DB.
  mockRequireWorldRole: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxInsert: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockTxFindFirst: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mocking requireWorldRole directly is cleaner than mocking the underlying
// db.select() chain because the helper's own behavior is already unit-tested
// in src/lib/world-permissions.test.ts.
vi.mock("@/lib/world-permissions", () => ({
  requireWorldRole: mockRequireWorldRole,
}));

// Mock @/db — only dbPool.transaction is used by the ops route.
vi.mock("@/db", () => ({
  dbPool: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

import { POST } from "./route";
import { worldVersions, worlds } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const BASE_VERSION_UUID = "660e8400-e29b-41d4-a716-446655440001";
const NEW_VERSION_UUID = "770e8400-e29b-41d4-a716-446655440002";
const LATEST_VERSION_UUID = "880e8400-e29b-41d4-a716-446655440003";
const ASSET_UUID = "990e8400-e29b-41d4-a716-446655440004";
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

// A minimal but valid v1 scene graph stored in the base version row
const BASE_SCENE_GRAPH = {
  schemaVersion: 1,
  objects: [],
  lights: [
    { type: "ambient", intensity: 0.5, color: "#ffffff" },
    { type: "sun", intensity: 1, direction: [5, 5, 5], color: "#ffffff" },
  ],
  environment: { skybox: "studio", fog: null },
  spawnPoints: [{ id: "default", position: [0, 1.6, 5], rotation: [0, 0, 0] }],
  camera: { position: [3, 3, 5], target: [0, 0, 0], fov: 50 },
};

// Base version row returned by tx.query.worldVersions.findFirst for base lookup
const BASE_VERSION_ROW = {
  id: BASE_VERSION_UUID,
  worldId: WORLD_UUID,
  versionNumber: 1,
  sceneGraph: BASE_SCENE_GRAPH,
  status: "draft",
  authorId: DB_USER_ID,
  parentVersionId: null,
  label: null,
  createdAt: new Date("2026-01-01"),
};

// A valid add_object op that references the ASSET_UUID
const VALID_OP = {
  op: "add_object",
  assetId: ASSET_UUID,
  name: "myBox",
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callPost(worldId: string, body: unknown) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/scene-graph/ops`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Fake transaction builder
//
// The ops route uses two tx.query.worldVersions.findFirst calls:
//   call 1: load base version (by id + worldId)
//   call 2: load latest version for this world
// mockTxFindFirst.mockResolvedValueOnce controls each call independently.
//
// The route then uses tx.insert().values().returning() and tx.update().set().where().
// ---------------------------------------------------------------------------

function makeFakeTx(newVersionId = NEW_VERSION_UUID, newVersionNumber = 2) {
  return {
    query: {
      worldVersions: {
        findFirst: (...args: unknown[]) => mockTxFindFirst(...args),
      },
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: (_cols: unknown) => {
          mockTxInsert(table, values);
          return Promise.resolve([
            { id: newVersionId, versionNumber: newVersionNumber },
          ]);
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

// Sets up a standard happy-path scenario.
function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue({
    id: CLERK_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
  // requireWorldRole returns success
  mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
  // Transaction: call 1 = base version, call 2 = latest (same row = no conflict)
  mockTxFindFirst
    .mockResolvedValueOnce(BASE_VERSION_ROW) // base
    .mockResolvedValueOnce(BASE_VERSION_ROW); // latest === base → no conflict
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeFakeTx())
  );
}

// ---------------------------------------------------------------------------
// Block A — Auth checks
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(res.status).toBe(401);
  });

  it("returns 403 when requireWorldRole returns a 403 NextResponse", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // Not the world owner → 403
    mockRequireWorldRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Block B — Validation
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — body validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when ops array is empty (min 1 op required)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [], // empty — invalid
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when ops array exceeds 100 items", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });

    // Build 101 valid add_object ops (each with a unique asset uuid)
    const ops = Array.from({ length: 101 }, () => ({
      op: "add_object",
      assetId: ASSET_UUID,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }));

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops,
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when baseVersionId is missing from body", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });

    const res = await callPost(WORLD_UUID, {
      // baseVersionId intentionally omitted
      ops: [VALID_OP],
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Block C — 404 when baseVersionId not found
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — 404 paths", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when baseVersionId is not found for this world", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });

    // Transaction: base lookup returns nothing — version not found on this world
    mockTxFindFirst.mockResolvedValueOnce(undefined);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Block D — 409 version conflict
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — version conflict (409)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 409 with currentVersion body when a newer version exists", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });

    // Transaction: base found, but latest is a different (newer) version
    const latestVersionRow = {
      ...BASE_VERSION_ROW,
      id: LATEST_VERSION_UUID, // different id → conflict
      versionNumber: 2,
    };

    mockTxFindFirst
      .mockResolvedValueOnce(BASE_VERSION_ROW) // base version found
      .mockResolvedValueOnce(latestVersionRow); // latest is newer → conflict

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("version conflict");
    expect(body.currentVersion).toBeTruthy();
    expect(body.currentVersion.versionId).toBe(LATEST_VERSION_UUID);
    expect(body.currentVersion.versionNumber).toBe(2);
    expect(body.currentVersion.status).toBe("draft");
  });
});

// ---------------------------------------------------------------------------
// Block E — 400 invalid op (OperationError with opIndex)
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — invalid op (400 with opIndex)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 with opIndex when update_object references a non-existent object id", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });

    // base and latest are both the BASE_VERSION_ROW (no conflict)
    // But the ops include update_object on a non-existent id
    mockTxFindFirst
      .mockResolvedValueOnce(BASE_VERSION_ROW)
      .mockResolvedValueOnce(BASE_VERSION_ROW);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const ops = [
      VALID_OP, // opIndex 0 — valid add_object
      {
        op: "update_object",
        id: "non-existent-obj-id",
        patch: { name: "renamed" },
      }, // opIndex 1 — this fails
    ];

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.opIndex).toBe("number");
    expect(body.opIndex).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Block F — Editor (non-owner collaborator) access
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — editor collaborator", () => {
  beforeEach(() => vi.resetAllMocks());

  it("editor (non-owner collaborator) can post ops and authorId reflects the editor's id", async () => {
    // The caller is NOT the world owner — this is a collaborator with editor role.
    // requireWorldRole is mocked to return role:"editor" (the gate has been relaxed
    // from owner-only to editor-or-above in Chunk 4).
    const EDITOR_CLERK_ID = "clerk_editor_xyz";
    const EDITOR_DB_ID = "db-uuid-editor-001";
    const OWNER_DB_ID = "db-uuid-owner-999"; // world.userId — DIFFERENT from editor

    const editorDbUser = {
      id: EDITOR_DB_ID,
      clerkId: EDITOR_CLERK_ID,
      username: "editor",
      email: "editor@example.com",
      avatarUrl: null,
      createdAt: new Date("2026-01-01"),
      tosAcceptedAt: null,
    };

    mockAuth.mockResolvedValue({ userId: EDITOR_CLERK_ID });
    mockCurrentUser.mockResolvedValue({
      id: EDITOR_CLERK_ID,
      username: "editor",
      emailAddresses: [{ emailAddress: "editor@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(editorDbUser);

    // requireWorldRole returns editor role — caller is a collaborator, NOT the owner
    mockRequireWorldRole.mockResolvedValue({
      world: { id: WORLD_UUID, userId: OWNER_DB_ID }, // world.userId is owner's id, not editor's
      role: "editor",
    });

    // Transaction: call 1 = base version, call 2 = latest (same row = no conflict)
    mockTxFindFirst
      .mockResolvedValueOnce(BASE_VERSION_ROW)
      .mockResolvedValueOnce(BASE_VERSION_ROW);
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    // 200 happy path — editor gate passes (editor rank >= editor)
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versionId).toBe(NEW_VERSION_UUID);
    expect(body.sceneGraph).toBeTruthy();

    // world_versions row must be authored by the EDITOR, not the world owner.
    // This confirms the route passes dbUser.id (the collaborator) as authorId,
    // not world.userId (the owner).
    expect(mockTxInsert).toHaveBeenCalledOnce();
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldVersions,
      expect.objectContaining({
        authorId: EDITOR_DB_ID, // editor's id — not the owner's id
        worldId: WORLD_UUID,
      })
    );

    // worlds.scene_graph update must also be called
    expect(mockTxUpdate).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ sceneGraph: expect.any(Object) })
    );
  });
});

// ---------------------------------------------------------------------------
// Block G — Happy path
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/scene-graph/ops — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with { versionId, versionNumber, sceneGraph } on success", async () => {
    setupHappyPath();

    const res = await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versionId).toBe(NEW_VERSION_UUID);
    expect(body.versionNumber).toBe(2);
    expect(body.sceneGraph).toBeTruthy();
    expect(body.sceneGraph.schemaVersion).toBe(1);
    // The added object must appear in the scene graph
    expect(body.sceneGraph.objects).toHaveLength(1);
    expect(body.sceneGraph.objects[0].assetId).toBe(ASSET_UUID);
  });

  it("inserts a new world_versions row inside the transaction", async () => {
    setupHappyPath();

    await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(mockTxInsert).toHaveBeenCalledOnce();
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldVersions,
      expect.objectContaining({
        worldId: WORLD_UUID,
        status: "draft",
        parentVersionId: BASE_VERSION_UUID,
        authorId: DB_USER_ID,
      })
    );
  });

  it("updates worlds.scene_graph to the new applied graph", async () => {
    setupHappyPath();

    await callPost(WORLD_UUID, {
      baseVersionId: BASE_VERSION_UUID,
      ops: [VALID_OP],
    });

    expect(mockTxUpdate).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ sceneGraph: expect.any(Object) })
    );
  });
});
