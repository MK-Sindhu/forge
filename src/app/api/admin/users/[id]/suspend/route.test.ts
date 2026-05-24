import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs before any import resolves. All mock factories must
// reference values from this block.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireAdmin,
  // Controls db.select()...limit() — target user existence check
  mockDbSelectLimit,
  // Controls db.update()...where() — suspend / unsuspend update
  mockDbUpdateWhere,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk auth() makes network calls to Clerk API.
  mockCurrentUser: vi.fn(),
  // External boundary: requireAdmin hits the DB for user lookup + admin gate.
  // Returns DbUser on success or NextResponse (400/503/403) on failure.
  mockRequireAdmin: vi.fn(),
  mockDbSelectLimit: vi.fn(),
  mockDbUpdateWhere: vi.fn(),
}));

// Mock @clerk/nextjs/server — guards against live Clerk calls.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB round-trip for user bootstrap + admin gate.
vi.mock("@/lib/users", () => ({
  requireAdmin: mockRequireAdmin,
}));

// Mock @/db — real DB connections require DATABASE_URL + Neon.
//
// Both POST and DELETE handlers use:
//   1. db.select({id}).from(users).where().limit()  — target user existence check
//   2. db.update(users).set().where()               — suspend / unsuspend update
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (..._args: unknown[]) => mockDbSelectLimit(),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: (..._args: unknown[]) => {
          mockDbUpdateWhere();
          return Promise.resolve();
        },
      }),
    }),
  },
}));

// Import handlers AFTER mocks are registered.
import { POST, DELETE } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_TARGET_UUID = "550e8400-e29b-41d4-a716-446655440099";
const INVALID_UUID = "not-a-uuid";
const CLERK_USER_ID = "clerk_user_admin_001";
const ADMIN_DB_USER_ID = "db-uuid-admin-001";
// A separate target user ID — not the admin's own ID
const TARGET_DB_USER_ID = VALID_TARGET_UUID;

const ADMIN_DB_USER = {
  id: ADMIN_DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "admin_user",
  email: "admin@example.com",
  avatarUrl: null,
  isAdmin: true,
  suspendedAt: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const CLERK_ADMIN_STUB = {
  id: CLERK_USER_ID,
  username: "admin_user",
  emailAddresses: [{ emailAddress: "admin@example.com" }],
  imageUrl: null,
};

// ---------------------------------------------------------------------------
// Route call helpers
//
// Route signature: POST/DELETE(_req, { params: Promise<{ id: string }> })
// The [id] param is the FORGE DB user UUID (NOT Clerk ID).
// ---------------------------------------------------------------------------

function callPost(targetId: string) {
  const req = new Request(
    `http://localhost/api/admin/users/${targetId}/suspend`,
    { method: "POST" }
  );
  return POST(req, { params: Promise.resolve({ id: targetId }) });
}

function callDelete(targetId: string) {
  const req = new Request(
    `http://localhost/api/admin/users/${targetId}/suspend`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ id: targetId }) });
}

// ---------------------------------------------------------------------------
// Happy-path setup helper
// ---------------------------------------------------------------------------

function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
  mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
  mockDbSelectLimit.mockResolvedValue([{ id: TARGET_DB_USER_ID }]);
  mockDbUpdateWhere.mockResolvedValue(undefined);
}

// ============================================================================
// POST — suspend
// ============================================================================

describe("POST /api/admin/users/[id]/suspend — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPost(TARGET_DB_USER_ID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 403 when caller is authenticated but is not an admin", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPost(TARGET_DB_USER_ID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/admin/users/[id]/suspend — param validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid (non-UUID) target user id", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);

    const res = await callPost(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/admin/users/[id]/suspend — target user existence", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the target user does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    mockDbSelectLimit.mockResolvedValue([]); // target not found

    const res = await callPost(TARGET_DB_USER_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/admin/users/[id]/suspend — self-action guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when admin tries to suspend themselves", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    // Target exists but the target ID equals the admin's own DB ID
    mockDbSelectLimit.mockResolvedValue([{ id: ADMIN_DB_USER_ID }]);

    // Passing admin's own DB ID as the target
    const res = await callPost(ADMIN_DB_USER_ID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("POST /api/admin/users/[id]/suspend — success", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {suspendedAt: ISO} on successful suspension", async () => {
    setupHappyPath();

    const before = Date.now();
    const res = await callPost(TARGET_DB_USER_ID);
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.suspendedAt).toBe("string");
    // Must be a valid ISO 8601 string
    const parsed = new Date(body.suspendedAt);
    expect(isNaN(parsed.getTime())).toBe(false);
    expect(parsed.getTime()).toBeGreaterThanOrEqual(before);
    expect(parsed.getTime()).toBeLessThanOrEqual(after);
  });
});

// ============================================================================
// DELETE — unsuspend
// ============================================================================

describe("DELETE /api/admin/users/[id]/suspend — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callDelete(TARGET_DB_USER_ID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 403 when caller is authenticated but is not an admin", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callDelete(TARGET_DB_USER_ID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/admin/users/[id]/suspend — self-action guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 when admin tries to unsuspend themselves", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    // Target exists but equals the admin's own DB ID
    mockDbSelectLimit.mockResolvedValue([{ id: ADMIN_DB_USER_ID }]);

    const res = await callDelete(ADMIN_DB_USER_ID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("DELETE /api/admin/users/[id]/suspend — success", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with {suspendedAt: null} on successful unsuspension", async () => {
    setupHappyPath();

    const res = await callDelete(TARGET_DB_USER_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ suspendedAt: null });
  });
});
