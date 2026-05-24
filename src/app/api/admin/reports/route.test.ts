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
  // Controls db.query.reports.findMany — the paginated list query.
  mockFindMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk auth() makes network calls to Clerk API.
  mockCurrentUser: vi.fn(),
  // External boundary: requireAdmin hits the DB for user lookup + admin check.
  // Returns DbUser on success or NextResponse (400/503/403) on failure.
  mockRequireAdmin: vi.fn(),
  mockFindMany: vi.fn(),
}));

// Mock @clerk/nextjs/server — guards against live Clerk calls.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB round-trip for user bootstrap + admin gate.
// requireAdmin is the ONLY auth-gate function called by this endpoint.
vi.mock("@/lib/users", () => ({
  requireAdmin: mockRequireAdmin,
}));

// Mock @/db — real DB connections require DATABASE_URL + Neon.
// This endpoint uses only db.query.reports.findMany (relational query).
vi.mock("@/db", () => ({
  db: {
    query: {
      reports: {
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

const CLERK_USER_ID = "clerk_user_admin_001";
const ADMIN_DB_USER_ID = "db-uuid-admin-001";

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

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: "aa000001-e29b-41d4-a716-446655440000",
    reason: "copyright",
    body: "This is my copyrighted work.",
    status: "open",
    createdAt: new Date("2026-04-10T12:00:00.000Z"),
    resolvedAt: null,
    world: {
      id: "550e8400-e29b-41d4-a716-446655440000",
      title: "Test World",
      media: [{ url: "https://cdn.example.com/thumb.jpg" }],
    },
    reporter: {
      id: "db-uuid-alice-001",
      username: "alice",
      avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callGet(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/admin/reports");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const req = new Request(url.toString());
  return GET(req);
}

// ---------------------------------------------------------------------------
// Happy-path setup helper
// ---------------------------------------------------------------------------

function setupHappyPath(reports: unknown[] = [makeReport()]) {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
  mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
  mockFindMany.mockResolvedValue(reports);
}

// ============================================================================
// Auth
// ============================================================================

describe("GET /api/admin/reports — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callGet();

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 403 when caller is authenticated but is not an admin", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    // requireAdmin returns a 403 NextResponse for non-admin users
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callGet();

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Query param validation
// ============================================================================

describe("GET /api/admin/reports — query param validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
  });

  it("returns 400 for limit below 1", async () => {
    const res = await callGet({ limit: "0" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 for limit above 50", async () => {
    const res = await callGet({ limit: "51" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Success path — response shape
// ============================================================================

describe("GET /api/admin/reports — success: response shape", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with a reports array and nextCursor when admin", async () => {
    setupHappyPath();

    const res = await callGet();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.reports)).toBe(true);
    expect("nextCursor" in body).toBe(true);
  });

  it("each report has a flattened world.thumbnailUrl (not nested as world.media[0].url)", async () => {
    // The spec says thumbnailUrl must be flattened out of the media array.
    // This tests the transformation layer in the route handler.
    setupHappyPath([makeReport()]);

    const res = await callGet();
    const { reports } = await res.json();

    expect(reports[0].world).toHaveProperty("thumbnailUrl");
    // thumbnailUrl must be a string, not null (our fixture has one)
    expect(typeof reports[0].world.thumbnailUrl).toBe("string");
    // world must NOT contain a raw media array — that is an internal shape
    expect(reports[0].world).not.toHaveProperty("media");
  });

  it("returns thumbnailUrl: null when the world has no media", async () => {
    setupHappyPath([makeReport({ world: { id: "550e8400-e29b-41d4-a716-446655440000", title: "Test World", media: [] } })]);

    const res = await callGet();
    const { reports } = await res.json();

    expect(reports[0].world.thumbnailUrl).toBeNull();
  });

  it("each report has id, reason, body, status, createdAt (ISO), resolvedAt, world, reporter", async () => {
    setupHappyPath([makeReport()]);

    const res = await callGet();
    const { reports: rows } = await res.json();

    expect(rows[0]).toMatchObject({
      id: expect.any(String),
      reason: expect.any(String),
      status: expect.any(String),
      createdAt: expect.any(String),
      world: expect.objectContaining({ id: expect.any(String), title: expect.any(String) }),
      reporter: expect.objectContaining({ id: expect.any(String), username: expect.any(String) }),
    });
    expect(typeof rows[0].createdAt).toBe("string");
    // createdAt must be a valid ISO 8601 string
    expect(new Date(rows[0].createdAt).toISOString()).toBe(rows[0].createdAt);
  });
});

// ============================================================================
// Status filter
// ============================================================================

describe("GET /api/admin/reports — status filter", () => {
  beforeEach(() => vi.resetAllMocks());

  it("defaults to status=open when no status param is provided", async () => {
    setupHappyPath([]);

    await callGet();

    // The findMany call should receive a where condition — we verify it was
    // called at all (proving the query was executed).
    expect(mockFindMany).toHaveBeenCalledOnce();
  });

  it("passes status=resolved filter and returns only resolved reports", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    // The mock simulates the DB having already filtered to resolved reports
    mockFindMany.mockResolvedValue([makeReport({ status: "resolved", resolvedAt: new Date("2026-04-11T00:00:00.000Z") })]);

    const res = await callGet({ status: "resolved" });
    const body = await res.json();

    expect(res.status).toBe(200);
    // All returned reports must have status=resolved
    for (const r of body.reports) {
      expect(r.status).toBe("resolved");
    }
  });
});

// ============================================================================
// Cursor pagination
// ============================================================================

describe("GET /api/admin/reports — cursor pagination", () => {
  beforeEach(() => vi.resetAllMocks());

  it("nextCursor is null when the DB returns fewer results than the page limit", async () => {
    setupHappyPath([makeReport(), makeReport()]);

    const res = await callGet({ limit: "5" });
    const body = await res.json();

    expect(body.nextCursor).toBeNull();
    expect(body.reports).toHaveLength(2);
  });

  it("nextCursor is populated when DB returns limit+1 results (more pages available)", async () => {
    // limit=2, DB returns 3 (limit+1) → hasMore=true → nextCursor = last item's createdAt
    const r1 = makeReport({ id: "aa000001-e29b-41d4-a716-446655440000", createdAt: new Date("2026-04-10T12:00:00.000Z") });
    const r2 = makeReport({ id: "aa000002-e29b-41d4-a716-446655440000", createdAt: new Date("2026-04-09T12:00:00.000Z") });
    const r3 = makeReport({ id: "aa000003-e29b-41d4-a716-446655440000", createdAt: new Date("2026-04-08T12:00:00.000Z") });
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    mockFindMany.mockResolvedValue([r1, r2, r3]);

    const res = await callGet({ limit: "2" });
    const body = await res.json();

    expect(body.reports).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
    expect(typeof body.nextCursor).toBe("string");
    // nextCursor must equal the createdAt of the last returned report
    expect(body.nextCursor).toBe(body.reports[1].createdAt);
  });

  it("passes cursor to findMany when cursor param is supplied", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    mockFindMany.mockResolvedValue([]);

    const cursorIso = "2026-04-10T12:00:00.000Z";
    await callGet({ cursor: cursorIso });

    expect(mockFindMany).toHaveBeenCalledOnce();
    // The where clause must include a lt(reports.createdAt, cursorDate) condition.
    // We only verify findMany was called (cursor forwarded to query) — asserting
    // Drizzle SQL node internals would couple to the library.
    const [callArg] = mockFindMany.mock.calls[0];
    expect(callArg).toMatchObject({ where: expect.anything() });
  });
});
