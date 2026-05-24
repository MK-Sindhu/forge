import { describe, it, expect, vi, beforeEach } from "vitest";

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
  // Controls the terminal .limit(1) call on the join chain:
  //   db.select({updateId, worldOwnerId})
  //     .from(worldUpdates)
  //     .innerJoin(worlds, eq(worlds.id, worldUpdates.worldId))
  //     .where(eq(worldUpdates.id, updateId))
  //     .limit(1)
  // Returns [row] (found) or [] (not found).
  mockJoinLimit,
  // Controls db.update(worldUpdates).set().where().returning() — PATCH only.
  mockDbUpdateReturning,
  // Controls db.delete(worldUpdates).where() — DELETE only.
  mockDbDeleteWhere,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: real Clerk calls require signed cookies + network.
  mockCurrentUser: vi.fn(),
  // External boundary: getOrCreateDbUser hits the DB.
  mockGetOrCreateDbUser: vi.fn(),
  mockJoinLimit: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
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
// Both PATCH and DELETE share a prelude that uses:
//
//   db.select({updateId, worldOwnerId})
//     .from(worldUpdates)
//     .innerJoin(worlds, ...)
//     .where(eq(worldUpdates.id, updateId))
//     .limit(1)
//
// This is a linear builder chain; mockJoinLimit resolves the terminal .limit().
//
// PATCH additionally uses:
//   db.update(worldUpdates).set({...}).where(...).returning()
//   mockDbUpdateReturning resolves the terminal .returning().
//
// DELETE additionally uses:
//   db.delete(worldUpdates).where(...)
//   mockDbDeleteWhere resolves the terminal .where().
//
// Why mock at the @/db boundary rather than individual Drizzle internals?
// Drizzle builder internals are not our contract; the DB is the external
// resource. Mocking at the module boundary is the correct seam.
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
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => mockDbUpdateReturning(),
          }),
        }),
      }),
      delete: () => ({
        where: (..._args: unknown[]) => mockDbDeleteWhere(),
      }),
    },
  };
});

// Import handlers AFTER all mocks are registered.
import { PATCH, DELETE } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_UPDATE_UUID = "770e8400-e29b-41d4-a716-446655440001";
const INVALID_UUID = "not-a-uuid";
const CLERK_USER_ID = "clerk_user_abc123";
const WORLD_OWNER_DB_ID = "db-uuid-alice-001";
const NON_OWNER_DB_ID = "db-uuid-bob-002";

const CLERK_USER_STUB = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: null,
};

// Row returned by the join query when the update exists.
// worldOwnerId = owner of the world this update belongs to.
const UPDATE_ROW_OWNED_BY_ALICE = {
  updateId: VALID_UPDATE_UUID,
  worldOwnerId: WORLD_OWNER_DB_ID,
};

// ---------------------------------------------------------------------------
// Route call helpers
// ---------------------------------------------------------------------------

function callPatch(
  updateId: string,
  body: unknown = { body: "Updated text here" }
) {
  const req = new Request(`http://localhost/api/updates/${updateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: updateId }) });
}

function callDelete(updateId: string) {
  const req = new Request(`http://localhost/api/updates/${updateId}`, {
    method: "DELETE",
  });
  return DELETE(req, { params: Promise.resolve({ id: updateId }) });
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function setupAuthAsOwner() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockGetOrCreateDbUser.mockResolvedValue({
    id: WORLD_OWNER_DB_ID,
    clerkId: CLERK_USER_ID,
    username: "alice",
    email: "alice@example.com",
    avatarUrl: null,
    createdAt: new Date("2026-01-01"),
    tosAcceptedAt: null,
  });
}

function setupAuthAsNonOwner() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
  mockGetOrCreateDbUser.mockResolvedValue({
    id: NON_OWNER_DB_ID,
    clerkId: CLERK_USER_ID,
    username: "bob",
    email: "bob@example.com",
    avatarUrl: null,
    createdAt: new Date("2026-01-01"),
    tosAcceptedAt: null,
  });
}

// ============================================================================
// PATCH /api/updates/[id]
// ============================================================================

describe("PATCH /api/updates/[id] — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPatch(VALID_UPDATE_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/updates/[id] — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid update UUID in params", async () => {
    // UUID validation runs after auth but before DB; configure auth minimally.
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });

    const res = await callPatch(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/updates/[id] — DB bootstrap error", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when getOrCreateDbUser throws a DB connection error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );

    const res = await callPatch(VALID_UPDATE_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the Clerk user has no email", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockGetOrCreateDbUser.mockRejectedValue(new Error("no email"));

    const res = await callPatch(VALID_UPDATE_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/updates/[id] — body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAsOwner();
    // Update exists and caller is owner — only body validation should fail here.
    mockJoinLimit.mockResolvedValue([UPDATE_ROW_OWNED_BY_ALICE]);
  });

  it("returns 400 when the body field is missing entirely", async () => {
    const res = await callPatch(VALID_UPDATE_UUID, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body is whitespace only (trim leaves it empty)", async () => {
    const res = await callPatch(VALID_UPDATE_UUID, { body: "   " });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when the body exceeds 2000 characters", async () => {
    const longBody = "x".repeat(2001);
    const res = await callPatch(VALID_UPDATE_UUID, { body: longBody });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/updates/[id] — update not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the update does not exist (join returns no rows)", async () => {
    setupAuthAsOwner();
    mockJoinLimit.mockResolvedValue([]); // no row = update not found

    const res = await callPatch(VALID_UPDATE_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/updates/[id] — authorization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when the caller is not the world owner", async () => {
    // Bob is logged in but the world is owned by alice
    setupAuthAsNonOwner();
    mockJoinLimit.mockResolvedValue([UPDATE_ROW_OWNED_BY_ALICE]);

    const res = await callPatch(VALID_UPDATE_UUID, { body: "Sneaky edit" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/updates/[id] — success", () => {
  const NOW = new Date("2026-04-20T14:00:00.000Z");

  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAsOwner();
    mockJoinLimit.mockResolvedValue([UPDATE_ROW_OWNED_BY_ALICE]);
    mockDbUpdateReturning.mockResolvedValue([
      {
        id: VALID_UPDATE_UUID,
        body: "Updated text here",
        createdAt: new Date("2026-04-15T10:00:00.000Z"),
        editedAt: NOW,
        worldId: "550e8400-e29b-41d4-a716-446655440000",
      },
    ]);
  });

  it("returns 200 on success", async () => {
    const res = await callPatch(VALID_UPDATE_UUID, { body: "Updated text here" });

    expect(res.status).toBe(200);
  });

  it("returns correct shape: id, body, createdAt, editedAt (all strings)", async () => {
    const res = await callPatch(VALID_UPDATE_UUID, { body: "Updated text here" });
    const body = await res.json();

    expect(body).toMatchObject({
      id: VALID_UPDATE_UUID,
      body: "Updated text here",
      createdAt: "2026-04-15T10:00:00.000Z",
      editedAt: "2026-04-20T14:00:00.000Z",
    });
  });

  it("editedAt is set (non-null) on every successful PATCH", async () => {
    const res = await callPatch(VALID_UPDATE_UUID, { body: "Updated text here" });
    const body = await res.json();

    expect(body.editedAt).not.toBeNull();
    expect(typeof body.editedAt).toBe("string");
    // Must be a valid ISO 8601 string
    expect(new Date(body.editedAt).toISOString()).toBe(body.editedAt);
  });

  it("returned body matches the submitted text", async () => {
    const res = await callPatch(VALID_UPDATE_UUID, { body: "Updated text here" });
    const body = await res.json();

    expect(body.body).toBe("Updated text here");
  });
});

// ============================================================================
// DELETE /api/updates/[id]
// ============================================================================

describe("DELETE /api/updates/[id] — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(VALID_UPDATE_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/updates/[id] — UUID validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid update UUID in params", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });

    const res = await callDelete(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/updates/[id] — DB bootstrap error", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 503 when getOrCreateDbUser throws a DB connection error", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_STUB);
    mockGetOrCreateDbUser.mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );

    const res = await callDelete(VALID_UPDATE_UUID);

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/updates/[id] — update not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the update does not exist (join returns no rows)", async () => {
    setupAuthAsOwner();
    mockJoinLimit.mockResolvedValue([]); // no row = update not found

    const res = await callDelete(VALID_UPDATE_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/updates/[id] — authorization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when the caller is not the world owner", async () => {
    // Bob is logged in but the world is owned by alice
    setupAuthAsNonOwner();
    mockJoinLimit.mockResolvedValue([UPDATE_ROW_OWNED_BY_ALICE]);

    const res = await callDelete(VALID_UPDATE_UUID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/updates/[id] — success", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupAuthAsOwner();
    mockJoinLimit.mockResolvedValue([UPDATE_ROW_OWNED_BY_ALICE]);
    mockDbDeleteWhere.mockResolvedValue(undefined);
  });

  it("returns 204 with empty body when the caller is the world owner", async () => {
    const res = await callDelete(VALID_UPDATE_UUID);

    expect(res.status).toBe(204);
    // 204 must carry no body content
    const text = await res.text();
    expect(text).toBe("");
  });

  it("calls db.delete exactly once on success", async () => {
    await callDelete(VALID_UPDATE_UUID);

    expect(mockDbDeleteWhere).toHaveBeenCalledOnce();
  });
});
