/**
 * route.test.ts — PUT /api/users/me (change username)
 *
 * Mock strategy (same pattern as collaborators/route.test.ts):
 *  - @clerk/nextjs/server — mocked (live Clerk requires cookies + network).
 *  - @/lib/users  — requireActiveDbUser mocked so tests inject pass/fail
 *    without a real DB.
 *  - @/db — no live DATABASE_URL in the test runner; db.select + db.update
 *    both mocked.
 *
 * Warning: do NOT put the jsdom environment directive in comments here.
 * Vitest scans comment text for environment directives; jsdom is not installed
 * and its presence crashes the worker. Default env is node — no DOM needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockDbSelect,
  mockDbUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  // db.select().from().where().limit()  — uniqueness check
  mockDbSelect: vi.fn(),
  // db.update().set().where().returning()  — persist
  mockDbUpdate: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mock @/db.
// The route calls:
//   db.select({ id: users.id }).from(users).where(...).limit(1)  — conflict check
//   db.update(users).set({ username }).where(...).returning(...)  — write
vi.mock("@/db", () => ({
  db: {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (..._args: unknown[]) => mockDbSelect(),
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (_values: unknown) => ({
        where: (_cond: unknown) => ({
          returning: (_fields?: unknown) => mockDbUpdate(),
        }),
      }),
    }),
  },
}));

import { PUT } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_UUID = "550e8400-e29b-41d4-a716-446655440000";
const CLERK_USER_ID = "clerk_user_abc123";

const DB_USER = {
  id: USER_UUID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: "https://r2.example.com/alice.jpg",
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

const CLERK_USER_FIXTURE = {
  id: CLERK_USER_ID,
  username: "alice",
  emailAddresses: [{ emailAddress: "alice@example.com" }],
  imageUrl: "https://r2.example.com/alice.jpg",
};

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callPut(body: unknown) {
  const req = new NextRequest("http://localhost/api/users/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(req);
}

// ---------------------------------------------------------------------------
// Auth block
// ---------------------------------------------------------------------------

describe("PUT /api/users/me — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPut({ username: "newname" });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------

describe("PUT /api/users/me — validation", () => {
  beforeEach(() => vi.resetAllMocks());

  function setupAuth() {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
  }

  it("returns 400 when username is too short (< 3 chars)", async () => {
    setupAuth();

    const res = await callPut({ username: "ab" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when username is too long (> 32 chars)", async () => {
    setupAuth();

    const res = await callPut({ username: "a".repeat(33) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when username contains invalid characters (space)", async () => {
    setupAuth();

    const res = await callPut({ username: "alice smith" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for a reserved username ('admin')", async () => {
    setupAuth();

    const res = await callPut({ username: "admin" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "username reserved" });
  });

  it("returns 400 for reserved username 'api' (route path collision)", async () => {
    setupAuth();

    const res = await callPut({ username: "api" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({ error: "username reserved" });
  });
});

// ---------------------------------------------------------------------------
// Conflict block
// ---------------------------------------------------------------------------

describe("PUT /api/users/me — conflict", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 409 when username is already taken by another user", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    // uniqueness check returns a conflicting row
    mockDbSelect.mockResolvedValue([{ id: "other-user-uuid" }]);

    const res = await callPut({ username: "taken" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "username taken" });
  });
});

// ---------------------------------------------------------------------------
// No-op block
// ---------------------------------------------------------------------------

describe("PUT /api/users/me — no-op", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with current user when new username equals current (case-insensitive via lowercase normalization)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    // DB_USER.username is "alice"; PUT body "Alice" lowercases to "alice" — same
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    const res = await callPut({ username: "Alice" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(USER_UUID);
    expect(body.username).toBe("alice");
  });
});

// ---------------------------------------------------------------------------
// Happy path block
// ---------------------------------------------------------------------------

describe("PUT /api/users/me — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with updated user on successful username change", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    // uniqueness check: no conflict
    mockDbSelect.mockResolvedValue([]);
    // update returns shaped row
    mockDbUpdate.mockResolvedValue([
      {
        id: USER_UUID,
        username: "mynewname",
        avatarUrl: "https://r2.example.com/alice.jpg",
      },
    ]);

    const res = await callPut({ username: "mynewname" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(USER_UUID);
    expect(body.username).toBe("mynewname");
    expect(body.avatarUrl).toBe("https://r2.example.com/alice.jpg");
  });

  it("lowercases the username before storing", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_USER_FIXTURE);
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);

    mockDbSelect.mockResolvedValue([]);
    mockDbUpdate.mockResolvedValue([
      {
        id: USER_UUID,
        username: "cool_user_123",
        avatarUrl: null,
      },
    ]);

    // Send mixed-case; route should lower it to "cool_user_123"
    const res = await callPut({ username: "Cool_User_123" });
    expect(res.status).toBe(200);
    const body = await res.json();
    // The mock echoes "cool_user_123" — confirms lowercased form was written
    expect(body.username).toBe("cool_user_123");
  });
});
