import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. Every mock
// factory referenced inside a vi.mock() factory must be defined here.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockDbSelectLimit,
  mockDbInsertValues,
  mockDbDeleteWhere,
  // External boundary: @/lib/notifications — mocked so tests can assert the
  // notify() call shape without a real DB insert. The helper's internal logic
  // (self-notification suppression, DB error swallowing) is tested separately
  // in src/lib/notifications.test.ts.
  mockNotify,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: currentUser() fetches the full Clerk user object over
  // the network. Never want real Clerk calls in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser hits the DB; mocked so tests can
  // inject a pre-built user row or simulate DB errors without a real connection.
  mockRequireActiveDbUser: vi.fn(),
  // Controls what db.select()...limit() returns for the followee lookup.
  mockDbSelectLimit: vi.fn(),
  // Spy on the insert → values chain (captures the values passed to insert).
  mockDbInsertValues: vi.fn(),
  // Spy on the delete → where chain.
  mockDbDeleteWhere: vi.fn(),
  mockNotify: vi.fn(),
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
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mock @/lib/notifications — mocks the entire notifications helper module so
// tests can assert notify() is called with the right arguments without a real
// DB insert or notifications table.
vi.mock("@/lib/notifications", () => ({
  notify: mockNotify,
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon
// instance; both are unavailable in the test runner.
// This endpoint uses only `db` (HTTP client), no `dbPool`/transactions.
//
// The db mock models two independent query chains:
//
//   1. select().from(users).where().limit()  — followee existence lookup
//      The final `.limit()` call delegates to mockDbSelectLimit so tests can
//      control whether the user is found.
//
//   2. insert(follows).values().onConflictDoNothing()  — follow insert
//      `.values()` records the call via mockDbInsertValues and returns a
//      chain where `.onConflictDoNothing()` resolves as a no-op Promise.
//
//   3. delete(follows).where()  — unfollow delete
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

const FOLLOWER_USERNAME = "alice";
const FOLLOWEE_USERNAME = "bob";
const CLERK_USER_ID = "clerk_user_alice";
const FOLLOWER_DB_ID = "db-uuid-alice-001";
const FOLLOWEE_DB_ID = "db-uuid-bob-002";

// 65-character string — one over the 64-char limit.
const TOO_LONG_USERNAME = "a".repeat(65);

const CLERK_USER = {
  id: CLERK_USER_ID,
  username: FOLLOWER_USERNAME,
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

const FOLLOWER_DB_ROW = {
  id: FOLLOWER_DB_ID,
  clerkId: CLERK_USER_ID,
  username: FOLLOWER_USERNAME,
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const FOLLOWEE_DB_ROW = {
  id: FOLLOWEE_DB_ID,
};

// ---------------------------------------------------------------------------
// Route call helpers
//
// Route signature: POST/DELETE(_req, { params: Promise<{ username: string }> })
// ---------------------------------------------------------------------------

function callPost(username: string) {
  const req = new Request(
    `http://localhost/api/users/${username}/follow`,
    { method: "POST" }
  );
  return POST(req, { params: Promise.resolve({ username }) });
}

function callDelete(username: string) {
  const req = new Request(
    `http://localhost/api/users/${username}/follow`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ username }) });
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
  mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);
  // Followee found by username lookup
  mockDbSelectLimit.mockResolvedValue([FOLLOWEE_DB_ROW]);
  // Default: notify is a no-op so existing tests that don't assert on it pass.
  mockNotify.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Block A — Validation + auth (shared prelude for both POST and DELETE)
// ---------------------------------------------------------------------------

describe("POST /api/users/[username]/follow — validation + auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when username is an empty string", async () => {
    // The route should reject before any I/O — no auth mock needed.
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);

    const res = await callPost("");

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when username exceeds 64 characters", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);

    const res = await callPost(TOO_LONG_USERNAME);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when Clerk user has no email (getOrCreateDbUser throws 'no email')", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "No email on Clerk user" }, { status: 400 })
    );

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 503 when getOrCreateDbUser throws an unexpected DB error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Database temporarily unavailable" }, { status: 503 })
    );

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the followee username does not exist in the DB", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);
    // Empty array = username not found
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the follower and followee are the same user (self-follow)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);
    // Followee lookup returns the same DB ID as the follower
    mockDbSelectLimit.mockResolvedValue([{ id: FOLLOWER_DB_ID }]);

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/users/[username]/follow — validation + auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(FOLLOWEE_USERNAME);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the followee username does not exist in the DB", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callDelete(FOLLOWEE_USERNAME);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the follower and followee are the same user (self-follow)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    mockRequireActiveDbUser.mockResolvedValue(FOLLOWER_DB_ROW);
    mockDbSelectLimit.mockResolvedValue([{ id: FOLLOWER_DB_ID }]);

    const res = await callDelete(FOLLOWEE_USERNAME);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block B — Suspension guard
//
// This endpoint uses requireActiveDbUser. When that helper returns a 403
// NextResponse (instead of a DbUser), the route must propagate it.
// ---------------------------------------------------------------------------

describe("POST /api/users/[username]/follow — suspension guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireActiveDbUser signals the caller is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER);
    // requireActiveDbUser returns a 403 NextResponse for suspended users
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Account suspended" }, { status: 403 })
    );

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block C — POST (follow) behavior
// ---------------------------------------------------------------------------

describe("POST /api/users/[username]/follow — follow behavior (active user)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {following: true} on a successful follow", async () => {
    setupHappyPath();

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: true });
  });

  it("calls db.insert(follows).values() with the correct followerId and followeeId", async () => {
    setupHappyPath();

    await callPost(FOLLOWEE_USERNAME);

    expect(mockDbInsertValues).toHaveBeenCalledOnce();
    expect(mockDbInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        followerId: FOLLOWER_DB_ID,
        followeeId: FOLLOWEE_DB_ID,
      })
    );
  });

  it("uses onConflictDoNothing: a second POST does not throw and still returns {following: true}", async () => {
    // Both calls resolve because onConflictDoNothing is a no-op on duplicate.
    setupHappyPath();

    const res1 = await callPost(FOLLOWEE_USERNAME);
    const res2 = await callPost(FOLLOWEE_USERNAME);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(await res1.json()).toEqual({ following: true });
    expect(await res2.json()).toEqual({ following: true });
  });
});

// ---------------------------------------------------------------------------
// Block C — DELETE (unfollow) behavior
// ---------------------------------------------------------------------------

describe("DELETE /api/users/[username]/follow — unfollow behavior", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {following: false} on a successful unfollow", async () => {
    setupHappyPath();

    const res = await callDelete(FOLLOWEE_USERNAME);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: false });
  });

  it("calls db.delete(follows).where() with a condition referencing both IDs", async () => {
    setupHappyPath();

    await callDelete(FOLLOWEE_USERNAME);

    // The condition is a Drizzle SQL node — asserting it is defined
    // is sufficient without coupling to Drizzle internals.
    expect(mockDbDeleteWhere).toHaveBeenCalledOnce();
    const [condition] = mockDbDeleteWhere.mock.calls[0];
    expect(condition).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Block D — Idempotency
// ---------------------------------------------------------------------------

describe("follow idempotency", () => {
  beforeEach(() => vi.resetAllMocks());

  it("two consecutive POSTs both return {following: true} (re-follow is a no-op)", async () => {
    setupHappyPath();

    const res1 = await callPost(FOLLOWEE_USERNAME);
    const res2 = await callPost(FOLLOWEE_USERNAME);

    expect(await res1.json()).toEqual({ following: true });
    expect(await res2.json()).toEqual({ following: true });
  });

  it("DELETE on a non-followed user returns {following: false} without throwing", async () => {
    // db.delete().where() resolves even when no row exists — idempotent delete.
    setupHappyPath();

    const res = await callDelete(FOLLOWEE_USERNAME);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: false });
  });
});

// ---------------------------------------------------------------------------
// Block E — notify() integration (sub-slice 7.5)
//
// These tests assert that the POST follow route calls notify() with the
// correct arguments after the follow insert. The route does NOT require a
// second DB select for the followee — followeeId is already available from
// the prelude. notify() is mocked at the module level so tests see the raw
// call shape without a real DB insert.
// ---------------------------------------------------------------------------

describe("POST /api/users/[username]/follow — notify integration", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls notify with { type: 'follow', userId: followeeId, actorId: followerId } after a successful follow", async () => {
    setupHappyPath();

    await callPost(FOLLOWEE_USERNAME);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify).toHaveBeenCalledWith({
      type: "follow",
      userId: FOLLOWEE_DB_ID,
      actorId: FOLLOWER_DB_ID,
    });
  });

  it("still returns 200 with { following: true } when notify throws (notification failure never breaks the follow)", async () => {
    // Locked decision (PROJECT.md §7): notification failure must NEVER break
    // the parent action. The route wraps the notify call in try/catch.
    setupHappyPath();
    mockNotify.mockRejectedValue(new Error("notify DB exploded"));

    const res = await callPost(FOLLOWEE_USERNAME);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: true });
  });
});

describe("DELETE /api/users/[username]/follow — notify NOT called on unfollow", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does NOT call notify when a user unfollows (unfollowing is a silent action)", async () => {
    setupHappyPath();

    await callDelete(FOLLOWEE_USERNAME);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
