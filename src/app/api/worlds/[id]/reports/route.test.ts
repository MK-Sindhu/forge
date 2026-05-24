import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. Every value
// referenced inside a vi.mock() factory must come from here.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockGetOrCreateDbUser,
  // Controls db.select()...limit() — world-existence check
  mockDbSelectLimit,
  // Controls db.insert()...onConflictDoNothing() — report insert
  mockDbInsertConflict,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk auth() makes network calls to Clerk API.
  // Never want real Clerk calls in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: getOrCreateDbUser hits the DB (upsert).
  // Mocked so tests can inject pre-built user rows or simulate errors.
  // NOTE: this route uses getOrCreateDbUser directly (NOT requireActiveDbUser)
  // because it is suspension-exempt by design — see plan.
  mockGetOrCreateDbUser: vi.fn(),
  mockDbSelectLimit: vi.fn(),
  mockDbInsertConflict: vi.fn(),
}));

// Mock @clerk/nextjs/server — guards against live Clerk calls.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB round-trip.
// We mock getOrCreateDbUser specifically; this endpoint does NOT use
// requireActiveDbUser so we only expose that one symbol.
vi.mock("@/lib/users", () => ({
  getOrCreateDbUser: mockGetOrCreateDbUser,
}));

// Mock @/db — real DB connections require DATABASE_URL + Neon; both
// unavailable in the test runner.
//
// The POST handler uses two DB paths:
//   1. db.select({id}).from(worlds).where().limit()  — world-existence check
//   2. db.insert(reports).values().onConflictDoNothing()  — report insert
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (..._args: unknown[]) => mockDbSelectLimit(),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: (..._args: unknown[]) => mockDbInsertConflict(),
      }),
    }),
  },
}));

// Import handler AFTER mocks are registered.
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID = "not-a-uuid";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";

/** A fully active (not suspended) DB user row. */
const ACTIVE_DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  isAdmin: false,
  suspendedAt: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

/** A suspended DB user row — suspendedAt is set. */
const SUSPENDED_DB_USER = {
  ...ACTIVE_DB_USER,
  suspendedAt: new Date("2026-04-01T00:00:00.000Z"),
};

const VALID_CLERK_USER = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

const VALID_REASON = "copyright";
const VALID_BODY = { reason: VALID_REASON };

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callPost(worldId: string, body: unknown = VALID_BODY) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/reports`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Happy-path setup helper
// ---------------------------------------------------------------------------

function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
  mockGetOrCreateDbUser.mockResolvedValue(ACTIVE_DB_USER);
  mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]); // world exists
  mockDbInsertConflict.mockResolvedValue(undefined);
}

// ============================================================================
// Auth
// ============================================================================

describe("POST /api/worlds/[id]/reports — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Param + body validation
// ============================================================================

describe("POST /api/worlds/[id]/reports — param validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid (non-UUID) world id param", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(ACTIVE_DB_USER);

    const res = await callPost(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/reports — body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(ACTIVE_DB_USER);
    // World exists for all body-validation tests
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  });

  it("returns 400 when reason is not in the allowed enum", async () => {
    const res = await callPost(VALID_WORLD_UUID, { reason: "hate_speech" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when reason is missing entirely", async () => {
    const res = await callPost(VALID_WORLD_UUID, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when body field exceeds 1000 characters", async () => {
    const tooLong = "a".repeat(1001);
    const res = await callPost(VALID_WORLD_UUID, { reason: "spam", body: tooLong });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// User bootstrap errors
// ============================================================================

describe("POST /api/worlds/[id]/reports — user bootstrap errors", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when getOrCreateDbUser throws a DB error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("connection refused")
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the Clerk user has no email address", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("Clerk user has no email address — FORGE requires email")
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// World existence
// ============================================================================

describe("POST /api/worlds/[id]/reports — world existence", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
    mockGetOrCreateDbUser.mockResolvedValue(ACTIVE_DB_USER);
    mockDbSelectLimit.mockResolvedValue([]); // world not found

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Success path
// ============================================================================

describe("POST /api/worlds/[id]/reports — success", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 {reported: true} on a new report", async () => {
    setupHappyPath();

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reported: true });
  });

  it("returns 200 {reported: true} on a duplicate report (idempotent re-report)", async () => {
    // onConflictDoNothing means a second report for the same (reporter, world)
    // is silently dropped at the DB level; the response is still 200 so we
    // don't leak whether the prior report existed.
    setupHappyPath();

    const res1 = await callPost(VALID_WORLD_UUID);
    const res2 = await callPost(VALID_WORLD_UUID);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(await res1.json()).toEqual({ reported: true });
    expect(await res2.json()).toEqual({ reported: true });
  });
});

// ============================================================================
// CRITICAL — Suspension-exempt safety valve
// ============================================================================

describe("POST /api/worlds/[id]/reports — suspension-exempt safety valve", () => {
  beforeEach(() => vi.resetAllMocks());

  /**
   * CRITICAL TEST: A suspended user must still be able to file reports.
   *
   * This endpoint intentionally does NOT call requireActiveDbUser.
   * It calls getOrCreateDbUser directly, so the suspension check is never
   * reached. A suspended user who witnesses genuinely harmful content posted
   * by others must have a path to flag it — this is the anti-abuse safety
   * valve described in the Slice 6 plan.
   *
   * If this test fails it means someone added a suspension check to this
   * route. That is a SPEC VIOLATION. Owner: backend-dev.
   */
  it("returns 200 when the caller is a SUSPENDED user (suspension-exempt endpoint)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(VALID_CLERK_USER);
    // Inject a suspended user — suspendedAt is set, not null
    mockGetOrCreateDbUser.mockResolvedValue(SUSPENDED_DB_USER);
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
    mockDbInsertConflict.mockResolvedValue(undefined);

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reported: true });
  });
});
