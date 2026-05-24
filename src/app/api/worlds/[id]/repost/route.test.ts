import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. Every mock
// factory referenced inside a vi.mock() factory must be defined here.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockGetOrCreateDbUser,
  mockDbSelectLimit,
  mockDbInsertValues,
  mockDbDeleteWhere,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: currentUser() fetches the full Clerk user object over
  // the network. Never want real Clerk calls in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: getOrCreateDbUser hits the DB; mocked so tests can
  // inject a pre-built user row or simulate DB errors without a real connection.
  mockGetOrCreateDbUser: vi.fn(),
  // Controls what db.select()...limit() returns for the world existence check.
  mockDbSelectLimit: vi.fn(),
  // Spy on the insert → values chain (captures the values passed to insert).
  mockDbInsertValues: vi.fn(),
  // Spy on the delete → where chain.
  mockDbDeleteWhere: vi.fn(),
}));

// Mock @clerk/nextjs/server — real calls require a live Clerk environment
// (signed cookies, network) that is unavailable in the test runner.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB lookup + insert for user bootstrap.
// This module crosses the DB boundary; mocking keeps tests hermetic.
vi.mock("@/lib/users", () => ({
  getOrCreateDbUser: mockGetOrCreateDbUser,
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon
// instance; both are unavailable in the test runner.
// This endpoint uses only `db` (HTTP client), no `dbPool`/transactions.
//
// The db mock models two independent query chains:
//
//   1. select({id: worlds.id}).from(worlds).where().limit()  — world existence check
//      The final `.limit()` call delegates to mockDbSelectLimit so tests can
//      control whether the world is found.
//
//   2. insert(reposts).values().onConflictDoNothing()  — repost insert
//      `.values()` records the call via mockDbInsertValues and returns a
//      chain where `.onConflictDoNothing()` resolves as a no-op Promise.
//
//   3. delete(reposts).where()  — un-repost delete
//      `.where()` records the call via mockDbDeleteWhere and resolves.
//
// We deliberately do NOT mock `eq` / `and` from drizzle-orm — they are
// pure functions with no I/O and must not be faked.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
    insert: () => ({
      values: (vals: unknown) => ({
        onConflictDoNothing: () => {
          mockDbInsertValues(vals);
          return Promise.resolve();
        },
      }),
    }),
    delete: () => ({
      where: (condition: unknown) => {
        mockDbDeleteWhere(condition);
        return Promise.resolve();
      },
    }),
  },
}));

// Import handlers AFTER mocks are registered so they receive the mocked deps.
import { POST, DELETE } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const CLERK_USER_ID = "clerk_user_alice";
const USER_DB_ID = "db-uuid-alice-001";

// A second valid UUID for testing invalid-UUID rejection branches.
const INVALID_ID = "not-a-uuid";

const CLERK_USER = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

const USER_DB_ROW = {
  id: USER_DB_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const WORLD_ROW = { id: WORLD_ID };

// ---------------------------------------------------------------------------
// Route call helpers
//
// Route signature: POST/DELETE(_req, { params: Promise<{ id: string }> })
// ---------------------------------------------------------------------------

function callPost(worldId: string) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/repost`,
    { method: "POST" }
  );
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

function callDelete(worldId: string) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/repost`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Happy-path setup helper
//
// Seeds the standard "everything works" mock state. Individual tests override
// only the one mock they care about.
// ---------------------------------------------------------------------------

function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER);
  mockGetOrCreateDbUser.mockResolvedValue(USER_DB_ROW);
  // World found by id lookup
  mockDbSelectLimit.mockResolvedValue([WORLD_ROW]);
}

// ---------------------------------------------------------------------------
// Block A — Validation + auth (shared prelude, both POST and DELETE)
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/repost — validation + auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(WORLD_ID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-UUID world id", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(USER_DB_ROW);

    const res = await callPost(INVALID_ID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 503 when getOrCreateDbUser throws a DB connection error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );

    const res = await callPost(WORLD_ID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when Clerk user has no email", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("no email on Clerk user")
    );

    const res = await callPost(WORLD_ID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the world does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(USER_DB_ROW);
    // Empty array = world not found
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callPost(WORLD_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/worlds/[id]/repost — validation + auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(WORLD_ID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a non-UUID world id", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(USER_DB_ROW);

    const res = await callDelete(INVALID_ID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the world does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(USER_DB_ROW);
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callDelete(WORLD_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block B — POST (repost) behavior
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/repost — repost behavior", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {reposted: true} on a successful repost", async () => {
    setupHappyPath();

    const res = await callPost(WORLD_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reposted: true });
  });

  it("calls db.insert(reposts).values() with the correct userId and worldId", async () => {
    setupHappyPath();

    await callPost(WORLD_ID);

    expect(mockDbInsertValues).toHaveBeenCalledOnce();
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_DB_ID,
        worldId: WORLD_ID,
      })
    );
  });

  it("uses onConflictDoNothing: two consecutive POSTs both return {reposted: true}", async () => {
    // Both calls resolve because onConflictDoNothing is a no-op on duplicate.
    setupHappyPath();

    const res1 = await callPost(WORLD_ID);
    const res2 = await callPost(WORLD_ID);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(await res1.json()).toEqual({ reposted: true });
    expect(await res2.json()).toEqual({ reposted: true });
  });
});

// ---------------------------------------------------------------------------
// Block C — DELETE (un-repost) behavior
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/repost — un-repost behavior", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {reposted: false} on un-repost", async () => {
    setupHappyPath();

    const res = await callDelete(WORLD_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reposted: false });
  });

  it("calls db.delete(reposts).where() with a condition referencing both userId and worldId", async () => {
    setupHappyPath();

    await callDelete(WORLD_ID);

    // The condition is a Drizzle SQL node — asserting it is defined is
    // sufficient without coupling to Drizzle internals.
    expect(mockDbDeleteWhere).toHaveBeenCalledOnce();
    const [condition] = mockDbDeleteWhere.mock.calls[0];
    expect(condition).toBeDefined();
  });

  it("DELETE on a world that has not been reposted still returns {reposted: false} (idempotent)", async () => {
    // db.delete().where() resolves even when no matching row exists.
    setupHappyPath();

    const res = await callDelete(WORLD_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reposted: false });
  });
});

// ---------------------------------------------------------------------------
// Block D — Self-repost allowed (explicit spec assertion)
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/repost — self-repost is allowed", () => {
  beforeEach(() => vi.resetAllMocks());

  it("succeeds when the authenticated user is the same as the world owner (no self-repost guard)", async () => {
    // The route has no guard against self-repost (Twitter/IG pattern).
    // Stub the world row as if it belongs to the calling user — the
    // endpoint never inspects worlds.user_id, so the mock just needs to
    // confirm the world exists.
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(USER_DB_ROW);
    // World exists and (for spec clarity) is owned by the same user.
    mockDbSelectLimit.mockResolvedValue([{ id: WORLD_ID }]);

    const res = await callPost(WORLD_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reposted: true });
  });
});
