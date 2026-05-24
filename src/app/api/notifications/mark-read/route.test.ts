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
  mockRequireActiveDbUser,
  // Controls the terminal .returning() call on db.update(...).set(...).where(...)
  mockDbUpdateReturning,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk's auth() and currentUser() make network calls.
  // Never call them for real in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser performs a DB upsert + suspension check.
  mockRequireActiveDbUser: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
}));

// Mock @clerk/nextjs/server — guards against live Clerk calls.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB round-trip for user bootstrap.
vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mock @/db — real DB connections require DATABASE_URL + a live Neon instance.
//
// The POST handler uses:
//   db.update(notifications).set({ readAt }).where(...).returning({ id })
//
// We mock the full builder chain so the terminal .returning() call is
// interceptable. mockDbUpdateReturning controls what the "result" array is.
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: (..._args: unknown[]) => mockDbUpdateReturning(),
        }),
      }),
    }),
  },
}));

// Import handler AFTER mocks are registered.
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";
const NOTIF_ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const NOTIF_ID_2 = "550e8400-e29b-41d4-a716-446655440002";

const DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const CLERK_USER_STUB = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callPost(body: unknown) {
  const req = new Request("http://localhost/api/notifications/mark-read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

function setupAuthAndUser() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
}

// ============================================================================
// Auth
// ============================================================================

describe("POST /api/notifications/mark-read — auth: no session", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when auth() returns userId: null", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost({ all: true });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/notifications/mark-read — auth: currentUser null", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when auth has userId but currentUser() returns null", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(null);

    const res = await callPost({ all: true });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/notifications/mark-read — suspension guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireActiveDbUser signals the user is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Account suspended" }, { status: 403 })
    );

    const res = await callPost({ all: true });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Body validation
// ============================================================================

describe("POST /api/notifications/mark-read — body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 400 when body has neither 'ids' nor 'all'", async () => {
    const res = await callPost({});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when ids contains a non-UUID string", async () => {
    const res = await callPost({ ids: ["not-a-uuid"] });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when all is false and ids is absent (refine rejects)", async () => {
    // `all: false` does not satisfy the refine — must be true or ids must be present
    const res = await callPost({ all: false });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Happy path — mark all
// ============================================================================

describe("POST /api/notifications/mark-read — happy path: mark all", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 200 with { updated: N } when marking all unread", async () => {
    // Simulate 3 rows updated
    mockDbUpdateReturning.mockResolvedValue([
      { id: NOTIF_ID_1 },
      { id: NOTIF_ID_2 },
      { id: "660e8400-e29b-41d4-a716-446655440003" },
    ]);

    const res = await callPost({ all: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ updated: 3 });
  });

  it("returns { updated: 0 } when there are no unread notifications to mark", async () => {
    mockDbUpdateReturning.mockResolvedValue([]);

    const res = await callPost({ all: true });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ updated: 0 });
  });

  it("issues the DB update call once for mark-all", async () => {
    mockDbUpdateReturning.mockResolvedValue([{ id: NOTIF_ID_1 }]);

    await callPost({ all: true });

    // The update chain should have been resolved once
    expect(mockDbUpdateReturning).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Happy path — mark specific ids
// ============================================================================

describe("POST /api/notifications/mark-read — happy path: mark specific ids", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 200 with { updated: 2 } when two specific ids are marked", async () => {
    mockDbUpdateReturning.mockResolvedValue([
      { id: NOTIF_ID_1 },
      { id: NOTIF_ID_2 },
    ]);

    const res = await callPost({ ids: [NOTIF_ID_1, NOTIF_ID_2] });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ updated: 2 });
  });

  it("issues the DB update call once for specific ids", async () => {
    mockDbUpdateReturning.mockResolvedValue([{ id: NOTIF_ID_1 }]);

    await callPost({ ids: [NOTIF_ID_1] });

    expect(mockDbUpdateReturning).toHaveBeenCalledOnce();
  });

  it("returns { updated: 0 } when targeted rows are already read", async () => {
    // The WHERE includes readAt IS NULL — already-read rows are not matched
    mockDbUpdateReturning.mockResolvedValue([]);

    const res = await callPost({ ids: [NOTIF_ID_1] });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ updated: 0 });
  });
});

// ============================================================================
// all: true AND ids both present
// ============================================================================

describe("POST /api/notifications/mark-read — all: true and ids both provided", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("succeeds when both all: true and ids are provided (all branch wins per implementation)", async () => {
    // The implementation checks `if (all === true)` first, so all wins.
    // The route should not 400 on this; both conditions satisfy the refine.
    mockDbUpdateReturning.mockResolvedValue([{ id: NOTIF_ID_1 }]);

    const res = await callPost({ all: true, ids: [NOTIF_ID_1] });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ updated: expect.any(Number) });
  });
});

// ============================================================================
// DB error
// ============================================================================

describe("POST /api/notifications/mark-read — DB error", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 503 when the DB update throws", async () => {
    mockDbUpdateReturning.mockRejectedValue(new Error("DB unavailable"));

    const res = await callPost({ all: true });

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});
