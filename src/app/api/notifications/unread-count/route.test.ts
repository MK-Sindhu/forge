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
  // Controls the terminal .where() call on db.select({count}).from(notifications).where(...)
  mockDbSelectWhere,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk's auth() and currentUser() make network calls.
  // Never call them for real in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser performs a DB upsert + suspension check.
  mockRequireActiveDbUser: vi.fn(),
  mockDbSelectWhere: vi.fn(),
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
// The GET handler uses:
//   db.select({ count: count() }).from(notifications).where(and(eq(...), isNull(...)))
//
// We mock the builder chain so the terminal .where() call is interceptable.
// mockDbSelectWhere resolves to an array of one row: [{ count: N }].
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => mockDbSelectWhere(),
      }),
    }),
  },
}));

// Import handler AFTER mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const CLERK_USER_STUB = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callGet() {
  return GET();
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

describe("GET /api/notifications/unread-count — auth: no session", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when auth() returns userId: null", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callGet();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/notifications/unread-count — auth: currentUser null", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when auth has userId but currentUser() returns null", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/notifications/unread-count — suspension guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireActiveDbUser signals the user is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Account suspended" }, { status: 403 })
    );

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Happy path
// ============================================================================

describe("GET /api/notifications/unread-count — happy path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 200 with { count: N } for the signed-in user's unread notifications", async () => {
    // The query returns [{ count: 5 }]; route converts to number
    mockDbSelectWhere.mockResolvedValue([{ count: 5 }]);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ count: 5 });
  });

  it("returns { count: 0 } when there are no unread notifications", async () => {
    mockDbSelectWhere.mockResolvedValue([{ count: 0 }]);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ count: 0 });
  });

  it("count is a number (not a string)", async () => {
    mockDbSelectWhere.mockResolvedValue([{ count: "7" }]);

    const res = await callGet();
    const body = await res.json();

    // The route wraps with Number(), ensuring the response is numeric
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(7);
  });

  it("queries the DB once per request", async () => {
    mockDbSelectWhere.mockResolvedValue([{ count: 3 }]);

    await callGet();

    expect(mockDbSelectWhere).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// DB error
// ============================================================================

describe("GET /api/notifications/unread-count — DB error", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 503 when the DB query throws", async () => {
    mockDbSelectWhere.mockRejectedValue(new Error("Connection refused"));

    const res = await callGet();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});
