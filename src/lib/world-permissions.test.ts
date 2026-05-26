/**
 * world-permissions.test.ts — spec-first unit tests for requireWorldRole.
 *
 * Why mocks:
 *  - `@/db` is mocked because db.select(...)...limit(1) would need a live
 *    Neon instance with DATABASE_URL; neither is available in the test runner.
 *  - `next/server` is NOT mocked — we use the real NextResponse so
 *    instanceof checks and .status assertions are genuine.
 *
 * Pattern: vi.hoisted() + vi.mock() matches the existing route test convention
 * in this repo (see src/app/api/worlds/[id]/likes/route.test.ts).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// vi.hoisted() runs synchronously before any import resolves. All mock
// factories used inside vi.mock() must be captured here.
// ---------------------------------------------------------------------------

const { mockDbSelectLimit } = vi.hoisted(() => ({
  // Controls what db.select(...)...from(worlds).where(...).limit(1) resolves with.
  // Returning an array (empty = not found, array with row = found).
  mockDbSelectLimit: vi.fn(),
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon
// instance; both are unavailable in the test runner.
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

// Import the module under test AFTER mocks are registered.
import { requireWorldRole, type WorldRole } from "./world-permissions";
import type { DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_DB_ID = "660e8400-e29b-41d4-a716-446655440001";
const OTHER_DB_ID = "770e8400-e29b-41d4-a716-446655440002";

// A minimal DbUser (only id is used by requireWorldRole in Phase 2)
const ownerUser: DbUser = {
  id: OWNER_DB_ID,
  clerkId: "clerk_owner_abc",
  username: "worldowner",
  email: "owner@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

const otherUser: DbUser = {
  id: OTHER_DB_ID,
  clerkId: "clerk_other_xyz",
  username: "interloper",
  email: "interloper@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

// A minimal WorldRow matching typeof worlds.$inferSelect
const worldRow = {
  id: WORLD_ID,
  userId: OWNER_DB_ID,
  title: "My World",
  description: null,
  glbUrl: "https://example.com/world.glb",
  glbSizeBytes: 1024,
  likesCount: 0,
  views: 0,
  createdAt: new Date("2026-01-01"),
  sceneGraph: null,
  publishedVersionId: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requireWorldRole — Phase 2 (owner-only)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns { world, role: 'owner' } when owner calls with requiredRole 'owner'", async () => {
    mockDbSelectLimit.mockResolvedValue([worldRow]);

    const result = await requireWorldRole(WORLD_ID, ownerUser, "owner");

    expect(result).not.toBeInstanceOf(NextResponse);
    const { world, role } = result as { world: typeof worldRow; role: WorldRole };
    expect(role).toBe("owner");
    expect(world.id).toBe(WORLD_ID);
    expect(world.userId).toBe(OWNER_DB_ID);
  });

  it("returns 403 NextResponse when a non-owner calls with requiredRole 'owner'", async () => {
    mockDbSelectLimit.mockResolvedValue([worldRow]);

    const result = await requireWorldRole(WORLD_ID, otherUser, "owner");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 404 NextResponse when the world is not found", async () => {
    mockDbSelectLimit.mockResolvedValue([]); // empty = world not found

    const result = await requireWorldRole(WORLD_ID, ownerUser, "owner");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 503 NextResponse and logs error when DB throws", async () => {
    const dbError = new Error("connection refused");
    mockDbSelectLimit.mockRejectedValue(dbError);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requireWorldRole(WORLD_ID, ownerUser, "owner");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(503);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: expect.any(String) });
    // The implementation logs the error; we verify the log happened
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("owner satisfies requiredRole 'editor' (owner rank >= editor rank)", async () => {
    mockDbSelectLimit.mockResolvedValue([worldRow]);

    const result = await requireWorldRole(WORLD_ID, ownerUser, "editor");

    // Owner outranks editor; should succeed
    expect(result).not.toBeInstanceOf(NextResponse);
    const { role } = result as { world: typeof worldRow; role: WorldRole };
    // Phase 2: the resolved role is always "owner" when the caller IS the owner,
    // regardless of requiredRole. The requiredRole is the minimum threshold.
    expect(role).toBe("owner");
  });

  it("owner satisfies requiredRole 'viewer' (owner rank >= viewer rank)", async () => {
    mockDbSelectLimit.mockResolvedValue([worldRow]);

    const result = await requireWorldRole(WORLD_ID, ownerUser, "viewer");

    expect(result).not.toBeInstanceOf(NextResponse);
    const { role } = result as { world: typeof worldRow; role: WorldRole };
    expect(role).toBe("owner");
  });
});
