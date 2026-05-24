import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs before any import resolves. All values referenced inside
// vi.mock() factories must originate here.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockGetOrCreateDbUser,
  // Controls the terminal .limit(1) call on the join chain:
  //   db.select().from(comments).innerJoin(worlds,...).where().limit(1)
  // Returns [row] (found) or [] (not found).
  mockJoinLimit,
  // Controls db.delete().where() — the hard-delete step.
  mockDbDeleteWhere,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: real Clerk calls require signed cookies + network.
  mockCurrentUser: vi.fn(),
  // External boundary: getOrCreateDbUser hits the DB.
  mockGetOrCreateDbUser: vi.fn(),
  mockJoinLimit: vi.fn(),
  mockDbDeleteWhere: vi.fn(),
}));

// Mock @clerk/nextjs/server — prevents live Clerk API calls.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — prevents real DB upsert for user bootstrap.
vi.mock("@/lib/users", () => ({
  getOrCreateDbUser: mockGetOrCreateDbUser,
}));

// Mock @/db — prevents real DB connections.
//
// The DELETE handler uses two DB operations:
//
//   1. db.select({commentAuthorId, worldOwnerId})
//        .from(comments)
//        .innerJoin(worlds, eq(worlds.id, comments.worldId))
//        .where(eq(comments.id, commentId))
//        .limit(1)
//
//      This is a linear chain — each method returns the same chainable object.
//      The terminal .limit() is what actually resolves and returns row data.
//      mockJoinLimit controls this resolution.
//
//   2. db.delete(comments).where(eq(comments.id, commentId))
//
//      mockDbDeleteWhere controls the resolution of the where() call.
//
// Why mock the entire chain rather than individual Drizzle builders?
// Drizzle's builder internals are not part of our contract; they're an
// implementation detail. Mocking at the @/db module boundary is the correct
// seam: it's the only real external resource (the DB).
vi.mock("@/db", () => {
  const joinChain = {
    from: () => joinChain,
    innerJoin: () => joinChain,
    where: () => joinChain,
    limit: (..._args: unknown[]) => mockJoinLimit(),
  };
  return {
    db: {
      select: () => joinChain,
      delete: () => ({
        where: (..._args: unknown[]) => mockDbDeleteWhere(),
      }),
    },
  };
});

// Import the handler AFTER all mocks are registered.
import { DELETE } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_COMMENT_UUID = "660e8400-e29b-41d4-a716-446655440001";
const INVALID_UUID = "not-a-uuid";
const CLERK_USER_ID = "clerk_user_abc123";
const AUTHOR_DB_ID = "db-uuid-alice-001";
const WORLD_OWNER_DB_ID = "db-uuid-bob-002";
const THIRD_PARTY_DB_ID = "db-uuid-carol-003";

const CLERK_USER_STUB = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

// Row returned by the join query when the comment exists.
// commentAuthorId = author of the comment; worldOwnerId = owner of the world.
const COMMENT_ROW_AUTHOR_IS_ALICE = {
  commentAuthorId: AUTHOR_DB_ID,
  worldOwnerId: WORLD_OWNER_DB_ID,
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callDelete(commentId: string) {
  const req = new Request(
    `http://localhost/api/comments/${commentId}`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ id: commentId }) });
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupAuthAndUser(dbUserId: string = AUTHOR_DB_ID) {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockGetOrCreateDbUser.mockResolvedValue({
    id: dbUserId,
    clerkId: CLERK_USER_ID,
    username: "alice",
    email: "alice@example.com",
    avatarUrl: null,
    createdAt: new Date("2026-01-01"),
    tosAcceptedAt: null,
  });
}

// ============================================================================
// DELETE /api/comments/[id]
// ============================================================================

describe("DELETE /api/comments/[id] — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(VALID_COMMENT_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/comments/[id] — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid comment UUID in params", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });

    const res = await callDelete(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/comments/[id] — DB user bootstrap error", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when getOrCreateDbUser throws a DB error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );

    const res = await callDelete(VALID_COMMENT_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/comments/[id] — comment not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the comment does not exist (join returns no rows)", async () => {
    setupAuthAndUser();
    mockJoinLimit.mockResolvedValue([]); // no row = comment not found

    const res = await callDelete(VALID_COMMENT_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/comments/[id] — authorization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when caller is neither the comment author nor the world owner", async () => {
    // Carol is neither the author (alice) nor the world owner (bob)
    setupAuthAndUser(THIRD_PARTY_DB_ID);
    mockJoinLimit.mockResolvedValue([COMMENT_ROW_AUTHOR_IS_ALICE]);
    mockDbDeleteWhere.mockResolvedValue(undefined);

    const res = await callDelete(VALID_COMMENT_UUID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/comments/[id] — success: comment author", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 204 with empty body when the caller is the comment author", async () => {
    // Alice is the comment author
    setupAuthAndUser(AUTHOR_DB_ID);
    mockJoinLimit.mockResolvedValue([COMMENT_ROW_AUTHOR_IS_ALICE]);
    mockDbDeleteWhere.mockResolvedValue(undefined);

    const res = await callDelete(VALID_COMMENT_UUID);

    expect(res.status).toBe(204);
    // 204 must have no body content
    const text = await res.text();
    expect(text).toBe("");
  });

  it("calls db.delete when the caller is the comment author", async () => {
    setupAuthAndUser(AUTHOR_DB_ID);
    mockJoinLimit.mockResolvedValue([COMMENT_ROW_AUTHOR_IS_ALICE]);
    mockDbDeleteWhere.mockResolvedValue(undefined);

    await callDelete(VALID_COMMENT_UUID);

    expect(mockDbDeleteWhere).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/comments/[id] — success: world owner", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 204 when the caller is the world owner (but not the comment author)", async () => {
    // Bob owns the world but did NOT write the comment (alice did)
    setupAuthAndUser(WORLD_OWNER_DB_ID);
    mockJoinLimit.mockResolvedValue([COMMENT_ROW_AUTHOR_IS_ALICE]);
    mockDbDeleteWhere.mockResolvedValue(undefined);

    const res = await callDelete(VALID_COMMENT_UUID);

    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe("");
  });

  it("calls db.delete when the caller is the world owner", async () => {
    setupAuthAndUser(WORLD_OWNER_DB_ID);
    mockJoinLimit.mockResolvedValue([COMMENT_ROW_AUTHOR_IS_ALICE]);
    mockDbDeleteWhere.mockResolvedValue(undefined);

    await callDelete(VALID_COMMENT_UUID);

    expect(mockDbDeleteWhere).toHaveBeenCalledOnce();
  });
});
