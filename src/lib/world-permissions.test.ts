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
 *
 * Slice 9.2 extension: requireWorldRole now makes TWO db.select() calls when
 * the caller is not the owner:
 *   call 1 — db.select().from(worlds).where(...).limit(1)          → worlds lookup
 *   call 2 — db.select().from(worldCollaborators).where(...).limit(1) → collab lookup
 *
 * For owner-path tests only 1 call happens (collab lookup is short-circuited).
 * For non-owner-path tests both calls happen. mockDbSelectLimit uses
 * mockResolvedValueOnce chaining to serve the correct response per call.
 * vi.resetAllMocks() in beforeEach clears the queue automatically.
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
  // Controls what db.select(...)...limit(1) resolves with.
  // Use mockResolvedValue([row]) for single-call paths (owner).
  // Use mockResolvedValueOnce([row]).mockResolvedValueOnce([collabRow])
  // for two-call paths (non-owner hitting getCollaboratorRole).
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
import { requireWorldRole, getWorldRoleForUser, type WorldRole } from "./world-permissions";
import type { DbUser } from "@/lib/users";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";
const OWNER_DB_ID = "660e8400-e29b-41d4-a716-446655440001";
const OTHER_DB_ID = "770e8400-e29b-41d4-a716-446655440002";
const COLLAB_DB_ID = "880e8400-e29b-41d4-a716-446655440003";

// A minimal DbUser — only id is used by requireWorldRole
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

const collabUser: DbUser = {
  id: COLLAB_DB_ID,
  clerkId: "clerk_collab_xyz",
  username: "contributor",
  email: "contrib@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
  isAdmin: false,
  suspendedAt: null,
};

// A minimal WorldRow matching typeof worlds.$inferSelect.
// userId = OWNER_DB_ID (not COLLAB_DB_ID or OTHER_DB_ID).
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
// Tests — Phase 2 owner-only paths (single db.select call)
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
    // Non-owner, non-collaborator: worlds lookup → found, collab lookup → empty
    mockDbSelectLimit
      .mockResolvedValueOnce([worldRow])    // call 1: worlds lookup
      .mockResolvedValueOnce([]);           // call 2: collab lookup → no row

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

  it("returns 503 NextResponse and logs error when DB throws on world lookup", async () => {
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
    // The resolved role is always "owner" when the caller IS the owner —
    // requiredRole is the minimum threshold, not what gets returned.
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

// ---------------------------------------------------------------------------
// Tests — Slice 9.2 collaborator paths (two db.select calls)
//
// When the caller is NOT the world owner, requireWorldRole invokes
// getCollaboratorRole which issues a second db.select()...limit(1) against
// world_collaborators. mockResolvedValueOnce chaining provides distinct
// responses for call 1 (worlds) and call 2 (collaborators).
// ---------------------------------------------------------------------------

describe("requireWorldRole — Slice 9.2 (collaborator role lookup)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns { world, role: 'editor' } when caller has an editor collab row and requires 'editor'", async () => {
    // collabUser.id !== worldRow.userId (not the owner), but has editor row
    mockDbSelectLimit
      .mockResolvedValueOnce([worldRow])           // call 1: worlds lookup → found
      .mockResolvedValueOnce([{ role: "editor" }]); // call 2: collab lookup → editor row

    const result = await requireWorldRole(WORLD_ID, collabUser, "editor");

    expect(result).not.toBeInstanceOf(NextResponse);
    const { world, role } = result as { world: typeof worldRow; role: WorldRole };
    // Confirm the world is the same row and it belongs to OWNER, not collabUser
    expect(world.userId).toBe(OWNER_DB_ID);
    expect(world.userId).not.toBe(COLLAB_DB_ID);
    expect(role).toBe("editor");
  });

  it("returns 403 when caller has editor collab row but requires 'owner'", async () => {
    // Editor rank (1) < owner rank (2) → ROLE_RANK check fails
    mockDbSelectLimit
      .mockResolvedValueOnce([worldRow])           // call 1: worlds lookup → found
      .mockResolvedValueOnce([{ role: "editor" }]); // call 2: collab lookup → editor row

    const result = await requireWorldRole(WORLD_ID, collabUser, "owner");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 403 when caller has no collab row and is not the owner", async () => {
    // No collab row — neither owner nor collaborator
    mockDbSelectLimit
      .mockResolvedValueOnce([worldRow])  // call 1: worlds lookup → found
      .mockResolvedValueOnce([]);         // call 2: collab lookup → empty

    const result = await requireWorldRole(WORLD_ID, otherUser, "editor");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: expect.any(String) });
  });

  it("returns 503 when the collaborator DB query throws", async () => {
    // World lookup succeeds; collab lookup throws
    const dbError = new Error("pg connection error");
    mockDbSelectLimit
      .mockResolvedValueOnce([worldRow])   // call 1: worlds lookup → found
      .mockRejectedValueOnce(dbError);     // call 2: collab lookup → throws

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await requireWorldRole(WORLD_ID, otherUser, "editor");

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(503);
    const body = await (result as NextResponse).json();
    expect(body).toMatchObject({ error: expect.any(String) });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Tests — Slice 9.2 Chunk 5 — getWorldRoleForUser (discriminated union)
//
// Chunk 4 exported getWorldRoleForUser as a distinct entry point so that the
// edit page (a server component) can call it without getting a NextResponse.
// These tests exercise the discriminated union returned by this function
// directly. Only the success variants are tested here — the error variants
// (not-found, forbidden, db-error) are already exercised indirectly by
// requireWorldRole tests above (which delegates to getWorldRoleForUser
// internally).
// ---------------------------------------------------------------------------

describe("getWorldRoleForUser — Slice 9.2 Chunk 5 (discriminated union)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("owner → returns { kind: 'ok', world, role: 'owner' }", async () => {
    // ownerUser.id === worldRow.userId — owner path (single DB call)
    mockDbSelectLimit.mockResolvedValue([worldRow]);

    const result = await getWorldRoleForUser(WORLD_ID, ownerUser);

    // Must be the "ok" variant — not a NextResponse (getWorldRoleForUser never
    // returns NextResponse; that is requireWorldRole's job).
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return; // narrow the union for TypeScript

    expect(result.role).toBe("owner");
    expect(result.world.id).toBe(WORLD_ID);
    // world.userId is the owner's id — confirms we got back the correct row
    expect(result.world.userId).toBe(OWNER_DB_ID);
  });

  it("collaborator → returns { kind: 'ok', world, role: 'editor' }", async () => {
    // collabUser.id !== worldRow.userId — triggers the collaborator lookup path
    // (two DB calls: worlds lookup → found, worldCollaborators lookup → editor row)
    mockDbSelectLimit
      .mockResolvedValueOnce([worldRow])           // call 1: worlds lookup → found
      .mockResolvedValueOnce([{ role: "editor" }]); // call 2: collab lookup → editor row

    const result = await getWorldRoleForUser(WORLD_ID, collabUser);

    // Must be the "ok" variant with role "editor" (not "owner")
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.role).toBe("editor");
    // world.userId is still the OWNER's id — confirms the collaborator does not
    // appear as the owner in the returned world row
    expect(result.world.userId).toBe(OWNER_DB_ID);
    expect(result.world.userId).not.toBe(COLLAB_DB_ID);
  });
});
