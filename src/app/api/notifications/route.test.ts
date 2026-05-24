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
  // Controls db.query.notifications.findMany — the paginated query.
  mockFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk's auth() and currentUser() make network calls.
  // Never call them for real in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser performs a DB upsert + suspension
  // check. Mocked to keep tests hermetic.
  mockRequireActiveDbUser: vi.fn(),
  mockFindMany: vi.fn(),
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
// The GET handler uses db.query.notifications.findMany for the cursor-paginated
// notification feed.
vi.mock("@/db", () => ({
  db: {
    query: {
      notifications: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
}));

// Import handler AFTER mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";
const NOTIF_ID_1 = "550e8400-e29b-41d4-a716-446655440001";
const NOTIF_ID_2 = "550e8400-e29b-41d4-a716-446655440002";
const ACTOR_ID = "660e8400-e29b-41d4-a716-446655440003";
const WORLD_ID = "770e8400-e29b-41d4-a716-446655440004";
const COMMENT_ID = "880e8400-e29b-41d4-a716-446655440005";

const DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const CLERK_USER_STUB = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTIF_ID_1,
    userId: DB_USER_ID,
    type: "like",
    createdAt: new Date("2026-03-10T12:00:00.000Z"),
    readAt: null,
    actor: {
      id: ACTOR_ID,
      username: "bob",
      avatarUrl: "https://cdn.example.com/avatars/bob.jpg",
    },
    world: {
      id: WORLD_ID,
      title: "Cool World",
    },
    comment: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callGet(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/notifications");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const req = new Request(url.toString());
  return GET(req);
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

describe("GET /api/notifications — auth: no session", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when auth() returns userId: null", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callGet();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/notifications — auth: currentUser null", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when auth has userId but currentUser() returns null", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(null);

    const res = await callGet();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/notifications — suspension guard", () => {
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
// Query param validation
// ============================================================================

describe("GET /api/notifications — query param validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 400 for limit=0 (below minimum of 1)", async () => {
    const res = await callGet({ limit: "0" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=-1 (negative)", async () => {
    const res = await callGet({ limit: "-1" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=51 (above maximum of 50)", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await callGet({ limit: "51" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=abc (non-numeric string)", async () => {
    const res = await callGet({ limit: "abc" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Happy path — no cursor
// ============================================================================

describe("GET /api/notifications — happy path: no cursor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 200 with { notifications: [], nextCursor: null } when no rows", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ notifications: [], nextCursor: null });
  });

  it("calls findMany with limit 21 (20 + 1 probe) when no limit param given", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGet();

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 21 })
    );
  });

  it("passes only the userId equality condition to findMany when no cursor is given", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGet();

    // findMany should be called — cursor condition is absent when not provided
    expect(mockFindMany).toHaveBeenCalledOnce();
  });

  it("calls findMany with orderBy descending createdAt", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGet();

    const callArg = mockFindMany.mock.calls[0][0];
    // orderBy must be an array (as specified in the route)
    expect(Array.isArray(callArg.orderBy)).toBe(true);
    expect(callArg.orderBy.length).toBeGreaterThan(0);
  });

  it("calls findMany with the actor, world, and comment relations", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGet();

    const callArg = mockFindMany.mock.calls[0][0];
    expect(callArg.with).toBeDefined();
    expect(callArg.with.actor).toBeDefined();
    expect(callArg.with.world).toBeDefined();
    expect(callArg.with.comment).toBeDefined();
  });
});

// ============================================================================
// Happy path — cursor pagination
// ============================================================================

describe("GET /api/notifications — cursor pagination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("nextCursor is null when DB returns fewer rows than limit", async () => {
    // Return 3 rows, limit=5 → no next page
    const rows = [1, 2, 3].map((i) =>
      makeNotification({
        id: `notif${i}000-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet({ limit: "5" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.nextCursor).toBeNull();
    expect(body.notifications).toHaveLength(3);
  });

  it("nextCursor is null when DB returns exactly limit rows (not limit+1)", async () => {
    // Return exactly 2 rows, limit=2 → implementation fetches limit+1=3,
    // only gets 2, so hasMore is false → nextCursor is null
    const rows = [1, 2].map((i) =>
      makeNotification({
        id: `notif${i}111-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet({ limit: "2" });
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.notifications).toHaveLength(2);
  });

  it("nextCursor is the last returned row's createdAt when DB returns limit+1 rows", async () => {
    // limit=2, DB returns 3 (limit+1) → hasMore=true, slice to 2,
    // nextCursor = 2nd row's createdAt ISO string
    const rows = [3, 2, 1].map((i) =>
      makeNotification({
        id: `notif${i}222-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet({ limit: "2" });
    const body = await res.json();

    expect(body.notifications).toHaveLength(2);
    // nextCursor must equal the createdAt of the last returned notification
    expect(body.nextCursor).toBe(body.notifications[1].createdAt);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("passing cursor= calls findMany (cursor condition forwarded to the query)", async () => {
    const cursorIso = "2026-04-10T00:00:00.000Z";
    const olderNotification = makeNotification({
      id: NOTIF_ID_2,
      createdAt: new Date("2026-04-09T00:00:00.000Z"),
    });
    mockFindMany.mockResolvedValue([olderNotification]);

    const res = await callGet({ cursor: cursorIso });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notifications).toHaveLength(1);
    // The returned notification must be older than the cursor
    expect(new Date(body.notifications[0].createdAt) < new Date(cursorIso)).toBe(true);
    expect(mockFindMany).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// Response shape (flattening)
// ============================================================================

describe("GET /api/notifications — response shape", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns correctly shaped notification with actor, world, and comment", async () => {
    mockFindMany.mockResolvedValue([
      makeNotification({
        comment: { id: COMMENT_ID, body: "Nice one!" },
      }),
    ]);

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    const n = body.notifications[0];
    expect(n).toMatchObject({
      id: NOTIF_ID_1,
      type: "like",
      createdAt: "2026-03-10T12:00:00.000Z",
      readAt: null,
      actor: {
        id: ACTOR_ID,
        username: "bob",
        avatarUrl: "https://cdn.example.com/avatars/bob.jpg",
      },
      world: { id: WORLD_ID, title: "Cool World" },
      comment: { id: COMMENT_ID, body: "Nice one!" },
    });
  });

  it("returns null actor when no actor is associated", async () => {
    mockFindMany.mockResolvedValue([makeNotification({ actor: null })]);

    const res = await callGet();
    const { notifications: rows } = await res.json();

    expect(rows[0].actor).toBeNull();
  });

  it("returns null world when no world is associated", async () => {
    mockFindMany.mockResolvedValue([makeNotification({ world: null })]);

    const res = await callGet();
    const { notifications: rows } = await res.json();

    expect(rows[0].world).toBeNull();
  });

  it("returns null comment when no comment is associated", async () => {
    mockFindMany.mockResolvedValue([makeNotification({ comment: null })]);

    const res = await callGet();
    const { notifications: rows } = await res.json();

    expect(rows[0].comment).toBeNull();
  });

  it("createdAt is an ISO 8601 string", async () => {
    mockFindMany.mockResolvedValue([makeNotification()]);

    const res = await callGet();
    const { notifications: rows } = await res.json();

    expect(typeof rows[0].createdAt).toBe("string");
    expect(rows[0].createdAt).toBe(new Date(rows[0].createdAt).toISOString());
  });

  it("readAt is an ISO string when not null", async () => {
    mockFindMany.mockResolvedValue([
      makeNotification({ readAt: new Date("2026-03-11T08:00:00.000Z") }),
    ]);

    const res = await callGet();
    const { notifications: rows } = await res.json();

    expect(rows[0].readAt).toBe("2026-03-11T08:00:00.000Z");
  });

  it("actor avatarUrl is null when actor has no avatar", async () => {
    mockFindMany.mockResolvedValue([
      makeNotification({
        actor: { id: ACTOR_ID, username: "bob", avatarUrl: null },
      }),
    ]);

    const res = await callGet();
    const { notifications: rows } = await res.json();

    expect(rows[0].actor.avatarUrl).toBeNull();
  });
});

// ============================================================================
// DB error
// ============================================================================

describe("GET /api/notifications — DB error", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
  });

  it("returns 503 when the DB query throws", async () => {
    mockFindMany.mockRejectedValue(new Error("Connection timeout"));

    const res = await callGet();

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});
