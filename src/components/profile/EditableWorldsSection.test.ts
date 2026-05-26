/**
 * Unit tests for EditableWorldsSection query and render logic.
 *
 * EditableWorldsSection is a server component that queries:
 *   db.query.worldCollaborators.findMany({ where: eq(userId), limit: 50, ... })
 *
 * Key contracts tested:
 *   1. Returns null (no section rendered) when the DB returns no rows.
 *   2. Returns a section heading with the correct copy for self vs. other profile.
 *   3. The heading copy is correct for isSelf=false (viewing someone else's profile).
 *
 * Why not test through the real DB?
 *   The vitest environment is "node" without a live Neon connection. We test the
 *   component's two observable decisions — null vs. render, heading copy — by
 *   mocking the DB module at the module boundary. Pattern mirrors
 *   notifications.test.ts and the other db.query.*.findMany mocks.
 *
 * What we do NOT test:
 *   - The full HTML structure / className values (CSS is not tested at the unit level).
 *   - WorldCardMedia / TagChip rendering (covered by their own component tests or
 *     trusted as third-party-like internals).
 *   - The with: { world: { ... } } nested query shape — that is covered by
 *     the Drizzle schema tests and the backend route tests for collaborators.
 *
 * Mocks:
 *   - @/db: vi.mock — exposes mockFindManyCollabs spy on db.query.worldCollaborators.findMany
 *   - next/link, @/components/world-card-media/WorldCardMedia, @/components/tag-chip/TagChip:
 *     vi.mock (stub) — the server component imports these; we mock them to avoid
 *     Next.js module resolution side-effects in the node environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist spy declarations so they are available inside vi.mock() factories
// ---------------------------------------------------------------------------

const mockFindManyCollabs = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@/db", () => ({
  db: {
    query: {
      worldCollaborators: {
        findMany: (...args: unknown[]) => mockFindManyCollabs(...args),
      },
    },
  },
}));

// Stub Next.js / internal component imports so the server component module can
// be imported in the node environment without JSX transform or browser APIs.
vi.mock("next/link", () => ({
  default: () => null,
}));

vi.mock("@/components/world-card-media/WorldCardMedia", () => ({
  WorldCardMedia: () => null,
}));

vi.mock("@/components/tag-chip/TagChip", () => ({
  TagChip: () => null,
}));

// ---------------------------------------------------------------------------
// Import the component AFTER mocks are set up.
// We import it dynamically in the test so vi.mock hoisting applies.
// ---------------------------------------------------------------------------

import { EditableWorldsSection } from "./EditableWorldsSection";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = "user-uuid-test-1111-1111-111111111111";

function makeWorldRow(id: string) {
  return {
    world: {
      id,
      title: `Test World ${id}`,
      createdAt: new Date(),
      likesCount: 5,
      views: 10,
      media: [],
      tags: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EditableWorldsSection — empty state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null when the DB query returns an empty array", async () => {
    mockFindManyCollabs.mockResolvedValueOnce([]);

    const result = await EditableWorldsSection({
      username: "alice",
      userId: USER_ID,
      isSelf: false,
    });

    expect(result).toBeNull();
  });
});

describe("EditableWorldsSection — heading copy", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses self-directed heading when isSelf is true", async () => {
    mockFindManyCollabs.mockResolvedValueOnce([makeWorldRow("world-1")]);

    const result = await EditableWorldsSection({
      username: "alice",
      userId: USER_ID,
      isSelf: true,
    });

    // The component renders: <h2>Worlds you can edit</h2> for self.
    // We serialise the JSX element tree by checking the props recursively.
    // Since we don't have a full JSX renderer in node, we verify the heading
    // text that the component passes via the section's aria-labelledby structure.
    // We look at the returned element's props for the heading string.
    const headingText = findTextInElement(result, "Worlds you can edit");
    expect(headingText).toBe(true);
  });

  it("uses username-directed heading when isSelf is false", async () => {
    mockFindManyCollabs.mockResolvedValueOnce([makeWorldRow("world-2")]);

    const result = await EditableWorldsSection({
      username: "alice",
      userId: USER_ID,
      isSelf: false,
    });

    // The component renders: `Worlds @alice can edit` for other users.
    const headingText = findTextInElement(result, "Worlds @alice can edit");
    expect(headingText).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helper — walk a React element tree looking for a specific string value
// among the element's children/props. Allows testing heading copy without
// a full renderer.
// ---------------------------------------------------------------------------

function findTextInElement(
  element: unknown,
  target: string
): boolean {
  if (element === null || element === undefined) return false;
  if (typeof element === "string") return element === target;
  if (typeof element === "number") return false;

  // React element — check children recursively
  if (
    typeof element === "object" &&
    element !== null &&
    "props" in (element as object)
  ) {
    const props = (element as { props: Record<string, unknown> }).props;
    if (typeof props.children === "string") {
      if (props.children === target) return true;
    }
    if (Array.isArray(props.children)) {
      for (const child of props.children as unknown[]) {
        if (findTextInElement(child, target)) return true;
      }
    } else if (props.children !== null && props.children !== undefined) {
      if (findTextInElement(props.children, target)) return true;
    }
  }

  // Array of elements
  if (Array.isArray(element)) {
    for (const item of element as unknown[]) {
      if (findTextInElement(item, target)) return true;
    }
  }

  return false;
}
