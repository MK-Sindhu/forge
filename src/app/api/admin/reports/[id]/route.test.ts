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
  // Controls db.select()...limit() — report-existence check
  mockDbSelectLimit,
  // Controls db.update()...returning() — report update
  mockDbUpdateReturning,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: Clerk auth() makes network calls to Clerk API.
  mockCurrentUser: vi.fn(),
  // External boundary: requireAdmin hits the DB for user lookup + admin gate.
  // Returns DbUser on success or NextResponse (400/503/403) on failure.
  mockRequireAdmin: vi.fn(),
  mockDbSelectLimit: vi.fn(),
  mockDbUpdateReturning: vi.fn(),
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
// The PATCH handler uses two DB paths:
//   1. db.select({id}).from(reports).where().limit()  — report-existence check
//   2. db.update(reports).set().where().returning()   — report update
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
        where: () => ({
          returning: () => mockDbUpdateReturning(),
        }),
      }),
    }),
  },
}));

// Import handler AFTER mocks are registered.
import { PATCH } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_REPORT_UUID = "aa000001-e29b-41d4-a716-446655440000";
const INVALID_UUID = "not-a-uuid";
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

function makeUpdatedReport(status: "resolved" | "dismissed" = "resolved") {
  return {
    id: VALID_REPORT_UUID,
    status,
    resolvedAt: new Date("2026-04-15T10:00:00.000Z"),
    resolvedById: ADMIN_DB_USER_ID,
  };
}

// ---------------------------------------------------------------------------
// Route call helper
// ---------------------------------------------------------------------------

function callPatch(reportId: string, body: unknown = { status: "resolved" }) {
  const req = new Request(
    `http://localhost/api/admin/reports/${reportId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  return PATCH(req, { params: Promise.resolve({ id: reportId }) });
}

// ---------------------------------------------------------------------------
// Happy-path setup helper
// ---------------------------------------------------------------------------

function setupHappyPath(status: "resolved" | "dismissed" = "resolved") {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
  mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
  mockDbSelectLimit.mockResolvedValue([{ id: VALID_REPORT_UUID }]);
  mockDbUpdateReturning.mockResolvedValue([makeUpdatedReport(status)]);
}

// ============================================================================
// Auth
// ============================================================================

describe("PATCH /api/admin/reports/[id] — auth", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await callPatch(VALID_REPORT_UUID);

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 403 when caller is authenticated but is not an admin", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPatch(VALID_REPORT_UUID);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Param + body validation
// ============================================================================

describe("PATCH /api/admin/reports/[id] — param validation", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 400 for an invalid (non-UUID) report id param", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);

    const res = await callPatch(INVALID_UUID);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

describe("PATCH /api/admin/reports/[id] — body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_REPORT_UUID }]);
  });

  it("returns 400 when status value is not in the allowed enum (not resolved or dismissed)", async () => {
    const res = await callPatch(VALID_REPORT_UUID, { status: "open" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when status is missing from the body", async () => {
    const res = await callPatch(VALID_REPORT_UUID, {});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Report existence
// ============================================================================

describe("PATCH /api/admin/reports/[id] — report existence", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when the report does not exist", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    mockDbSelectLimit.mockResolvedValue([]); // report not found

    const res = await callPatch(VALID_REPORT_UUID);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ============================================================================
// Success path
// ============================================================================

describe("PATCH /api/admin/reports/[id] — success", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with id, status, resolvedAt (ISO string), and resolvedById on success", async () => {
    setupHappyPath("resolved");

    const res = await callPatch(VALID_REPORT_UUID, { status: "resolved" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: VALID_REPORT_UUID,
      status: "resolved",
      resolvedAt: expect.any(String),
      resolvedById: ADMIN_DB_USER_ID,
    });
  });

  it("resolvedAt in the response is a valid ISO 8601 string", async () => {
    setupHappyPath("resolved");

    const res = await callPatch(VALID_REPORT_UUID, { status: "resolved" });
    const body = await res.json();

    expect(typeof body.resolvedAt).toBe("string");
    expect(new Date(body.resolvedAt).toISOString()).toBe(body.resolvedAt);
  });

  it("resolvedById is set to the admin's DB user id", async () => {
    setupHappyPath("resolved");

    const res = await callPatch(VALID_REPORT_UUID, { status: "resolved" });
    const body = await res.json();

    expect(body.resolvedById).toBe(ADMIN_DB_USER_ID);
  });

  it("recategorization: PATCH to dismissed returns status=dismissed with a fresh resolvedAt", async () => {
    // Recategorizing from "resolved" to "dismissed" must re-stamp resolvedAt and
    // set resolvedById — this is documented in the route's JSDoc comment.
    const now = new Date("2026-04-16T08:00:00.000Z");
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue(CLERK_ADMIN_STUB);
    mockRequireAdmin.mockResolvedValue(ADMIN_DB_USER);
    mockDbSelectLimit.mockResolvedValue([{ id: VALID_REPORT_UUID }]);
    mockDbUpdateReturning.mockResolvedValue([{
      id: VALID_REPORT_UUID,
      status: "dismissed",
      resolvedAt: now,
      resolvedById: ADMIN_DB_USER_ID,
    }]);

    const res = await callPatch(VALID_REPORT_UUID, { status: "dismissed" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("dismissed");
    expect(body.resolvedAt).toBe(now.toISOString());
    expect(body.resolvedById).toBe(ADMIN_DB_USER_ID);
  });
});
