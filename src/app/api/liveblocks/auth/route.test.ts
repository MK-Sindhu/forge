/**
 * route.test.ts — POST /api/liveblocks/auth
 *
 * Issues a Liveblocks JWT for a signed-in user or anonymous guest to join
 * the Liveblocks room for a world.
 *
 * Mock strategy:
 *  - @clerk/nextjs/server — requires live Clerk cookies + network; mocked.
 *  - @/db — no live DATABASE_URL in the test runner. The route calls
 *    db.select().from().where().limit(1) TWICE on the signed-in path:
 *    once for the world existence check and once for the user lookup.
 *    We expose a single `mockDbSelectLimit` spy at the .limit() terminal and
 *    use mockResolvedValueOnce chaining per test to queue the first + second
 *    return values. vi.resetAllMocks() in beforeEach clears the queue.
 *  - @/lib/liveblocks/server — getLiveblocksClient() contacts Liveblocks
 *    over the network and needs LIVEBLOCKS_SECRET_KEY; mocked to return a
 *    fake session with allow() + authorize() spies.
 *  - server-only — the liveblocks/server module imports "server-only" which
 *    throws in test environment; we bypass it by mocking the entire module.
 *
 * Warning: do NOT put the jsdom environment directive string in comments.
 * Vitest scans comment text and crashes when that package is not installed.
 * Default env is node — no DOM needed here.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockDbSelectLimit,
  mockPrepareSession,
  mockSessionAllow,
  mockSessionAuthorize,
} = vi.hoisted(() => {
  const mockSessionAllow = vi.fn();
  const mockSessionAuthorize = vi.fn();

  // prepareSession returns a session object with allow + authorize spies
  // and the FULL_ACCESS constant the route accesses via session.FULL_ACCESS.
  const mockPrepareSession = vi.fn().mockReturnValue({
    allow: mockSessionAllow,
    authorize: mockSessionAuthorize,
    FULL_ACCESS: "*",
  });

  return {
    mockAuth: vi.fn(),
    mockCurrentUser: vi.fn(),
    // Shared spy for all db.select().from().where().limit() calls.
    // Tests queue calls via mockResolvedValueOnce — first call = world lookup,
    // second call = user lookup (signed-in path only).
    mockDbSelectLimit: vi.fn(),
    mockPrepareSession,
    mockSessionAllow,
    mockSessionAuthorize,
  };
});

// External boundary: Clerk requires live signed cookies + network.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// External boundary: no live DATABASE_URL in test runner.
// Both db.select calls (world + user) share one spy; tests queue values with
// mockResolvedValueOnce so the first .limit() call returns the world row and
// the second returns the user row.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
  },
}));

// External boundary: getLiveblocksClient() requires LIVEBLOCKS_SECRET_KEY and
// makes network calls to Liveblocks. Mocked to return a fake session object.
// Mocking the entire module also prevents "server-only" from throwing.
vi.mock("@/lib/liveblocks/server", () => ({
  getLiveblocksClient: () => ({
    prepareSession: mockPrepareSession,
  }),
}));

// Import handler AFTER mocks are registered.
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "660e8400-e29b-41d4-a716-446655440001";

const WORLD_ROW = { id: WORLD_UUID };

const DB_USER_ROW = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: "https://r2.example.com/alice.jpg",
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

const FAKE_TOKEN_BODY = JSON.stringify({ token: "fake-liveblocks-jwt" });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function callPost(body: unknown) {
  return POST(
    new Request("http://localhost/api/liveblocks/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks();
  // Re-apply defaults that most tests rely on
  mockAuth.mockResolvedValue({ userId: null });
  mockCurrentUser.mockResolvedValue(null);
  // Restore mockPrepareSession return value after resetAllMocks wipes it.
  mockPrepareSession.mockReturnValue({
    allow: mockSessionAllow,
    authorize: mockSessionAuthorize,
    FULL_ACCESS: "*",
  });
  mockSessionAuthorize.mockResolvedValue({
    body: FAKE_TOKEN_BODY,
    status: 200,
  });
});

// ---------------------------------------------------------------------------
// Tests: input validation
// ---------------------------------------------------------------------------

describe("POST /api/liveblocks/auth — input validation", () => {
  it("returns 400 when room is not a valid uuid", async () => {
    const res = await callPost({ room: "not-a-uuid" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when room is missing entirely", async () => {
    const res = await callPost({});
    expect(res.status).toBe(400);
  });

  it("returns 400 when guestId is malformed (not 4 uppercase alphanumeric)", async () => {
    // The Zod schema rejects the guestId at parse time — 400 before any DB hit
    const res = await callPost({ room: WORLD_UUID, guestId: "bad!" });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Tests: world lookup
// ---------------------------------------------------------------------------

describe("POST /api/liveblocks/auth — world lookup", () => {
  it("returns 404 when the world does not exist", async () => {
    mockDbSelectLimit.mockResolvedValueOnce([]); // world not found
    const res = await callPost({ room: WORLD_UUID, guestId: "AAAA" });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/world not found/i);
  });
});

// ---------------------------------------------------------------------------
// Tests: guest path
// ---------------------------------------------------------------------------

describe("POST /api/liveblocks/auth — guest path", () => {
  it("returns 400 when no Clerk session and no guestId in body", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockDbSelectLimit.mockResolvedValueOnce([WORLD_ROW]); // world exists

    const res = await callPost({ room: WORLD_UUID });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/guestId/i);
  });

  it("200 happy path — prepareSession called with guest_ userId + correct userInfo", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockDbSelectLimit.mockResolvedValueOnce([WORLD_ROW]);

    const res = await callPost({ room: WORLD_UUID, guestId: "K3F9" });
    expect(res.status).toBe(200);

    expect(mockPrepareSession).toHaveBeenCalledOnce();
    const [lbUserId, options] = mockPrepareSession.mock.calls[0];
    expect(lbUserId).toBe("guest_K3F9");
    expect(options.userInfo.name).toBe("Guest_K3F9");
    expect(options.userInfo.isGuest).toBe(true);
    // avatarUrl is null for guests → undefined via ?? undefined in the route
    expect(options.userInfo.avatar).toBeUndefined();
  });

  it("200 guest — session.allow called with world:<uuid> room id + FULL_ACCESS", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockDbSelectLimit.mockResolvedValueOnce([WORLD_ROW]);

    await callPost({ room: WORLD_UUID, guestId: "A1B2" });

    expect(mockSessionAllow).toHaveBeenCalledOnce();
    const [roomArg, accessArg] = mockSessionAllow.mock.calls[0];
    expect(roomArg).toBe(`world:${WORLD_UUID}`);
    expect(accessArg).toBe("*"); // FULL_ACCESS mock value
  });

  it("200 guest — response body is the Liveblocks token + Content-Type is application/json", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockDbSelectLimit.mockResolvedValueOnce([WORLD_ROW]);

    const res = await callPost({ room: WORLD_UUID, guestId: "Z9Y8" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const text = await res.text();
    expect(text).toBe(FAKE_TOKEN_BODY);
  });
});

// ---------------------------------------------------------------------------
// Tests: signed-in path
// ---------------------------------------------------------------------------

describe("POST /api/liveblocks/auth — signed-in path", () => {
  it("returns 403 when the signed-in user is suspended", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({ id: CLERK_USER_ID });
    // First call: world lookup; second call: user lookup
    mockDbSelectLimit
      .mockResolvedValueOnce([WORLD_ROW])
      .mockResolvedValueOnce([{ ...DB_USER_ROW, suspendedAt: new Date("2026-04-01") }]);

    const res = await callPost({ room: WORLD_UUID });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/suspended/i);
  });

  it("200 happy path — prepareSession called with user_ userId + correct userInfo", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({ id: CLERK_USER_ID });
    mockDbSelectLimit
      .mockResolvedValueOnce([WORLD_ROW])
      .mockResolvedValueOnce([DB_USER_ROW]);

    const res = await callPost({ room: WORLD_UUID });
    expect(res.status).toBe(200);

    expect(mockPrepareSession).toHaveBeenCalledOnce();
    const [lbUserId, options] = mockPrepareSession.mock.calls[0];
    expect(lbUserId).toBe(`user_${DB_USER_ID}`);
    expect(options.userInfo.name).toBe("@alice");
    expect(options.userInfo.isGuest).toBe(false);
    // avatarUrl is mapped to userInfo.avatar
    expect(options.userInfo.avatar).toBe("https://r2.example.com/alice.jpg");
  });

  it("200 signed-in — session.allow called with world:<uuid> room id + FULL_ACCESS", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({ id: CLERK_USER_ID });
    mockDbSelectLimit
      .mockResolvedValueOnce([WORLD_ROW])
      .mockResolvedValueOnce([DB_USER_ROW]);

    await callPost({ room: WORLD_UUID });

    expect(mockSessionAllow).toHaveBeenCalledOnce();
    const [roomArg, accessArg] = mockSessionAllow.mock.calls[0];
    expect(roomArg).toBe(`world:${WORLD_UUID}`);
    expect(accessArg).toBe("*");
  });

  it("200 signed-in — response body is the Liveblocks token + Content-Type is application/json", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({ id: CLERK_USER_ID });
    mockDbSelectLimit
      .mockResolvedValueOnce([WORLD_ROW])
      .mockResolvedValueOnce([DB_USER_ROW]);

    const res = await callPost({ room: WORLD_UUID });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const text = await res.text();
    expect(text).toBe(FAKE_TOKEN_BODY);
  });
});

// ---------------------------------------------------------------------------
// Tests: Liveblocks error handling
// ---------------------------------------------------------------------------

describe("POST /api/liveblocks/auth — Liveblocks error handling", () => {
  it("returns 503 when the Liveblocks session setup throws", async () => {
    mockAuth.mockResolvedValue({ userId: null });
    mockDbSelectLimit.mockResolvedValueOnce([WORLD_ROW]);

    // Make prepareSession itself throw — this is caught by the try/catch
    // around the token issuance block (lines ~183-209 of route.ts).
    mockPrepareSession.mockImplementation(() => {
      throw new Error("LIVEBLOCKS_SECRET_KEY env var is required");
    });

    const res = await callPost({ room: WORLD_UUID, guestId: "ABCD" });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/realtime service/i);
  });
});
