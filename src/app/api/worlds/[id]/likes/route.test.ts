import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. Every mock
// factory that a vi.mock() factory references must be hoisted here.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockDbSelectLimit,
  mockTransaction,
  // Fine-grained spies into the tx object surfaced inside the transaction callback.
  mockTxInsert,
  mockTxDelete,
  mockTxUpdate,
  // Controls what tx.select(...)...where() returns for the recount query.
  mockTxSelectCount,
  // External boundary: @/lib/notifications — mocked so tests can assert call
  // shape without running the real DB insert. Mocked at the module level rather
  // than the db level so tests see the function call directly.
  mockNotify,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: currentUser() fetches the full Clerk user object over
  // the network; we never want real Clerk calls in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser hits the DB; mocked so tests can
  // inject a pre-built user row or simulate DB errors without a real connection.
  mockRequireActiveDbUser: vi.fn(),
  // Inner mock for db.select(...)...limit(n) — the world-existence check AND
  // the post-commit owner lookup (both use the same db.select chain; tests use
  // mockResolvedValueOnce to control successive calls independently).
  mockDbSelectLimit: vi.fn(),
  // Inner mock for dbPool.transaction() — receives the async callback and
  // decides whether to run it (happy path) or throw (error path).
  mockTransaction: vi.fn(),
  // Spies surfaced through the fake tx object:
  mockTxInsert: vi.fn(),
  mockTxDelete: vi.fn(),
  mockTxUpdate: vi.fn(),
  // Controls what the recount SELECT returns inside the transaction.
  mockTxSelectCount: vi.fn(),
  // Mock for notify() — the notifications helper is an external DB boundary;
  // mocking at this seam lets tests assert the call shape without a real
  // notifications table or DB insert. The helper's internal try/catch and
  // self-notification suppression are tested separately in notifications.test.ts.
  mockNotify: vi.fn(),
}));

// Mock @clerk/nextjs/server — real calls require a live Clerk environment
// (signed cookies, network). Not available in the test runner.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB lookup + insert for user bootstrap.
// This module is an internal helper, but it crosses the DB boundary; mocking
// here keeps tests hermetic without reaching Neon.
vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mock @/lib/notifications — mocks the entire notifications helper module so
// tests can assert notify() is called with the right arguments without a real
// DB insert or a live notifications table. The helper's own internal logic
// (self-notification suppression, DB error swallowing) is tested separately
// in src/lib/notifications.test.ts.
vi.mock("@/lib/notifications", () => ({
  notify: mockNotify,
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon
// instance; both are unavailable in the test runner.
// We mock:
//   db       — the serverless HTTP client used for single-query reads
//   dbPool   — the WebSocket-based pool used for transactions
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
  },
  dbPool: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

// Import handlers AFTER mocks are registered so they receive the mocked deps.
import { POST, DELETE } from "./route";
// Import real table refs — pure JS objects, no DB connection triggered.
// Used as identity markers in toHaveBeenCalledWith assertions.
import { worlds, likes } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID = "not-a-uuid";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";
// DB id for a different user who owns the world (the notification recipient).
const OWNER_DB_ID = "db-uuid-owner-002";

const DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

// ---------------------------------------------------------------------------
// Route call helpers
// ---------------------------------------------------------------------------

// The route signature: POST(request, { params: Promise<{ id: string }> })
function callPost(worldId: string) {
  const req = new Request(`http://localhost/api/worlds/${worldId}/likes`, {
    method: "POST",
  });
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

function callDelete(worldId: string) {
  const req = new Request(`http://localhost/api/worlds/${worldId}/likes`, {
    method: "DELETE",
  });
  return DELETE(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Fake transaction builder
//
// Provides a tx object whose insert/delete/update/select methods are routed
// to the fine-grained mocks so individual tests can assert call arguments.
//
// The select chain is the most complex: the implementation calls
//   tx.select({ count: count() }).from(likes).where(eq(likes.worldId, ...))
// which must return [{ count: <number> }]. We model this as a 3-step chain
// (select → from → where) where `where` is what actually resolves with data.
// mockTxSelectCount controls what value `where()` resolves with.
// ---------------------------------------------------------------------------

function makeFakeTx(countResult: number) {
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        // onConflictDoNothing() is called on the result of values(); we chain
        // it here as a no-op that resolves so the implementation can await it.
        onConflictDoNothing: () => {
          mockTxInsert(table, values);
          return Promise.resolve();
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => {
        mockTxDelete(table, condition);
        return Promise.resolve();
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: () => {
          mockTxUpdate(table, values);
          return Promise.resolve();
        },
      }),
    }),
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => {
          mockTxSelectCount();
          return Promise.resolve([{ count: countResult }]);
        },
      }),
    }),
  };
}

// Sets up the standard "happy path" mocks so individual tests only need to
// override the one mock they care about.
//
// Note on db.select call ordering for POST:
//   call 1: world-existence check (before transaction) → returns [{ id }]
//   call 2: owner lookup          (after transaction)  → returns [{ ownerId }]
//
// The default sets both calls to return the world-existence result so existing
// tests that don't care about the owner lookup continue to work. Tests that
// assert on notify() must override mockDbSelectLimit with mockResolvedValueOnce
// pairs (or use setupHappyPathWithOwner()).
function setupHappyPath(likeCountAfterOp = 1) {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue({
    id: CLERK_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
  // Default: both select calls return the world-existence shape.
  // The owner lookup extracts { ownerId } but receives { id } here — that is
  // fine for tests that only care about the response shape, not the notify call.
  mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  // Transaction runs the callback with the fake tx
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeFakeTx(likeCountAfterOp))
  );
  // Default: notify is a no-op so existing tests that don't assert on it pass.
  mockNotify.mockResolvedValue(undefined);
}

// Extended happy-path setup that also configures the owner-lookup select call
// so notify() tests can assert on the correct ownerId.
function setupHappyPathWithOwner(likeCountAfterOp = 1, ownerId = OWNER_DB_ID) {
  setupHappyPath(likeCountAfterOp);
  // Override with per-call values:
  //   call 1 (world-existence): returns [{ id }]
  //   call 2 (owner lookup):    returns [{ ownerId }]
  mockDbSelectLimit
    .mockResolvedValueOnce([{ id: VALID_WORLD_UUID }])
    .mockResolvedValueOnce([{ ownerId }]);
}

// ---------------------------------------------------------------------------
// Block A — Auth + validation (shared prelude for both POST and DELETE)
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/likes — auth + validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for an invalid UUID param", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    const res = await callPost(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the world does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // Empty result = world not found
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 503 when user bootstrap throws a DB error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Database temporarily unavailable, please try again" }, { status: 503 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/worlds/[id]/likes — auth + validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for an invalid UUID param", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    const res = await callDelete(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 when the world does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callDelete(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 503 when user bootstrap throws a DB error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Database temporarily unavailable, please try again" }, { status: 503 })
    );

    const res = await callDelete(VALID_WORLD_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block B — POST (like) behavior
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/likes — like behavior", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {liked: true, likesCount: 1} when liking a world with no prior likes", async () => {
    setupHappyPath(1); // recount returns 1 after the first like

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liked: true, likesCount: 1 });
  });

  it("calls tx.insert(likes) with the correct userId and worldId", async () => {
    setupHappyPath(1);

    await callPost(VALID_WORLD_UUID);

    expect(mockTxInsert).toHaveBeenCalledOnce();
    expect(mockTxInsert).toHaveBeenCalledWith(
      likes,
      expect.objectContaining({ userId: DB_USER_ID, worldId: VALID_WORLD_UUID })
    );
  });

  it("uses onConflictDoNothing (idempotent path): re-liking returns same count", async () => {
    // First call: count after op = 1; second call: count still = 1 (no new row)
    setupHappyPath(1);

    const res1 = await callPost(VALID_WORLD_UUID);
    const res2 = await callPost(VALID_WORLD_UUID);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1.likesCount).toBe(1);
    expect(body2.likesCount).toBe(1);
  });

  it("calls tx.update(worlds).set({likesCount}) with the recounted value", async () => {
    setupHappyPath(3); // recount returns 3

    await callPost(VALID_WORLD_UUID);

    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ likesCount: 3 })
    );
  });

  it("runs the insert and update inside a transaction (dbPool.transaction is called)", async () => {
    setupHappyPath(1);

    await callPost(VALID_WORLD_UUID);

    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("the recount SELECT is called inside the transaction", async () => {
    setupHappyPath(1);

    await callPost(VALID_WORLD_UUID);

    // mockTxSelectCount is called once inside makeFakeTx for the recount query
    expect(mockTxSelectCount).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Block C — DELETE (unlike) behavior
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/likes — unlike behavior", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {liked: false, likesCount: 0} when unliking the only like", async () => {
    setupHappyPath(0); // recount returns 0 after the unlike

    const res = await callDelete(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liked: false, likesCount: 0 });
  });

  it("calls tx.delete(likes) targeting the correct userId AND worldId", async () => {
    setupHappyPath(0);

    await callDelete(VALID_WORLD_UUID);

    // The implementation passes a where condition combining userId + worldId;
    // we assert the table identity. The condition object is a Drizzle internal
    // (not mocked) — asserting on the table alone is sufficient and avoids
    // coupling to Drizzle internals.
    expect(mockTxDelete).toHaveBeenCalledOnce();
    expect(mockTxDelete).toHaveBeenCalledWith(likes, expect.anything());
  });

  it("calls tx.update(worlds).set({likesCount}) with the recounted value after unlike", async () => {
    setupHappyPath(2); // 3 likes before, 2 after

    await callDelete(VALID_WORLD_UUID);

    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ likesCount: 2 })
    );
  });

  it("runs the delete and update inside a transaction", async () => {
    setupHappyPath(0);

    await callDelete(VALID_WORLD_UUID);

    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("the recount SELECT is called inside the transaction after the delete", async () => {
    setupHappyPath(0);

    await callDelete(VALID_WORLD_UUID);

    expect(mockTxSelectCount).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Block D — Suspension guard
//
// This endpoint uses requireActiveDbUser. When that helper returns a 403
// NextResponse (instead of a DbUser), the route must propagate it.
//
// We mock requireActiveDbUser to return a 403 response directly — this tests
// the guard behavior without needing a real suspended-user DB fixture.
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/likes — suspension guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireActiveDbUser signals the caller is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    // requireActiveDbUser returns a 403 NextResponse for suspended users
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Account suspended" }, { status: 403 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block E — Idempotency
// ---------------------------------------------------------------------------

describe("POST/DELETE /api/worlds/[id]/likes — idempotency", () => {
  beforeEach(() => vi.resetAllMocks());

  it("two consecutive POSTs return the same count (re-like is a no-op)", async () => {
    // The recount always returns 1 because onConflictDoNothing prevents a
    // second row being inserted. Both calls observe the same counter value.
    setupHappyPath(1);

    const res1 = await callPost(VALID_WORLD_UUID);
    const res2 = await callPost(VALID_WORLD_UUID);

    expect((await res1.json()).likesCount).toBe(1);
    expect((await res2.json()).likesCount).toBe(1);
  });

  it("DELETE on a world the user has not liked returns the existing count (no error)", async () => {
    // recount returns 5 — user had no like row, so delete was a no-op, count unchanged
    setupHappyPath(5);

    const res = await callDelete(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.liked).toBe(false);
    expect(body.likesCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Block F — notify() integration (sub-slice 7.5)
//
// These tests assert that the route calls notify() with the correct arguments
// after the like transaction commits. notify() is mocked at the module level
// (@/lib/notifications) so tests see the raw call shape; the helper's own
// self-notification suppression and DB error swallowing are tested separately
// in src/lib/notifications.test.ts.
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/likes — notify integration", () => {
  beforeEach(() => vi.resetAllMocks());

  it("calls notify with { type: 'like', userId: ownerId, actorId: dbUserId, worldId } after a successful like", async () => {
    setupHappyPathWithOwner(1, OWNER_DB_ID);

    await callPost(VALID_WORLD_UUID);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify).toHaveBeenCalledWith({
      type: "like",
      userId: OWNER_DB_ID,
      actorId: DB_USER_ID,
      worldId: VALID_WORLD_UUID,
    });
  });

  it("calls notify with actorId === userId when user likes their own world (self-actor suppression happens inside the helper, not the route)", async () => {
    // The route calls notify() unconditionally after fetching the owner.
    // When the liker IS the owner, notify() is still called — but the helper
    // suppresses the notification internally (tested in notifications.test.ts).
    // This test confirms the route doesn't short-circuit before calling notify().
    setupHappyPath(1);
    // Owner lookup returns the same DB_USER_ID as the liker.
    mockDbSelectLimit
      .mockResolvedValueOnce([{ id: VALID_WORLD_UUID }]) // world-existence check
      .mockResolvedValueOnce([{ ownerId: DB_USER_ID }]);  // owner === liker

    await callPost(VALID_WORLD_UUID);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: DB_USER_ID, userId: DB_USER_ID })
    );
    // (The helper would skip inserting a row for this case, but that logic is
    // in notifications.ts — out of scope for this route test.)
  });

  it("still returns 200 with { liked: true, likesCount } when notify throws", async () => {
    // Locked decision (PROJECT.md §7): notification failure must NEVER break
    // the parent action. The route wraps the notify call in try/catch.
    setupHappyPathWithOwner(1, OWNER_DB_ID);
    mockNotify.mockRejectedValue(new Error("notify DB exploded"));

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ liked: true, likesCount: 1 });
  });
});

describe("DELETE /api/worlds/[id]/likes — notify NOT called on unlike", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does NOT call notify when a user unlikes a world (un-liking is a silent action)", async () => {
    setupHappyPath(0);

    await callDelete(VALID_WORLD_UUID);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
