import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
// ---------------------------------------------------------------------------

const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

// Mock @/db — the GET handler uses db.query.worlds.findFirst (relational API).
vi.mock("@/db", () => ({
  db: {
    query: {
      worlds: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}));

// Import the handler AFTER mocks are registered.
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";
const NOT_A_UUID = "not-a-uuid";

const DB_WORLD_ROW = {
  id: WORLD_ID,
  title: "Test World",
  description: "A cool world",
  glbUrl: "https://cdn.example.com/glb/worlds/user1/world.glb",
  glbSizeBytes: 4096,
  likesCount: 3,
  views: 42,
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  user: {
    id: "db-user-uuid-001",
    username: "alice",
    avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
  },
  media: [
    {
      id: "media-uuid-001",
      type: "thumbnail",
      url: "https://cdn.example.com/media/thumb.jpg",
      sizeBytes: 512,
      position: 0,
    },
    {
      id: "media-uuid-002",
      type: "image",
      url: "https://cdn.example.com/media/screenshot.jpg",
      sizeBytes: 800,
      position: 1,
    },
  ],
};

// ---------------------------------------------------------------------------
// Helper: build a Request for GET /api/worlds/[id]
// (body is irrelevant for GET, but we construct it for completeness)
// ---------------------------------------------------------------------------

function makeRequest(worldId: string): [Request, { params: Promise<{ id: string }> }] {
  const req = new Request(`http://localhost/api/worlds/${worldId}`);
  const context = { params: Promise.resolve({ id: worldId }) };
  return [req, context];
}

// ---------------------------------------------------------------------------
// Block A — UUID validation
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — UUID validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 400 for a non-UUID id", async () => {
    const [req, ctx] = makeRequest(NOT_A_UUID);
    const res = await GET(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid world id" });
  });

  it("returns 400 for an empty string id", async () => {
    const [req, ctx] = makeRequest("");
    const res = await GET(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid world id" });
  });

  it("returns 400 for a numeric string id", async () => {
    const [req, ctx] = makeRequest("12345");
    const res = await GET(req, ctx);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid world id" });
  });

  it("does NOT call db.query for an invalid id", async () => {
    const [req, ctx] = makeRequest(NOT_A_UUID);
    await GET(req, ctx);

    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Block B — Not found
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — Not found", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 404 when db returns undefined", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "World not found" });
  });

  it("calls db.query.worlds.findFirst with the correct UUID", async () => {
    mockFindFirst.mockResolvedValue(undefined);

    const [req, ctx] = makeRequest(WORLD_ID);
    await GET(req, ctx);

    expect(mockFindFirst).toHaveBeenCalledOnce();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Block C — Success path
// ---------------------------------------------------------------------------

describe("GET /api/worlds/[id] — Success", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindFirst.mockResolvedValue(DB_WORLD_ROW);
  });

  it("returns 200 for a valid UUID that exists", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
  });

  it("returns the correct top-level world fields", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body).toMatchObject({
      id: WORLD_ID,
      title: "Test World",
      description: "A cool world",
      glbUrl: "https://cdn.example.com/glb/worlds/user1/world.glb",
      glbSizeBytes: 4096,
      likesCount: 3,
      views: 42,
    });
  });

  it("returns createdAt as an ISO 8601 string", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.createdAt).toBe("2026-01-15T10:00:00.000Z");
  });

  it("returns the author with id, username, avatarUrl only", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.author).toEqual({
      id: "db-user-uuid-001",
      username: "alice",
      avatarUrl: "https://cdn.example.com/avatars/alice.jpg",
    });
  });

  it("does NOT expose author email, clerkId, tosAcceptedAt, or createdAt", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.author).not.toHaveProperty("email");
    expect(body.author).not.toHaveProperty("clerkId");
    expect(body.author).not.toHaveProperty("tosAcceptedAt");
    expect(body.author).not.toHaveProperty("createdAt");
  });

  it("returns the media array ordered as returned from the DB", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.media).toHaveLength(2);
    expect(body.media[0]).toEqual({
      id: "media-uuid-001",
      type: "thumbnail",
      url: "https://cdn.example.com/media/thumb.jpg",
      sizeBytes: 512,
      position: 0,
    });
    expect(body.media[1]).toEqual({
      id: "media-uuid-002",
      type: "image",
      url: "https://cdn.example.com/media/screenshot.jpg",
      sizeBytes: 800,
      position: 1,
    });
  });

  it("returns an empty media array when no media rows exist", async () => {
    mockFindFirst.mockResolvedValue({ ...DB_WORLD_ROW, media: [] });

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.media).toEqual([]);
  });

  it("returns null for description when it is null in the DB", async () => {
    mockFindFirst.mockResolvedValue({ ...DB_WORLD_ROW, description: null });

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.description).toBeNull();
  });

  it("returns null for author.avatarUrl when it is null in the DB", async () => {
    mockFindFirst.mockResolvedValue({
      ...DB_WORLD_ROW,
      user: { ...DB_WORLD_ROW.user, avatarUrl: null },
    });

    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(body.author.avatarUrl).toBeNull();
  });

  it("response has exactly the documented top-level keys", async () => {
    const [req, ctx] = makeRequest(WORLD_ID);
    const res = await GET(req, ctx);
    const body = await res.json();

    const expectedKeys = new Set([
      "id",
      "title",
      "description",
      "glbUrl",
      "glbSizeBytes",
      "likesCount",
      "views",
      "createdAt",
      "author",
      "media",
    ]);
    const actualKeys = new Set(Object.keys(body));

    expect(actualKeys).toEqual(expectedKeys);
  });
});
