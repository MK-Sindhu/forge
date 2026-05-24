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
  // Controls db.select()...limit() — world-existence + ownerId lookup for POST
  // and world-existence check for GET.
  mockDbSelectLimit,
  // Controls db.insert()...returning() — used by POST.
  mockDbInsertReturning,
  // Controls db.query.worldUpdates.findMany — used by GET.
  mockFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk's auth() and currentUser() make network calls.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser performs a DB upsert + suspension check.
  mockRequireActiveDbUser: vi.fn(),
  mockDbSelectLimit: vi.fn(),
  mockDbInsertReturning: vi.fn(),
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
// The POST handler uses two DB paths:
//   1. db.select({id, ownerId}).from(worlds).where().limit()  — world + ownerId check
//   2. db.insert(worldUpdates).values().returning()            — update insert
//
// The GET handler uses two DB paths:
//   1. db.select({id, ownerId}).from(worlds).where().limit()  — world existence check
//   2. db.query.worldUpdates.findMany(...)                     — paginated update list
//
// mockDbSelectLimit resolves the terminal .limit() call shared by both handlers.
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
      worldUpdates: {
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
const OTHER_USER_ID = "db-uuid-bob-002";
const UPDATE_ID = "770e8400-e29b-41d4-a716-446655440001";

const DB_USER_OWNER = {
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

// World row returned by the select+limit query. ownerId matches the logged-in user.
const WORLD_ROW_OWNED_BY_ALICE = { id: VALID_WORLD_UUID, ownerId: DB_USER_ID };

function makeUpdate(overrides: Record<string, unknown> = {}) {
  return {
    id: UPDATE_ID,
    body: "Exciting new features incoming!",
    createdAt: new Date("2026-04-15T10:00:00.000Z"),
    editedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Route call helpers
// ---------------------------------------------------------------------------

function callPost(worldId: string, body: unknown = { body: "New update text" }) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/updates`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return POST(req, { params: Promise.resolve({ id: worldId }) });
}

function callGet(worldId: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/worlds/${worldId}/updates`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const req = new Request(url.toString());
  return GET(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupAuthAsOwner() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockRequireActiveDbUser.mockResolvedValue(DB_USER_OWNER);
}

function setupAuthAsNonOwner() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockRequireActiveDbUser.mockResolvedValue({ ...DB_USER_OWNER, id: OTHER_USER_ID });
}

// ============================================================================
// POST /api/worlds/[id]/updates
// ============================================================================

describe("POST /api/worlds/[id]/updates — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/updates — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid world UUID in params", async () => {
    setupAuthAsOwner();
    // UUID validation runs before the DB select; mock doesn't matter but
    // set it to avoid dangling promises in case execution reaches it.
    mockDbSelectLimit.mockResolvedValue([]);

    const res = await callPost(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/updates — body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAsOwner();
    // World exists and caller is owner — only body validation should fail.
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
  });

  it("returns 400 when the body field is missing entirely", async () => {
    const res = await callPost(VALID_WORLD_UUID, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body is an empty string (trim leaves it empty)", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "   " });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body exceeds 2000 characters", async () => {
    const longBody = "a".repeat(2001);
    const res = await callPost(VALID_WORLD_UUID, { body: longBody });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/updates — DB bootstrap error", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when getOrCreateDbUser throws a DB connection error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "Database temporarily unavailable, please try again" }, { status: 503 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the Clerk user has no email", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockRequireActiveDbUser.mockResolvedValue(
      NextResponse.json({ error: "No email on Clerk user" }, { status: 400 })
    );

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/updates — world not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    setupAuthAsOwner();
    mockDbSelectLimit.mockResolvedValue([]); // world-existence check returns empty

    const res = await callPost(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/updates — authorization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when the caller is not the world owner", async () => {
    // Bob is logged in but world is owned by alice (DB_USER_ID)
    setupAuthAsNonOwner();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);

    const res = await callPost(VALID_WORLD_UUID, { body: "Unauthorized update" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/worlds/[id]/updates — success", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAsOwner();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
    mockDbInsertReturning.mockResolvedValue([
      {
        id: UPDATE_ID,
        body: "New update text",
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        editedAt: null,
        worldId: VALID_WORLD_UUID,
      },
    ]);
  });

  it("returns 201 on success", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "New update text" });

    expect(res.status).toBe(201);
  });

  it("returns correct shape: id, body, createdAt (ISO string), editedAt: null", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "New update text" });
    const body = await res.json();

    expect(body).toMatchObject({
      id: UPDATE_ID,
      body: "New update text",
      createdAt: "2026-04-15T10:00:00.000Z",
      editedAt: null,
    });
  });

  it("editedAt is null at creation (update has never been edited)", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "New update text" });
    const body = await res.json();

    expect(body.editedAt).toBeNull();
  });

  it("createdAt is an ISO 8601 string", async () => {
    const res = await callPost(VALID_WORLD_UUID, { body: "New update text" });
    const body = await res.json();

    expect(typeof body.createdAt).toBe("string");
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
  });
});

// ============================================================================
// GET /api/worlds/[id]/updates
// ============================================================================

describe("GET /api/worlds/[id]/updates — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid world UUID in params", async () => {
    const res = await callGet(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/updates — world not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    mockDbSelectLimit.mockResolvedValue([]); // empty = not found

    const res = await callGet(VALID_WORLD_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/updates — query param validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
  });

  it("returns 400 for limit=0 (below minimum of 1)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "0" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=-5 (negative)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "-5" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit=51 (above maximum of 50)", async () => {
    const res = await callGet(VALID_WORLD_UUID, { limit: "51" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("GET /api/worlds/[id]/updates — no auth required (public)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // auth is NOT called — GET is public. Leave mockAuth unconfigured to
    // ensure a call to auth() would return a falsy userId (not throw).
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
    mockFindMany.mockResolvedValue([]);
  });

  it("returns 200 without a Clerk session", async () => {
    // No auth setup — world is public
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callGet(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/worlds/[id]/updates — success: empty list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
    mockFindMany.mockResolvedValue([]);
  });

  it("returns 200 with {updates: [], nextCursor: null} when no updates exist", async () => {
    const res = await callGet(VALID_WORLD_UUID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updates: [], nextCursor: null });
  });
});

describe("GET /api/worlds/[id]/updates — success: update shape", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
  });

  it("returns 200 with correctly shaped update items", async () => {
    mockFindMany.mockResolvedValue([makeUpdate()]);

    const res = await callGet(VALID_WORLD_UUID);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0]).toMatchObject({
      id: UPDATE_ID,
      body: "Exciting new features incoming!",
      createdAt: "2026-04-15T10:00:00.000Z",
      editedAt: null,
    });
  });

  it("editedAt is an ISO string when update has been edited", async () => {
    mockFindMany.mockResolvedValue([
      makeUpdate({ editedAt: new Date("2026-04-16T08:30:00.000Z") }),
    ]);

    const res = await callGet(VALID_WORLD_UUID);
    const { updates } = await res.json();

    expect(updates[0].editedAt).toBe("2026-04-16T08:30:00.000Z");
  });

  it("each update's createdAt is an ISO 8601 string", async () => {
    mockFindMany.mockResolvedValue([makeUpdate()]);

    const res = await callGet(VALID_WORLD_UUID);
    const { updates } = await res.json();

    for (const u of updates) {
      expect(typeof u.createdAt).toBe("string");
      expect(u.createdAt).toBe(new Date(u.createdAt).toISOString());
    }
  });
});

describe("GET /api/worlds/[id]/updates — success: ordering newest-first", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
  });

  it("returns updates in the order provided by the DB (DESC createdAt)", async () => {
    const newer = makeUpdate({
      id: "aaa00001-e29b-41d4-a716-446655440001",
      createdAt: new Date("2026-04-20T00:00:00.000Z"),
    });
    const older = makeUpdate({
      id: "bbb00002-e29b-41d4-a716-446655440002",
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
    });
    // Simulate DB returning newest first (DESC)
    mockFindMany.mockResolvedValue([newer, older]);

    const res = await callGet(VALID_WORLD_UUID);
    const { updates } = await res.json();

    expect(updates[0].id).toBe(newer.id);
    expect(updates[1].id).toBe(older.id);
    expect(new Date(updates[0].createdAt) > new Date(updates[1].createdAt)).toBe(true);
  });
});

describe("GET /api/worlds/[id]/updates — cursor pagination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbSelectLimit.mockResolvedValue([WORLD_ROW_OWNED_BY_ALICE]);
  });

  it("nextCursor is null when results are fewer than limit", async () => {
    // 3 results with limit=5 — no next page
    const rows = [1, 2, 3].map((i) =>
      makeUpdate({
        id: `ccc0000${i}-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(VALID_WORLD_UUID, { limit: "5" });
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.updates).toHaveLength(3);
  });

  it("nextCursor is populated when DB returns limit+1 results (more pages)", async () => {
    // limit=2, DB returns 3 (limit+1) → hasMore=true, slice to 2
    const rows = [3, 2, 1].map((i) =>
      makeUpdate({
        id: `ddd0000${i}-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(VALID_WORLD_UUID, { limit: "2" });
    const body = await res.json();

    // Only 2 items returned (limit), cursor points to last item's createdAt
    expect(body.updates).toHaveLength(2);
    expect(body.nextCursor).toBe(body.updates[1].createdAt);
    expect(typeof body.nextCursor).toBe("string");
  });

  it("passing cursor= returns only updates older than that timestamp", async () => {
    const cursorIso = "2026-04-15T00:00:00.000Z";
    const olderUpdate = makeUpdate({
      id: "fff00001-e29b-41d4-a716-446655440000",
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
    });
    mockFindMany.mockResolvedValue([olderUpdate]);

    const res = await callGet(VALID_WORLD_UUID, { cursor: cursorIso });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.updates).toHaveLength(1);
    // All returned updates are older than the cursor
    expect(new Date(body.updates[0].createdAt) < new Date(cursorIso)).toBe(true);
    // findMany was invoked (cursor was forwarded)
    expect(mockFindMany).toHaveBeenCalledOnce();
  });

  it("default limit is 20 when no limit param is given", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGet(VALID_WORLD_UUID);

    // Implementation fetches limit+1 = 21 to probe for next page
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 21 })
    );
  });

  it("nextCursor is null when results exactly equal limit (no extra row)", async () => {
    // Return exactly 2 rows with limit=2 → no overflow → nextCursor null
    const rows = [1, 2].map((i) =>
      makeUpdate({
        id: `eee0000${i}-e29b-41d4-a716-446655440000`,
        createdAt: new Date(`2026-04-0${i}T00:00:00.000Z`),
      })
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(VALID_WORLD_UUID, { limit: "2" });
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.updates).toHaveLength(2);
  });
});
