/**
 * route.test.ts — GET + POST /api/worlds/[id]/collaborators
 *
 * GET is public (no auth). Returns owner + collaborators list.
 * POST is owner-only. Invites a user by username as editor collaborator.
 *
 * Mock strategy:
 *  - @clerk/nextjs/server — Clerk requires live cookies + network; mocked.
 *  - @/lib/users — crosses DB boundary; mocked at module level.
 *  - @/lib/world-permissions — requireWorldRole is unit-tested in
 *    world-permissions.test.ts; mocked here so route tests can inject pass/fail
 *    without re-testing the helper's own responsibility.
 *  - @/db — no live DATABASE_URL in the test runner; db.query.* + dbPool
 *    both mocked. db.query uses relational helpers (findFirst / findMany).
 *    dbPool.transaction receives the real callback with a fake tx object.
 *  - @/lib/notifications — notify() is fire-and-forget post-commit;
 *    mocked so we can assert it was called without a live DB.
 *
 * Warning: do NOT put the jsdom environment directive in comments here.
 * Vitest scans comment text for environment directives; jsdom is not installed
 * and its presence crashes the worker. Default env is node — no DOM needed.
 */

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
  mockFindFirstWorlds,
  mockFindManyCollabs,
  mockTransaction,
  mockTxSelect,
  mockTxInsert,
  mockNotify,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  // External boundary: requireWorldRole hits the DB; mocked at module level so
  // tests inject a pass or 403/404 NextResponse without a real DB.
  mockRequireWorldRole: vi.fn(),
  // db.query.worlds.findFirst (GET — world with owner user relation)
  mockFindFirstWorlds: vi.fn(),
  // db.query.worldCollaborators.findMany (GET — collaborator rows)
  mockFindManyCollabs: vi.fn(),
  // dbPool.transaction (POST)
  mockTransaction: vi.fn(),
  // Inside tx: tx.select()...limit() is called twice per POST (target user lookup + dupe check)
  mockTxSelect: vi.fn(),
  // Inside tx: tx.insert().values().returning()
  mockTxInsert: vi.fn(),
  // @/lib/notifications notify()
  mockNotify: vi.fn(),
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

// Mock @/db.
// GET handler uses:
//   db.query.worlds.findFirst (world + owner relation)
//   db.query.worldCollaborators.findMany (collaborator list)
// POST handler uses:
//   dbPool.transaction(tx => ...) with:
//     tx.select().from(users).where(...).limit(1)     — target user lookup
//     tx.select().from(worldCollaborators).where(...).limit(1) — dupe check
//     tx.insert(worldCollaborators).values().returning()       — insert
vi.mock("@/db", () => ({
  db: {
    query: {
      worlds: {
        findFirst: (...args: unknown[]) => mockFindFirstWorlds(...args),
      },
      worldCollaborators: {
        findMany: (...args: unknown[]) => mockFindManyCollabs(...args),
      },
    },
  },
  dbPool: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

vi.mock("@/lib/notifications", () => ({
  notify: mockNotify,
}));

import { GET, POST } from "./route";
import { worldCollaborators } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_UUID = "660e8400-e29b-41d4-a716-446655440001";
const COLLAB_UUID = "770e8400-e29b-41d4-a716-446655440002";
const COLLAB2_UUID = "880e8400-e29b-41d4-a716-446655440003";
const CLERK_USER_ID = "clerk_user_abc123";

const DB_USER = {
  id: OWNER_UUID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

// World row with nested user relation (as returned by db.query.worlds.findFirst with { with: { user } })
const WORLD_WITH_OWNER = {
  id: WORLD_UUID,
  userId: OWNER_UUID,
  title: "Test World",
  description: null,
  glbUrl: "https://r2.example.com/world.glb",
  glbSizeBytes: 1024,
  likesCount: 0,
  views: 0,
  createdAt: new Date("2026-01-01"),
  sceneGraph: null,
  publishedVersionId: null,
  user: {
    id: OWNER_UUID,
    username: "alice",
    avatarUrl: "https://r2.example.com/alice.jpg",
  },
};

// Two collaborator rows with nested user + addedBy relations
const ADDED_AT_1 = new Date("2026-02-01");
const ADDED_AT_2 = new Date("2026-03-01");

const COLLAB_ROW_1 = {
  worldId: WORLD_UUID,
  userId: COLLAB_UUID,
  role: "editor",
  addedAt: ADDED_AT_1,
  addedById: OWNER_UUID,
  user: { id: COLLAB_UUID, username: "bob", avatarUrl: null },
  addedBy: { id: OWNER_UUID, username: "alice" },
};

const COLLAB_ROW_2 = {
  worldId: WORLD_UUID,
  userId: COLLAB2_UUID,
  role: "editor",
  addedAt: ADDED_AT_2,
  addedById: OWNER_UUID,
  user: { id: COLLAB2_UUID, username: "carol", avatarUrl: "https://r2.example.com/carol.jpg" },
  addedBy: { id: OWNER_UUID, username: "alice" },
};

// ---------------------------------------------------------------------------
// Route call helpers
// ---------------------------------------------------------------------------

function callGet(worldId: string) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/collaborators`
  );
  return GET(req, { params: Promise.resolve({ id: worldId }) });
}

function callPost(worldId: string, body: unknown) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/collaborators`,
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
// The POST route uses two tx.select()...limit() calls inside the transaction:
//   call 1 — target user lookup (users table)
//   call 2 — dupe check (worldCollaborators table)
// Then tx.insert(worldCollaborators).values().returning()
//
// A per-test call counter routes each limit() call to mockTxSelect using
// mockResolvedValueOnce queuing.
// ---------------------------------------------------------------------------

function makeFakeTx() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockTxSelect(...args),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          mockTxInsert(table, values);
          const addedAt = new Date("2026-05-01");
          return Promise.resolve([
            {
              worldId: WORLD_UUID,
              userId: COLLAB_UUID,
              role: "editor",
              addedAt,
              addedById: OWNER_UUID,
            },
          ]);
        },
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// GET — Block A
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id]/collaborators — validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when world id is not a valid uuid", async () => {
    const res = await callGet("not-a-uuid");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/collaborators — world lookup", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when world is not found", async () => {
    mockFindFirstWorlds.mockResolvedValue(undefined);

    const res = await callGet(WORLD_UUID);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/collaborators — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns owner + collaborators list ordered by addedAt ascending", async () => {
    mockFindFirstWorlds.mockResolvedValue(WORLD_WITH_OWNER);
    // Rows already ordered by addedAt asc (the route passes orderBy to findMany)
    mockFindManyCollabs.mockResolvedValue([COLLAB_ROW_1, COLLAB_ROW_2]);

    const res = await callGet(WORLD_UUID);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Owner shape
    expect(body.owner).toEqual({
      id: OWNER_UUID,
      username: "alice",
      avatarUrl: "https://r2.example.com/alice.jpg",
    });

    // Collaborators list shape
    expect(body.collaborators).toHaveLength(2);

    const [first, second] = body.collaborators;
    expect(first.id).toBe(COLLAB_UUID);
    expect(first.username).toBe("bob");
    expect(first.avatarUrl).toBeNull();
    expect(first.role).toBe("editor");
    expect(first.addedAt).toBe(ADDED_AT_1.toISOString());
    expect(first.addedBy).toEqual({ id: OWNER_UUID, username: "alice" });

    expect(second.id).toBe(COLLAB2_UUID);
    expect(second.username).toBe("carol");
    // second should come after first (addedAt_2 > addedAt_1)
    expect(new Date(second.addedAt) >= new Date(first.addedAt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST — Block B
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/collaborators — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(WORLD_UUID, { username: "bob" });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/worlds/[id]/collaborators — permission gate", () => {
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
    mockRequireWorldRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPost(WORLD_UUID, { username: "bob" });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/worlds/[id]/collaborators — user resolution", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the target username is not found", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({
      world: { ...WORLD_WITH_OWNER, userId: OWNER_UUID },
      role: "owner",
    });

    // tx.select()...limit() → no user found
    mockTxSelect.mockResolvedValueOnce([]); // call 1: user lookup → not found

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID, { username: "ghost" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 409 when the target user is the world owner", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // world.userId === OWNER_UUID
    mockRequireWorldRole.mockResolvedValue({
      world: { ...WORLD_WITH_OWNER, userId: OWNER_UUID },
      role: "owner",
    });

    // tx.select() call 1: returns the owner as the target user
    mockTxSelect.mockResolvedValueOnce([
      { id: OWNER_UUID, username: "alice", avatarUrl: null },
    ]);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID, { username: "alice" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("owner");
  });

  it("returns 409 with existing row when user is already a collaborator", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({
      world: { ...WORLD_WITH_OWNER, userId: OWNER_UUID },
      role: "owner",
    });

    const existingAddedAt = new Date("2026-04-01");

    // tx call 1: user found (not the owner)
    mockTxSelect
      .mockResolvedValueOnce([
        { id: COLLAB_UUID, username: "bob", avatarUrl: null },
      ])
      // tx call 2: existing collab row found
      .mockResolvedValueOnce([
        {
          worldId: WORLD_UUID,
          userId: COLLAB_UUID,
          role: "editor",
          addedAt: existingAddedAt,
          addedById: OWNER_UUID,
        },
      ]);

    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );

    const res = await callPost(WORLD_UUID, { username: "bob" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("collaborator");
    expect(body.existing).toBeDefined();
    expect(body.existing.id).toBe(COLLAB_UUID);
    expect(body.existing.username).toBe("bob");
    expect(body.existing.role).toBe("editor");
    expect(typeof body.existing.addedAt).toBe("string");
  });
});

describe("POST /api/worlds/[id]/collaborators — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  function setupHappyPath() {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({
      world: { ...WORLD_WITH_OWNER, userId: OWNER_UUID },
      role: "owner",
    });

    // tx call 1: target user found (not the owner)
    mockTxSelect
      .mockResolvedValueOnce([
        { id: COLLAB_UUID, username: "bob", avatarUrl: null },
      ])
      // tx call 2: no existing collab row
      .mockResolvedValueOnce([]);

    mockNotify.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx())
    );
  }

  it("returns 201 with shaped collaborator row on success", async () => {
    setupHappyPath();

    const res = await callPost(WORLD_UUID, { username: "bob" });
    expect(res.status).toBe(201);
    const body = await res.json();

    // Shape check per spec
    expect(body.id).toBe(COLLAB_UUID);
    expect(body.username).toBe("bob");
    expect(typeof body.avatarUrl === "string" || body.avatarUrl === null).toBe(true);
    expect(body.role).toBe("editor");
    expect(typeof body.addedAt).toBe("string");
    expect(body.addedBy).toEqual({ id: OWNER_UUID, username: "alice" });
  });

  it("calls notify with type 'collaborator_added' after successful insert", async () => {
    setupHappyPath();

    await callPost(WORLD_UUID, { username: "bob" });

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: COLLAB_UUID,
        type: "collaborator_added",
        actorId: OWNER_UUID,
        worldId: WORLD_UUID,
      })
    );
  });

  it("inserts the collaborator row with correct values inside the transaction", async () => {
    setupHappyPath();

    await callPost(WORLD_UUID, { username: "bob" });

    expect(mockTxInsert).toHaveBeenCalledOnce();
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldCollaborators,
      expect.objectContaining({
        worldId: WORLD_UUID,
        userId: COLLAB_UUID,
        role: "editor",
        addedById: OWNER_UUID,
      })
    );
  });
});

describe("POST /api/worlds/[id]/collaborators — DB error", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when the transaction throws an unexpected error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({
      world: { ...WORLD_WITH_OWNER, userId: OWNER_UUID },
      role: "owner",
    });

    mockTransaction.mockRejectedValue(new Error("pg pool exhausted"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await callPost(WORLD_UUID, { username: "bob" });
    expect(res.status).toBe(503);

    consoleErrorSpy.mockRestore();
  });
});
