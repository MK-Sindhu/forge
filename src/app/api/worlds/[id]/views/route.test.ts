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
  mockTxUpdate,
  // Controls what tx.select(...)...where() returns for the recount query.
  mockTxSelectCount,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: currentUser() fetches the full Clerk user object over
  // the network; we never want real Clerk calls in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser hits the DB; mocked so tests can
  // inject a pre-built user row or simulate DB errors without a real connection.
  mockRequireActiveDbUser: vi.fn(),
  // Inner mock for db.select(...)...limit(n) — the world-existence check.
  mockDbSelectLimit: vi.fn(),
  // Inner mock for dbPool.transaction() — receives the async callback and
  // decides whether to run it (happy path) or throw (error path).
  mockTransaction: vi.fn(),
  // Spy surfaced through the fake tx object for insert calls:
  mockTxInsert: vi.fn(),
  // Spy surfaced through the fake tx object for update calls:
  mockTxUpdate: vi.fn(),
  // Controls what the recount SELECT returns inside the transaction.
  mockTxSelectCount: vi.fn(),
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

// Import handler AFTER mocks are registered so it receives the mocked deps.
import { POST } from "./route";
// Import real table refs — pure JS objects, no DB connection triggered.
// Used as identity markers in toHaveBeenCalledWith assertions.
import { worldViews, worlds } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID = "not-a-uuid";
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

const CLERK_USER_FIXTURE = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

// The route signature: POST(request, { params: Promise<{ id: string }> })
function callPost(worldId: string) {
  const req = new Request(`http://localhost/api/worlds/${worldId}/views`, {
    method: "POST",
  });
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Fake transaction builder
//
// Provides a tx object whose insert/update/select methods are routed to the
// fine-grained mocks so individual tests can assert call arguments.
//
// The insert chain: tx.insert(table).values(values).onConflictDoNothing()
//   — onConflictDoNothing records the call via mockTxInsert.
//
// The select chain: tx.select({ count: count() }).from(worldViews).where(...)
//   — where() calls mockTxSelectCount and resolves with [{ count: viewCount }].
//
// The update chain: tx.update(table).set(values).where()
//   — records the call via mockTxUpdate.
// ---------------------------------------------------------------------------

function makeFakeTx(viewCount: number) {
  return {
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        // onConflictDoNothing() is the terminal call for the insert chain.
        // We spy here (not in values()) to mirror the implementation call order.
        onConflictDoNothing: () => {
          mockTxInsert(table, values);
          return Promise.resolve();
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
    select: (_fields: unknown) => ({
      from: (_table: unknown) => ({
        where: (_condition: unknown) => {
          mockTxSelectCount();
          return Promise.resolve([{ count: viewCount }]);
        },
      }),
    }),
  };
}

// Sets up the standard "happy path" mocks so individual tests only need to
// override the one mock they care about.
function setupHappyPath(viewCountAfterOp = 1) {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
  // World exists
  mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  // Transaction runs the callback with the fake tx
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeFakeTx(viewCountAfterOp))
  );
}

// ---------------------------------------------------------------------------
// Block A — Auth failures
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — auth failures", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 401 when Clerk session has a userId but currentUser() returns null", async () => {
    // This covers the gap between auth() returning a userId and currentUser()
    // succeeding — can happen if the session is partially stale.
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(null);

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block B — Suspension guard
//
// requireActiveDbUser returns a 403 NextResponse for suspended accounts.
// The route must propagate that response directly.
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — suspension guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireActiveDbUser signals the caller is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    // requireActiveDbUser returns a 403 NextResponse for suspended users.
    // Mock reason: this helper crosses the DB boundary; mocked at this seam
    // to keep tests hermetic.
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Account suspended" }, { status: 403 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block C — Input validation
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — input validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when the world id is not a valid UUID", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    const res = await callPost(INVALID_UUID);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
    // The spec says the error message should mention "world id" or similar.
    expect(body.error.toLowerCase()).toMatch(/world\s*id|invalid/);
  });
});

// ---------------------------------------------------------------------------
// Block D — World existence check
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — world not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist in the DB", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // Empty result array = world not found
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block E — Happy path: transaction behavior
//
// Spec (plan §7.3):
//   1. tx.insert(worldViews).values({ viewerId, worldId, day }).onConflictDoNothing()
//   2. tx.select({ count: count() }).from(worldViews).where(eq(worldViews.worldId, worldId))
//   3. tx.update(worlds).set({ views: <count> }).where(eq(worlds.id, worldId))
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — happy path transaction behavior", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with { ok: true } on a valid view", async () => {
    setupHappyPath(1);

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("runs the insert + recount + update inside dbPool.transaction", async () => {
    setupHappyPath(1);

    await callPost(VALID_WORLD_UUID);

    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("inserts into worldViews with correct viewerId, worldId, and today's UTC date", async () => {
    setupHappyPath(1);

    await callPost(VALID_WORLD_UUID);

    const expectedDay = new Date().toISOString().slice(0, 10);

    expect(mockTxInsert).toHaveBeenCalledOnce();
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldViews,
      expect.objectContaining({
        viewerId: DB_USER_ID,
        worldId: VALID_WORLD_UUID,
        day: expectedDay,
      })
    );
  });

  it("calls the recount SELECT inside the transaction", async () => {
    setupHappyPath(3);

    await callPost(VALID_WORLD_UUID);

    expect(mockTxSelectCount).toHaveBeenCalledOnce();
  });

  it("updates worlds.views with the recounted value from worldViews", async () => {
    setupHappyPath(5);

    await callPost(VALID_WORLD_UUID);

    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ views: 5 })
    );
  });
});

// ---------------------------------------------------------------------------
// Block F — Idempotency
//
// Spec: same user + same world + same day → onConflictDoNothing() silently
// drops the duplicate insert. The recount STILL runs and writes the existing
// count. Route must still return 200.
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — idempotency (same user, same world, same day)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 on a second call even when onConflictDoNothing no-ops", async () => {
    // Both calls see the same count (5) because no new row was inserted on the
    // second call. The route is not expected to detect the no-op — it just
    // recounts and writes the existing total.
    setupHappyPath(5);

    const res1 = await callPost(VALID_WORLD_UUID);
    const res2 = await callPost(VALID_WORLD_UUID);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("the recount runs even when the insert is a no-op (count stays at 5 both times)", async () => {
    setupHappyPath(5);

    await callPost(VALID_WORLD_UUID);
    await callPost(VALID_WORLD_UUID);

    // transaction was called twice — once per route call
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    // recount ran both times (2 calls total)
    expect(mockTxSelectCount).toHaveBeenCalledTimes(2);
    // update wrote the existing count both times
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(mockTxUpdate).toHaveBeenNthCalledWith(
      2,
      worlds,
      expect.objectContaining({ views: 5 })
    );
  });
});

// ---------------------------------------------------------------------------
// Block G — DB error → 503
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/views — DB error handling", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when dbPool.transaction throws", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
    // Simulate a transient DB failure
    mockTransaction.mockRejectedValue(new Error("connection pool exhausted"));

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});
