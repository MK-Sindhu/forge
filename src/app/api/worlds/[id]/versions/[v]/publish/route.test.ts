import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockRequireActiveDbUser,
  mockRequireWorldRole,
  mockTransaction,
  mockTxFindFirst,
  mockTxUpdateVersions,
  mockTxUpdateWorlds,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  // Mocked at module level — helper's own logic is unit-tested in world-permissions.test.ts.
  mockRequireWorldRole: vi.fn(),
  mockTransaction: vi.fn(),
  // tx.query.worldVersions.findFirst — checks whether version belongs to this world
  mockTxFindFirst: vi.fn(),
  // tx.update(worldVersions).set().where() — marks version as published
  mockTxUpdateVersions: vi.fn(),
  // tx.update(worlds).set().where() — sets worlds.publishedVersionId
  mockTxUpdateWorlds: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

vi.mock("@/lib/world-permissions", () => ({
  requireWorldRole: mockRequireWorldRole,
}));

vi.mock("@/db", () => ({
  dbPool: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

import { POST } from "./route";
import { worldVersions } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const VERSION_UUID = "660e8400-e29b-41d4-a716-446655440001";
const OTHER_WORLD_UUID = "770e8400-e29b-41d4-a716-446655440002";
const CLERK_USER_ID = "clerk_user_abc123";
const DB_USER_ID = "db-uuid-alice-001";

const DB_USER = {
  id: DB_USER_ID,
  clerkId: CLERK_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const VERSION_ROW = {
  id: VERSION_UUID,
  worldId: WORLD_UUID,
  versionNumber: 1,
  status: "draft",
};

function callPost(worldId: string, versionId: string) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/versions/${versionId}/publish`,
    { method: "POST" }
  );
  return POST(req, { params: Promise.resolve({ id: worldId, v: versionId }) });
}

// Fake tx for the transaction callback
function makeFakeTx() {
  return {
    query: {
      worldVersions: {
        findFirst: (...args: unknown[]) => mockTxFindFirst(...args),
      },
    },
    update: (table: unknown) => ({
      set: (_values: unknown) => ({
        where: () => {
          if (table === worldVersions) {
            mockTxUpdateVersions(table);
          } else {
            mockTxUpdateWorlds(table);
          }
          return Promise.resolve();
        },
      }),
    }),
  };
}

function setupHappyPath() {
  mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
  mockCurrentUser.mockResolvedValue({
    id: CLERK_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });
  mockRequireActiveDbUser.mockResolvedValue(DB_USER);
  mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
  mockTxFindFirst.mockResolvedValue(VERSION_ROW);
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(makeFakeTx())
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/worlds/[id]/versions/[v]/publish — auth + permissions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 403 when requireWorldRole returns a 403 NextResponse (non-owner)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );

    const res = await callPost(WORLD_UUID, VERSION_UUID);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/worlds/[id]/versions/[v]/publish — 404 guard", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when version id belongs to a different world (cross-world spoofing guard)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    // Owner of OTHER_WORLD, querying with that world's id but a version that
    // belongs to a different world — tx.query.worldVersions.findFirst returns
    // undefined because the WHERE also filters by worldId.
    mockRequireWorldRole.mockResolvedValue({ world: { id: OTHER_WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
    // Version not found on this world (the `and(eq(worldId, ...))` guard)
    mockTxFindFirst.mockResolvedValue(undefined);
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(makeFakeTx())
    );

    const res = await callPost(OTHER_WORLD_UUID, VERSION_UUID);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/worlds/[id]/versions/[v]/publish — happy path", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with { versionId, versionNumber, status: 'published' }", async () => {
    setupHappyPath();

    const res = await callPost(WORLD_UUID, VERSION_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      versionId: VERSION_UUID,
      versionNumber: 1,
      status: "published",
    });
  });

  it("is idempotent — calling again returns 200 with the same body", async () => {
    // Second publish call: version is already 'published', but the row is still
    // returned by findFirst (the route accepts any status on the version row).
    setupHappyPath();

    const res1 = await callPost(WORLD_UUID, VERSION_UUID);
    expect(res1.status).toBe(200);

    // Reset mocks and call again — same result
    vi.resetAllMocks();
    setupHappyPath();

    const res2 = await callPost(WORLD_UUID, VERSION_UUID);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1).toEqual(body2);
  });
});
