/**
 * route.test.ts — DELETE /api/worlds/[id]/collaborators/[userId]
 *
 * Allowed callers:
 *   - The world owner (can remove anyone)
 *   - The collaborator themselves (self-removal)
 *
 * Mock strategy:
 *  - @clerk/nextjs/server — Clerk requires live cookies + network; mocked.
 *  - @/lib/users — crosses DB boundary; mocked at module level.
 *  - @/db — no live DATABASE_URL in test runner. The DELETE route uses:
 *      db.select().from(worlds).where().limit(1)  — initial world lookup
 *      db.delete(worldCollaborators).where().returning()  — the removal
 *    Both mocked via hoisted spies.
 *
 * Warning: do NOT put the jsdom environment directive in comments here.
 * Vitest scans comment text for environment directives; jsdom is not installed
 * and its presence crashes the worker. Default env is node — no DOM needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockDbSelectLimit,
  mockDbDeleteReturning,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  // db.select().from(worlds).where().limit(1) — world existence + ownership check
  mockDbSelectLimit: vi.fn(),
  // db.delete(worldCollaborators).where().returning() — the actual delete
  mockDbDeleteReturning: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mock @/db.
// SELECT path: db.select().from(...).where(...).limit(1)
// DELETE path: db.delete(...).where(...).returning()
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: (...args: unknown[]) => mockDbDeleteReturning(...args),
      }),
    }),
  },
}));

import { DELETE } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_UUID = "660e8400-e29b-41d4-a716-446655440001";
const COLLAB_UUID = "770e8400-e29b-41d4-a716-446655440002";
const THIRD_UUID = "880e8400-e29b-41d4-a716-446655440003";
const CLERK_USER_ID = "clerk_user_abc123";

const worldRow = {
  id: WORLD_UUID,
  userId: OWNER_UUID,
  title: "Test World",
  description: null,
  glbUrl: "https://r2.example.com/world.glb",
  glbSizeBytes: 1024,
  likesCount: 0,
  views: 0,
  createdAt: new Date("2026-01-01"),
  sceneGraph: null,
  publishedVersionId: null,
};

const ownerDbUser = {
  id: OWNER_UUID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

const collabDbUser = {
  id: COLLAB_UUID,
  clerkId: "clerk_collab_xyz",
  username: "bob",
  email: "bob@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

const thirdDbUser = {
  id: THIRD_UUID,
  clerkId: "clerk_third_xyz",
  username: "carol",
  email: "carol@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

const deletedCollabRow = {
  worldId: WORLD_UUID,
  userId: COLLAB_UUID,
  role: "editor",
  addedAt: new Date("2026-02-01"),
  addedById: OWNER_UUID,
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callDelete(worldId: string, targetUserId: string, clerkUserId?: string) {
  void clerkUserId; // auth is set up via mockAuth separately
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/collaborators/${targetUserId}`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ id: worldId, userId: targetUserId }) });
}

// ---------------------------------------------------------------------------
// Block A — Auth
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/collaborators/[userId] — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(WORLD_UUID, COLLAB_UUID);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Block B — World lookup
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/collaborators/[userId] — world not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the world does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(ownerDbUser);
    mockDbSelectLimit.mockResolvedValue([]); // world not found

    const res = await callDelete(WORLD_UUID, COLLAB_UUID);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block C — Authorization
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/collaborators/[userId] — authorization", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when caller is neither the owner nor the target collaborator", async () => {
    // thirdDbUser is neither the owner (OWNER_UUID) nor the target (COLLAB_UUID)
    mockAuth.mockResolvedValue({ userId: "clerk_third_xyz" });
    mockCurrentUser.mockResolvedValue({
      id: "clerk_third_xyz",
      username: "carol",
      emailAddresses: [{ emailAddress: "carol@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(thirdDbUser);
    mockDbSelectLimit.mockResolvedValue([worldRow]); // world found, owner = OWNER_UUID

    const res = await callDelete(WORLD_UUID, COLLAB_UUID);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block D — Collaborator not found
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/collaborators/[userId] — not a collaborator", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when owner tries to remove a user who is not a collaborator", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(ownerDbUser);
    mockDbSelectLimit.mockResolvedValue([worldRow]); // world found
    mockDbDeleteReturning.mockResolvedValue([]); // delete returned nothing — not in table

    const res = await callDelete(WORLD_UUID, COLLAB_UUID);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block E — Happy paths
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/collaborators/[userId] — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 { removed: true, worldId, userId } when owner removes a collaborator", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(ownerDbUser); // owner
    mockDbSelectLimit.mockResolvedValue([worldRow]);
    mockDbDeleteReturning.mockResolvedValue([deletedCollabRow]); // 1 row removed

    const res = await callDelete(WORLD_UUID, COLLAB_UUID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ removed: true, worldId: WORLD_UUID, userId: COLLAB_UUID });
  });

  it("returns 200 when a collaborator removes themselves (self-removal)", async () => {
    // collabDbUser removes themselves — dbUser.id === targetUserId
    mockAuth.mockResolvedValue({ userId: "clerk_collab_xyz" });
    mockCurrentUser.mockResolvedValue({
      id: "clerk_collab_xyz",
      username: "bob",
      emailAddresses: [{ emailAddress: "bob@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(collabDbUser); // self = COLLAB_UUID
    mockDbSelectLimit.mockResolvedValue([worldRow]); // world found, owner = OWNER_UUID
    // collabDbUser.id !== worldRow.userId (not owner) but collabDbUser.id === targetUserId (self)
    mockDbDeleteReturning.mockResolvedValue([deletedCollabRow]);

    const res = await callDelete(WORLD_UUID, COLLAB_UUID); // target = COLLAB_UUID = self
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ removed: true, worldId: WORLD_UUID, userId: COLLAB_UUID });
  });
});
