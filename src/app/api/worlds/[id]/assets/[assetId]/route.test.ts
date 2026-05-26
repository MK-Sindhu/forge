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
  // tx.select().from().where().limit() — load asset row
  mockTxSelect,
  // tx.select().from().where().limit() — conflict check (second call)
  mockTxConflictSelect,
  // tx.delete().where() — delete asset row
  mockTxDelete,
  // External boundary: deleteObject calls R2 — not available in test runner
  mockDeleteObject,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCurrentUser: vi.fn(),
  mockRequireActiveDbUser: vi.fn(),
  mockRequireWorldRole: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxSelect: vi.fn(),
  mockTxConflictSelect: vi.fn(),
  mockTxDelete: vi.fn(),
  // External boundary: deleteObject uses R2 client which requires real AWS creds;
  // mocked so tests can assert the call shape and simulate errors.
  mockDeleteObject: vi.fn(),
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

vi.mock("@/lib/r2", () => ({
  deleteObject: mockDeleteObject,
}));

import { DELETE } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const ASSET_UUID = "660e8400-e29b-41d4-a716-446655440001";
const VERSION_UUID = "770e8400-e29b-41d4-a716-446655440002";
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

// The glbUrl must contain "/assets/" so the route can extract the objectKey.
// The route calls: glbUrl.indexOf("/assets/"), then slices after the leading "/"
// to produce the objectKey. So: "https://cdn.example.com/assets/.../asset.glb"
// → objectKey = "assets/.../asset.glb"
const FAKE_GLB_URL = `https://cdn.example.com/assets/${CLERK_USER_ID}/${ASSET_UUID}/asset.glb`;
const EXPECTED_OBJECT_KEY = `assets/${CLERK_USER_ID}/${ASSET_UUID}/asset.glb`;

const ASSET_ROW = {
  id: ASSET_UUID,
  glbUrl: FAKE_GLB_URL,
};

function callDelete(worldId: string, assetId: string) {
  const req = new Request(
    `http://localhost/api/worlds/${worldId}/assets/${assetId}`,
    { method: "DELETE" }
  );
  return DELETE(req, { params: Promise.resolve({ id: worldId, assetId }) });
}

// ---------------------------------------------------------------------------
// Fake transaction builders
//
// The DELETE route uses TWO separate tx.select().from().where().limit() calls
// inside the transaction:
//   call 1: load the asset row    (mockTxSelect)
//   call 2: conflict check query  (mockTxConflictSelect)
//
// We need to distinguish them. The simplest approach: the first .limit() call
// returns mockTxSelect's value, the second returns mockTxConflictSelect's value.
// We track calls to limit via a counter in the fake tx.
//
// The transaction also uses tx.delete().where() for the happy path.
// ---------------------------------------------------------------------------

function makeFakeTx(assetExists = true, conflictRows: unknown[] = []) {
  let selectCallCount = 0;
  return {
    select: (_cols: unknown) => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: unknown) => {
            selectCallCount++;
            if (selectCallCount === 1) {
              // First select: asset existence check
              mockTxSelect();
              return assetExists
                ? Promise.resolve([ASSET_ROW])
                : Promise.resolve([]);
            } else {
              // Second select: conflict check
              mockTxConflictSelect();
              return Promise.resolve(conflictRows);
            }
          },
        }),
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => {
        mockTxDelete();
        return Promise.resolve();
      },
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
  // No conflict rows — asset is not referenced by any version
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(makeFakeTx(true, []))
  );
  mockDeleteObject.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /api/worlds/[id]/assets/[assetId] — auth + permissions", () => {
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

    const res = await callDelete(WORLD_UUID, ASSET_UUID);

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/worlds/[id]/assets/[assetId] — 404 when asset not found", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 404 when asset row is not found (or belongs to a different world)", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
    // Asset select returns empty — not found
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx(false, []))
    );

    const res = await callDelete(WORLD_UUID, ASSET_UUID);

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/worlds/[id]/assets/[assetId] — 409 strict integrity", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 409 with { error: 'asset in use', referencedBy } when a version references the assetId", async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: CLERK_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    mockRequireActiveDbUser.mockResolvedValue(DB_USER);
    mockRequireWorldRole.mockResolvedValue({ world: { id: WORLD_UUID, userId: DB_USER_ID }, role: "owner" });
    // Conflict: one version references this asset
    const conflictRows = [{ id: VERSION_UUID, versionNumber: 2 }];
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(makeFakeTx(true, conflictRows))
    );

    const res = await callDelete(WORLD_UUID, ASSET_UUID);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("asset in use");
    expect(body.referencedBy).toBeTruthy();
    expect(body.referencedBy.versionId).toBe(VERSION_UUID);
    expect(body.referencedBy.versionNumber).toBe(2);
  });
});

describe("DELETE /api/worlds/[id]/assets/[assetId] — happy path (200)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns 200 with { deleted: true, assetId } and calls deleteObject with the correct R2 key", async () => {
    setupHappyPath();

    const res = await callDelete(WORLD_UUID, ASSET_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.assetId).toBe(ASSET_UUID);

    // deleteObject must be called with the objectKey derived from the stored glbUrl.
    // glbUrl = "https://cdn.example.com/assets/..." → key = "assets/..."
    expect(mockDeleteObject).toHaveBeenCalledOnce();
    expect(mockDeleteObject).toHaveBeenCalledWith({
      bucket: "glb",
      objectKey: EXPECTED_OBJECT_KEY,
    });
  });

  it("still returns 200 when deleteObject throws (best-effort R2 cleanup)", async () => {
    setupHappyPath();
    // Simulate R2 cleanup failing after the DB row is already deleted
    mockDeleteObject.mockRejectedValue(new Error("R2 network error"));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await callDelete(WORLD_UUID, ASSET_UUID);

    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    consoleSpy.mockRestore();
  });
});
