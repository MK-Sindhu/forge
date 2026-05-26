import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const {
  mockDbSelectLimit,
  mockFindMany,
} = vi.hoisted(() => ({
  // db.select().from().where().limit() — world existence check
  mockDbSelectLimit: vi.fn(),
  // db.query.worldVersions.findMany() — version list query
  mockFindMany: vi.fn(),
}));

// Mock @/db — no live DB connection in test runner
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockDbSelectLimit(...args),
        }),
      }),
    }),
    query: {
      worldVersions: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
  },
}));

import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_UUID = "550e8400-e29b-41d4-a716-446655440000";
const AUTHOR_UUID = "aa0e8400-e29b-41d4-a716-446655440001";

const AUTHOR_ROW = {
  id: AUTHOR_UUID,
  username: "alice",
  avatarUrl: "https://example.com/alice.jpg",
};

function makeVersionRow(n: number, createdAt: Date) {
  return {
    id: `ver-${n}-8400-e29b-41d4-a716-44665544000${n}`,
    versionNumber: n,
    status: "draft" as const,
    label: null,
    parentVersionId: null,
    createdAt,
    author: AUTHOR_ROW,
  };
}

function callGet(worldId: string, query: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/worlds/${worldId}/versions`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const req = new Request(url.toString());
  return GET(req, { params: Promise.resolve({ id: worldId }) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id]/versions — empty world", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns { versions: [], nextCursor: null } when a world has no versions", async () => {
    mockDbSelectLimit.mockResolvedValue([{ id: WORLD_UUID }]);
    mockFindMany.mockResolvedValue([]);

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ versions: [], nextCursor: null });
  });
});

describe("GET /api/worlds/[id]/versions — cursor pagination", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns nextCursor when more rows exist beyond the page limit", async () => {
    mockDbSelectLimit.mockResolvedValue([{ id: WORLD_UUID }]);

    // Default limit is 20; return 21 rows so hasMore is true
    const rows = Array.from({ length: 21 }, (_, i) =>
      makeVersionRow(21 - i, new Date(2026, 0, 21 - i))
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(WORLD_UUID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toHaveLength(20); // only the first 20 returned
    expect(body.nextCursor).toBeTruthy(); // cursor is the last-page-item's createdAt ISO string
    expect(typeof body.nextCursor).toBe("string");
  });

  it("returns nextCursor: null on the final page", async () => {
    mockDbSelectLimit.mockResolvedValue([{ id: WORLD_UUID }]);

    // Exactly 20 rows — no extra → hasMore = false
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeVersionRow(20 - i, new Date(2026, 0, 20 - i))
    );
    mockFindMany.mockResolvedValue(rows);

    const res = await callGet(WORLD_UUID);

    const body = await res.json();
    expect(body.versions).toHaveLength(20);
    expect(body.nextCursor).toBeNull();
  });
});

describe("GET /api/worlds/[id]/versions — response shape", () => {
  beforeEach(() => vi.resetAllMocks());

  it("includes author hydration per version row and omits sceneGraph", async () => {
    mockDbSelectLimit.mockResolvedValue([{ id: WORLD_UUID }]);
    mockFindMany.mockResolvedValue([makeVersionRow(1, new Date("2026-01-01"))]);

    const res = await callGet(WORLD_UUID);

    const body = await res.json();
    expect(body.versions).toHaveLength(1);

    const v = body.versions[0];
    // Author hydration required
    expect(v.author).toBeDefined();
    expect(v.author.id).toBe(AUTHOR_UUID);
    expect(v.author.username).toBe("alice");
    expect(v.author.avatarUrl).toBe("https://example.com/alice.jpg");

    // sceneGraph must NOT appear on list items
    expect(v).not.toHaveProperty("sceneGraph");

    // Other required fields
    expect(v.id).toBeDefined();
    expect(v.versionNumber).toBe(1);
    expect(v.status).toBe("draft");
    expect(typeof v.createdAt).toBe("string"); // ISO 8601
  });
});
