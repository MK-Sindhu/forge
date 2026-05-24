import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const { mockFindFirst, mockAuth, mockSelectFrom, mockCountQuery } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockAuth: vi.fn(),
  // mockSelectFrom covers db.select().from().where().limit() chains used for
  // the user-lookup, like-lookup, and repost-lookup in the opportunistic auth path.
  mockSelectFrom: vi.fn(),
  // mockCountQuery covers db.select({ count: count() }).from().where() —
  // the commentsCount aggregate which is awaited directly (no .limit()).
  mockCountQuery: vi.fn(),
}));

// Mock @/db — the GET handler uses:
//   db.query.worlds.findFirst  (relational query for world + author + media)
//   db.select({ count }).from().where()           (commentsCount aggregate)
//   db.select().from().where().limit()            (user lookup, like lookup, repost lookup)
vi.mock("@/db", () => {
  // The chainable object is shared for all db.select() chains.
  // where() returns a thenable-chainable so it can be both:
  //   - awaited directly (commentsCount path: .from().where())
  //   - chained further with .limit() (user/like/repost paths)
  const chainable: Record<string, unknown> = {};
  chainable["from"] = () => chainable;
  chainable["where"] = () => {
    // Returns an object that is awaitable AND has a .limit() method.
    const whereResult: Record<string, unknown> = {
      limit: (..._args: unknown[]) => mockSelectFrom(),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(mockCountQuery()).then(resolve, reject),
    };
    return whereResult;
  };
  return {
    db: {
      query: {
        worlds: {
          findFirst: (...args: unknown[]) => mockFindFirst(...args),
        },
      },
      select: () => chainable,
    },
  };
});

// Mock @clerk/nextjs/server — default to signed-out (userId: null).
vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));

// Import the handler AFTER mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOT_A_UUID = "not-a-uuid";

const DB_WORLD_ROW = {
  id: WORLD_ID,
  title: "Test World",
  description: "A cool world",
  glbUrl: "https://cdn.example.com/glb/worlds/user1/world.glb",
  glbSizeBytes: 4096,
  likesCount: 3,
  views: 42,
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  user: {
    id: "db-user-uuid-001",
    username: "alice",
    avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
  },
  media: [
    {
      id: "media-uuid-001",
      type: "thumbnail",
      url: "https://cdn.example.com/media/thumb.jpg",
      sizeBytes: 512,
      position: 0,
    },
    {
      id: "media-uuid-002",
      type: "image",
      url: "https://cdn.example.com/media/screenshot.jpg",
      sizeBytes: 800,
      position: 1,
    },
  ],
  tags: [],
};

// DB user row returned by the user-lookup chain (signed-in path).
const DB_CURRENT_USER = { id: "db-user-uuid-viewer-001" };

// ---------------------------------------------------------------------------
// Helper: build a Request for GET /api/worlds/[id]
// (body is irrelevant for GET, but we construct it for completeness)
// ---------------------------------------------------------------------------

function makeRequest(worldId: string): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost/api/worlds/${worldId}`);
  const context = { params: Promise.resolve({ id: worldId }) };
  return [req, context];
}

// ---------------------------------------------------------------------------
// Block A — UUID validation
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — UUID validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // UUID-validation tests never reach auth — but auth is still called
    // after the world is found, so set a safe default for completeness.
    mockAuth.mockResolvedValue({ userId: null });
    mockCountQuery.mockResolvedValue([{ count: 0 }]);
  });

  it("returns 400 for a non-UUID id", async () => {
    const [req, ctx] = makeRequest(NOT_A_UUID);
    const res = await GET(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid world id" });
  });

  it("returns 400 for an empty string id", async () => {
    const [req, ctx] = makeRequest("");
    const res = await GET(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid world id" });
  });

  it("returns 400 for a numeric string id", async () => {
    const [req, ctx] = makeRequest("12345");
    const res = await GET(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid world id" });
  });

  it("does NOT call db.query for an invalid id", async () => {
    const [req, ctx] = makeRequest(NOT_A_UUID);
    await GET(req, ctx);

    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block B — Not found
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — Not found", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: null });
    mockCountQuery.mockResolvedValue([{ count: 0 }]);
  });

  it("returns 404 when db returns undefined", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "World not found" });
  });

  it("calls db.query.worlds.findFirst with the correct UUID", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const [req, ctx] = makeRequest(WORLD_ID);
    await GET(req, ctx);

    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Block C — Success path (signed-out — isLikedByCurrentUser always false)
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — Success", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindFirst.mockResolvedValue(DB_WORLD_ROW);
    // Default: signed-out visitor.
    mockAuth.mockResolvedValue({ userId: null });
    // Default: 0 comments.
    mockCountQuery.mockResolvedValue([{ count: 0 }]);
  });

  it("returns 200 for a valid UUID that exists", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
  });

  it("returns the correct top-level world fields", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body).toMatchObject({
      id: WORLD_ID,
      title: "Test World",
      description: "A cool world",
      glbUrl: "https://cdn.example.com/glb/worlds/user1/world.glb",
      glbSizeBytes: 4096,
      likesCount: 3,
      views: 42,
    });
  });

  it("returns createdAt as an ISO 8601 string", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.createdAt).toBe("2026-01-15T10:00:00.000Z");
  });

  it("returns the author with id, username, avatarUrl only", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.author).toEqual({
      id: "db-user-uuid-001",
      username: "alice",
      avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
    });
  });

  it("does NOT expose author email, clerkId, tosAcceptedAt, or createdAt", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.author).not.toHaveProperty("email");
    expect(body.author).not.toHaveProperty("clerkId");
    expect(body.author).not.toHaveProperty("tosAcceptedAt");
    expect(body.author).not.toHaveProperty("createdAt");
  });

  it("returns the media array ordered as returned from the DB", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.media).toHaveLength(2);
    expect(body.media[0]).toEqual({
      id: "media-uuid-001",
      type: "thumbnail",
      url: "https://cdn.example.com/media/thumb.jpg",
      sizeBytes: 512,
      position: 0,
    });
    expect(body.media[1]).toEqual({
      id: "media-uuid-002",
      type: "image",
      url: "https://cdn.example.com/media/screenshot.jpg",
      sizeBytes: 800,
      position: 1,
    });
  });

  it("returns an empty media array when no media rows exist", async () => {
    mockFindFirst.mockResolvedValue({ ...DB_WORLD_ROW, media: [] });

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.media).toEqual([]);
  });

  it("returns null for description when it is null in the DB", async () => {
    mockFindFirst.mockResolvedValue({ ...DB_WORLD_ROW, description: null });

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.description).toBeNull();
  });

  it("returns null for author.avatarUrl when it is null in the DB", async () => {
    mockFindFirst.mockResolvedValue({
      ...DB_WORLD_ROW,
      user: { ...DB_WORLD_ROW.user, avatarUrl: null },
    });

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.author.avatarUrl).toBeNull();
  });

  it("response has exactly the documented top-level keys", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    const expectedKeys = new Set([
      "id",
      "title",
      "description",
      "glbUrl",
      "glbSizeBytes",
      "likesCount",
      "views",
      "createdAt",
      "commentsCount",
      "author",
      "media",
      "tags",
      "isLikedByCurrentUser",
      "isRepostedByCurrentUser",
    ]);
    const actualKeys = new Set(Object.keys(body));

    expect(actualKeys).toEqual(expectedKeys);
  });

  it("returns isLikedByCurrentUser: false for a signed-out visitor", async () => {
    // mockAuth already returns { userId: null } in beforeEach
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.isLikedByCurrentUser).toBe(false);
  });

  it("does not query the likes or reposts tables when signed-out", async () => {
    // mockAuth returns { userId: null } — auth-gated DB chains must not fire.
    const [req, ctx] = makeRequest(WORLD_ID);
    await GET(req, ctx);

    // mockSelectFrom covers the chained .limit() call on user-lookup,
    // like-lookup, and repost-lookup chains. For a signed-out user none of
    // those chains run (commentsCount uses mockCountQuery, not mockSelectFrom).
    expect(mockSelectFrom).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block D — isLikedByCurrentUser (signed-in paths)
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — isLikedByCurrentUser (signed-in)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindFirst.mockResolvedValue(DB_WORLD_ROW);
    mockAuth.mockResolvedValue({ userId: "clerk_user_abc" });
    mockCountQuery.mockResolvedValue([{ count: 0 }]);
  });

  it("returns isLikedByCurrentUser: true when the signed-in user has liked the world", async () => {
    // select chains: user lookup, like row exists, repost lookup (not reposted).
    mockSelectFrom
      .mockResolvedValueOnce([DB_CURRENT_USER])            // user lookup
      .mockResolvedValueOnce([{ userId: DB_CURRENT_USER.id }])  // like exists
      .mockResolvedValueOnce([]);                          // no repost row

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isLikedByCurrentUser).toBe(true);
  });

  it("returns isLikedByCurrentUser: false when the signed-in user has NOT liked the world", async () => {
    // User found but no like row; also no repost.
    mockSelectFrom
      .mockResolvedValueOnce([DB_CURRENT_USER])  // user lookup
      .mockResolvedValueOnce([])                 // no like row
      .mockResolvedValueOnce([]);                // no repost row

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isLikedByCurrentUser).toBe(false);
  });

  it("returns isLikedByCurrentUser: false when signed-in user has no DB row yet", async () => {
    // Clerk userId present but user hasn't uploaded/bootstrapped a DB row.
    mockSelectFrom.mockResolvedValueOnce([]);  // user lookup returns empty

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isLikedByCurrentUser).toBe(false);
    // Like-lookup and repost-lookup must NOT be called — only one select chain fires.
    expect(mockSelectFrom).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Block E — commentsCount
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — commentsCount", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindFirst.mockResolvedValue(DB_WORLD_ROW);
    mockAuth.mockResolvedValue({ userId: null });
  });

  it("returns commentsCount: 0 when there are no comments", async () => {
    mockCountQuery.mockResolvedValue([{ count: 0 }]);

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.commentsCount).toBe(0);
  });

  it("returns commentsCount reflecting the actual DB aggregate", async () => {
    mockCountQuery.mockResolvedValue([{ count: 17 }]);

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.commentsCount).toBe(17);
  });

  it("returns commentsCount for signed-out users (always public)", async () => {
    mockCountQuery.mockResolvedValue([{ count: 5 }]);

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.commentsCount).toBe(5);
    // Auth-gated select chains must not have fired for a signed-out user.
    expect(mockSelectFrom).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block F — isRepostedByCurrentUser (signed-in paths)
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — isRepostedByCurrentUser (signed-in)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindFirst.mockResolvedValue(DB_WORLD_ROW);
    mockAuth.mockResolvedValue({ userId: "clerk_user_abc" });
    mockCountQuery.mockResolvedValue([{ count: 0 }]);
  });

  it("returns isRepostedByCurrentUser: true when the signed-in user has reposted the world", async () => {
    mockSelectFrom
      .mockResolvedValueOnce([DB_CURRENT_USER])            // user lookup
      .mockResolvedValueOnce([])                           // no like row
      .mockResolvedValueOnce([{ userId: DB_CURRENT_USER.id }]);  // repost exists

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isRepostedByCurrentUser).toBe(true);
  });

  it("returns isRepostedByCurrentUser: false when the signed-in user has NOT reposted the world", async () => {
    mockSelectFrom
      .mockResolvedValueOnce([DB_CURRENT_USER])  // user lookup
      .mockResolvedValueOnce([])                 // no like row
      .mockResolvedValueOnce([]);                // no repost row

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isRepostedByCurrentUser).toBe(false);
  });

  it("returns isRepostedByCurrentUser: false for signed-out users without querying reposts table", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockCountQuery.mockResolvedValue([{ count: 0 }]);

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isRepostedByCurrentUser).toBe(false);
    // No auth-gated select chains should fire for a signed-out user.
    expect(mockSelectFrom).not.toHaveBeenCalled();
  });

  it("returns isRepostedByCurrentUser: false when signed-in user has no DB row yet", async () => {
    mockSelectFrom.mockResolvedValueOnce([]);  // user lookup returns empty

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.isRepostedByCurrentUser).toBe(false);
    // Repost-lookup must NOT be called — bail out after missing user row.
    expect(mockSelectFrom).toHaveBeenCalledTimes(1);
  });
});
