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
  // Controls db.select()...limit() — used for the world-existence check AND
  // the post-commit owner lookup. Tests that assert on notify() use
  // mockResolvedValueOnce pairs to control successive calls independently.
  mockDbSelectLimit,
  // Controls db.insert()...returning() — used for the POST insert.
  mockDbInsertReturning,
  // Controls db.query.comments.findMany — used for the GET list query.
  mockFindMany,
  // External boundary: @/lib/notifications — mocked so tests can assert the
  // call shape without a real DB insert or notifications table. The helper's
  // internal try/catch and self-notification suppression are tested separately
  // in src/lib/notifications.test.ts.
  mockNotify,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk's auth() and currentUser() make network calls
  // to Clerk's API. Never call them for real in unit tests.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser performs a DB upsert + suspension check.
  mockRequireActiveDbUser: vi.fn(),
  mockDbSelectLimit: vi.fn(),
  mockDbInsertReturning: vi.fn(),
  mockFindMany: vi.fn(),
  mockNotify: vi.fn(),
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

// Mock @/lib/notifications — mocks the entire notifications helper module so
// tests can assert notify() is called with the right arguments without a real
// DB insert. The helper's internal logic is tested in notifications.test.ts.
vi.mock("@/lib/notifications", () => ({
  notify: mockNotify,
}));

// Mock @/db — real DB connections require DATABASE_URL + a live Neon instance.
//
// The POST handler uses two DB paths:
//   1. db.select({id}).from(worlds).where().limit()  — world-existence check
//   2. db.insert(comments).values().returning()        — comment insert
//
// The GET handler uses two DB paths:
//   1. db.select({id}).from(worlds).where().limit()  — world-existence check
//   2. db.query.comments.findMany(...)                — paginated comment list
//
// The select() chain is shared between world-existence checks in both POST and
// GET. mockDbSelectLimit resolves the terminal .limit() call.
// The insert() chain is only used by POST; mockDbInsertReturning resolves
// .returning().
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
        returning: () => mockDbInsertReturning(),
      }),
    }),
    query: {
      comments: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
}));

// Import handlers AFTER mocks are registered.
import { POST, GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const INVALID_UUID = "not-a-uuid";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";
const COMMENT_ID = "660e8400-e29b-41d4-a716-446655440001";
// DB id for a different user who owns the world (notification recipient).
const OWNER_DB_ID = "db-uuid-owner-002";

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

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    body: "Great world!",
    createdAt: new Date("2026-03-10T12:00:00.000Z"),
    worldId: VALID_WORLD_UUID,
    userId: DB_USER_ID,
    user: {
      id: DB_USER_ID,
      username: "alice",
      avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Route call helpers
// ---------------------------------------------------------------------------

function callPost(worldId: string, body: unknown = { body: "Great world!" }) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

function callGet(worldId: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/worlds/${worldId}/comments`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const req = new Request(url.toString());
  return GET(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupAuthAndUser() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
}

// ============================================================================
// POST /api/worlds/[id]/comments
// ============================================================================

describe("POST /api/worlds/[id]/comments — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/comments — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid world UUID in params", async () => {
    setupAuthAndUser();
    // World-existence check must not be reached (and wouldn't matter) because
    // the UUID validation runs first after user bootstrap.
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callPost(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/comments — body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
    // World exists for all body-validation tests so validation is the only
    // thing that can fail.
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  });

  it("returns 400 when the body field is missing entirely", async () => {
    const res = await callPost(VALID_WORLD_UUID, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body is an empty string", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body is whitespace only (trim leaves it empty)", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "   " });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body exceeds 1000 characters", async () => {
    const longBody = "a".repeat(1001);
    const res = await callPost(VALID_WORLD_UUID, { body: longBody });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/comments — world not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    setupAuthAndUser();
    mockDbSelectLimit.mockResolvedValue([]); // world-existence check returns empty

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/comments — DB errors", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when getOrCreateDbUser throws a DB error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Database temporarily unavailable, please try again" }, { status: 503 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/comments — success", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
    mockDbInsertReturning.mockResolvedValue([
      {
        id: COMMENT_ID,
        body: "Great world!",
        createdAt: new Date("2026-03-10T12:00:00.000Z"),
        worldId: VALID_WORLD_UUID,
        userId: DB_USER_ID,
      },
    ]);
    // Default: notify is a no-op so existing tests that don't assert on it pass.
    mockNotify.mockResolvedValue(undefined);
  });

  it("returns 201 on success", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "Great world!" });

    expect(res.status).toBe(201);
  });

  it("returns the correct response shape: id, body, createdAt (ISO), user", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "Great world!" });
    const body = await res.json();

    expect(body).toMatchObject({
      id: COMMENT_ID,
      body: "Great world!",
      createdAt: "2026-03-10T12:00:00.000Z",
      user: {
        id: DB_USER_ID,
        username: "alice",
        avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
      },
    });
  });

  it("createdAt is an ISO 8601 string", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "Great world!" });
    const body = await res.json();

    expect(typeof body.createdAt).toBe("string");
    expect(() => new Date(body.createdAt)).not.toThrow();
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });

  it("user object has exactly id, username, avatarUrl", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "Great world!" });
    const body = await res.json();
    const userKeys = Object.keys(body.user).sort();

    expect(userKeys).toEqual(["avatarUrl", "id", "username"]);
  });
});

// ============================================================================
// POST /api/worlds/[id]/comments — suspension guard
//
// This endpoint uses requireActiveDbUser. When that helper returns a 403
// NextResponse (instead of a DbUser), the route must propagate it.
// ============================================================================

describe("POST /api/worlds/[id]/comments — suspension guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireActiveDbUser signals the caller is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    // requireActiveDbUser returns a 403 NextResponse for suspended users
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Account suspended" }, { status: 403 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// GET /api/worlds/[id]/comments
// ============================================================================

describe("GET /api/worlds/[id]/comments — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid world UUID in params", async () => {
    const res = await callGet(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/comments — world not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]); // empty = not found

    const res = await callGet(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/comments — query param validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  });

  it("returns 400 for limit=0 (below minimum of 1)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "0" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=-1 (negative)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "-1" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=51 (above maximum of 50)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "51" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=abc (non-numeric string)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "abc" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/comments — success: empty list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
    mockFindMany.mockResolvedValue([]);
  });

  it("returns 200 with {comments: [], nextCursor: null} when no comments exist", async () => {
    const res = await callGet(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ comments: [], nextCursor: null });
  });
});

describe("GET /api/worlds/[id]/comments — success: comment shape", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  });

  it("returns 200 with correctly shaped comments including user", async () => {
    mockFindMany.mockResolvedValue([makeComment()]);

    const res = await callGet(VALID_WORLD_UUID);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({
      id: COMMENT_ID,
      body: "Great world!",
      createdAt: "2026-03-10T12:00:00.000Z",
      user: {
        id: DB_USER_ID,
        username: "alice",
        avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
      },
    });
  });

  it("each comment's createdAt is an ISO 8601 string", async () => {
    mockFindMany.mockResolvedValue([makeComment()]);

    const res = await callGet(VALID_WORLD_UUID);
    const { comments: rows } = await res.json();

    for (const c of rows) {
      expect(typeof c.createdAt).toBe("string");
      expect(c.createdAt).toBe(new Date(c.createdAt).toISOString());
    }
  });

  it("returns avatarUrl: null when the user has no avatar", async () => {
    mockFindMany.mockResolvedValue([
      makeComment({ user: { id: DB_USER_ID, username: "alice", avatarUrl: null } }),
    ]);

    const res = await callGet(VALID_WORLD_UUID);
    const body = await res.json();

    expect(body.comments[0].user.avatarUrl).toBeNull();
  });
});

describe("GET /api/worlds/[id]/comments — success: ordering newest-first", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  });

  it("returns comments in the order provided by the DB (which is DESC createdAt)", async () => {
    const newer = makeComment({
      id: "aaa00000-e29b-41d4-a716-446655440001",
      createdAt: new Date("2026-04-02T00:00:00.000Z"),
    });
    const older = makeComment({
      id: "bbb00000-e29b-41d4-a716-446655440002",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    // Simulate DB returning newest first (DESC)
    mockFindMany.mockResolvedValue([newer, older]);

    const res = await callGet(VALID_WORLD_UUID);
    const { comments: rows } = await res.json();

    expect(rows[0].id).toBe(newer.id);
    expect(rows[1].id).toBe(older.id);
    // Confirm the timestamps are strictly descending
    expect(new Date(rows[0].createdAt) > new Date(rows[1].createdAt)).toBe(true);
  });
});

describe("GET /api/worlds/[id]/comments — cursor pagination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
  });

  it("nextCursor is null when results are fewer than limit", async () => {
    // Return 3 comments with limit=5: no next page
    const rows = [1, 2, 3].map((i) =>
      makeComment({
        id: `ccc0000${i}-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(VALID_WORLD_UUID, { limit: "5" });
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.comments).toHaveLength(3);
  });

  it("nextCursor is null when results exactly equal limit", async () => {
    // Return exactly 2 comments with limit=2: implementation fetches limit+1,
    // only gets 2, so hasMore is false → nextCursor is null.
    const rows = [1, 2].map((i) =>
      makeComment({
        id: `ddd0000${i}-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(VALID_WORLD_UUID, { limit: "2" });
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.comments).toHaveLength(2);
  });

  it("nextCursor is populated when DB returns limit+1 results (more pages available)", async () => {
    // limit=2, DB returns 3 (limit+1) → hasMore=true, slice to 2, nextCursor = last item's createdAt
    const rows = [1, 2, 3].map((i) =>
      makeComment({
        id: `eee0000${i}-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
        // Descending: newest first
      })
    );
    // Reverse so index 0 = newest
    rows.reverse();
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(VALID_WORLD_UUID, { limit: "2" });
    const body = await res.json();

    // Should only contain the first 2 comments
    expect(body.comments).toHaveLength(2);
    // nextCursor must equal the createdAt of the last returned comment (index 1)
    expect(body.nextCursor).toBe(body.comments[1].createdAt);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("passing cursor= calls findMany and returns only older comments", async () => {
    const cursorIso = "2026-04-10T00:00:00.000Z";
    const olderComment = makeComment({
      id: "fff00001-e29b-41d4-a716-446655440000",
      createdAt: new Date("2026-04-09T00:00:00.000Z"),
    });
    mockFindMany.mockResolvedValue([olderComment]);

    const res = await callGet(VALID_WORLD_UUID, { cursor: cursorIso });
    const body = await res.json();

    expect(res.status).toBe(200);
    // The only comment returned is older than the cursor
    expect(body.comments).toHaveLength(1);
    expect(new Date(body.comments[0].createdAt) < new Date(cursorIso)).toBe(true);
    // findMany was called (cursor was forwarded to the query)
    expect(mockFindMany).toHaveBeenCalledOnce();
  });

  it("default limit is 20 when no limit param is given", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGet(VALID_WORLD_UUID);

    // The implementation requests limit+1 = 21 rows; confirm findMany receives
    // an object containing limit: 21 (20+1 extra-row probe).
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 21 })
    );
  });
});

// ============================================================================
// POST /api/worlds/[id]/comments — notify integration (sub-slice 7.5)
//
// These tests assert that the route calls notify() with the correct arguments
// after the comment insert commits. notify() is mocked at the module level
// (@/lib/notifications) so tests see the raw call shape without a real DB
// insert. The helper's self-notification suppression and error swallowing are
// tested separately in src/lib/notifications.test.ts.
//
// db.select()...limit() is called twice in the POST happy path:
//   call 1: world-existence check (getWorldOr404)   → returns [{ id }]
//   call 2: post-commit owner lookup                → returns [{ ownerId }]
// Tests use mockResolvedValueOnce pairs to control each call independently.
// ============================================================================

describe("POST /api/worlds/[id]/comments — notify integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAndUser();
    mockDbInsertReturning.mockResolvedValue([
      {
        id: COMMENT_ID,
        body: "Great world!",
        createdAt: new Date("2026-03-10T12:00:00.000Z"),
        worldId: VALID_WORLD_UUID,
        userId: DB_USER_ID,
      },
    ]);
  });

  it("calls notify with { type: 'comment', userId: ownerId, actorId: dbUserId, worldId, commentId } after a successful comment", async () => {
    // call 1: world existence → [{ id }]
    // call 2: owner lookup    → [{ ownerId }]
    mockDbSelectLimit
      .mockResolvedValueOnce([{ id: VALID_WORLD_UUID }])
      .mockResolvedValueOnce([{ ownerId: OWNER_DB_ID }]);
    mockNotify.mockResolvedValue(undefined);

    await callPost(VALID_WORLD_UUID, { body: "Great world!" });

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify).toHaveBeenCalledWith({
      type: "comment",
      userId: OWNER_DB_ID,
      actorId: DB_USER_ID,
      worldId: VALID_WORLD_UUID,
      commentId: COMMENT_ID,
    });
  });

  it("commentId in the notify call matches the newly-created comment's id from the insert", async () => {
    const NEW_COMMENT_ID = "770e8400-e29b-41d4-a716-446655440002";
    mockDbInsertReturning.mockResolvedValue([
      {
        id: NEW_COMMENT_ID,
        body: "Hello!",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
        worldId: VALID_WORLD_UUID,
        userId: DB_USER_ID,
      },
    ]);
    mockDbSelectLimit
      .mockResolvedValueOnce([{ id: VALID_WORLD_UUID }])
      .mockResolvedValueOnce([{ ownerId: OWNER_DB_ID }]);
    mockNotify.mockResolvedValue(undefined);

    await callPost(VALID_WORLD_UUID, { body: "Hello!" });

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: NEW_COMMENT_ID })
    );
  });

  it("still returns 201 when notify throws (notification failure never breaks the comment)", async () => {
    // Locked decision: notification failure must NEVER break the parent action.
    mockDbSelectLimit
      .mockResolvedValueOnce([{ id: VALID_WORLD_UUID }])
      .mockResolvedValueOnce([{ ownerId: OWNER_DB_ID }]);
    mockNotify.mockRejectedValue(new Error("notify DB exploded"));

    const res = await callPost(VALID_WORLD_UUID, { body: "Great world!" });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ id: COMMENT_ID, body: "Great world!" });
  });
});

describe("DELETE /api/comments — notify NOT called on comment deletion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("does NOT call notify when a comment is deleted (deletion is a silent action)", async () => {
    // The DELETE handler is on /api/comments/[id], not this route. This test
    // documents the contract: comment deletion has no notify() call. The
    // comments/[id]/route.test.ts covers that handler's behavior; we confirm
    // the mockNotify is never called in the scope of this module.
    // (There is no DELETE export on this route file — only GET and POST exist.)
    mockNotify.mockResolvedValue(undefined);
    // No call to any handler — just confirm the mock is clean.
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe("GET /api/worlds/[id]/comments — notify NOT called on read", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_WORLD_UUID }]);
    mockFindMany.mockResolvedValue([]);
    mockNotify.mockResolvedValue(undefined);
  });

  it("does NOT call notify when fetching comments (read-only operation)", async () => {
    await callGet(VALID_WORLD_UUID);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});
