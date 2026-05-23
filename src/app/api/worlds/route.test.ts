import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
//
// All mock factories must be hoisted so they're registered before any module
// import resolves. vi.hoisted() runs synchronously at the top of the module
// scope — before any import statement executes.
// ---------------------------------------------------------------------------

const {
  mockAuth,
  mockCurrentUser,
  mockHeadObject,
  mockPublicUrlFor,
  mockUserLookup,
  mockUserInsert,
  mockTransaction,
  mockTxInsert,
  mockTxUpdate,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: currentUser() fetches the full Clerk user object.
  mockCurrentUser: vi.fn(),
  // External boundary: real headObject calls the AWS SDK against Cloudflare R2.
  // Mocked to return predictable { exists, contentLength } without network calls.
  mockHeadObject: vi.fn(),
  // External boundary: publicUrlFor constructs a CDN URL from an R2 key.
  // Mocked so assertions can compare exact strings without knowing CDN config.
  mockPublicUrlFor: vi.fn(),
  // Inner mock for db.select(...)...limit(n) — the user-lookup query.
  mockUserLookup: vi.fn(),
  // Inner mock for db.insert(...)...values(...)...returning() — user bootstrap.
  mockUserInsert: vi.fn(),
  // Inner mock for dbPool.transaction(...) — receives the callback.
  mockTransaction: vi.fn(),
  // Spy into tx.insert(table).values(values) calls inside the transaction.
  mockTxInsert: vi.fn(),
  // Spy into tx.update(table).set(values).where(...) calls inside the transaction.
  mockTxUpdate: vi.fn(),
}));

// Mock @clerk/nextjs/server — real Clerk calls require a live Clerk environment
// not available in the test runner.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/r2 — real calls need Cloudflare R2 credentials + network access.
vi.mock("@/lib/r2", () => ({
  headObject: mockHeadObject,
  publicUrlFor: mockPublicUrlFor,
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon instance.
// We mock both `db` (HTTP, single-query) and `dbPool` (WebSocket, transactions).
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (...args: unknown[]) => mockUserLookup(...args),
        }),
      }),
    }),
    insert: () => ({
      values: (payload: unknown) => ({
        returning: (...args: unknown[]) => mockUserInsert(payload, ...args),
      }),
    }),
  },
  dbPool: {
    transaction: (callback: (tx: unknown) => Promise<unknown>) =>
      mockTransaction(callback),
  },
}));

// Import the handler AFTER all mocks are registered.
import { POST } from "./route";
// Import real table refs — used as identity markers in toHaveBeenCalledWith assertions.
// These are pure JS objects; importing them does NOT trigger a DB connection.
import { worlds, worldMedia, users } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_USER_ID = "user_clerk_abc123"; // Clerk session userId
const VALID_WORLD_ID = "550e8400-e29b-41d4-a716-446655440000"; // UUID v4
const DB_USER_ID = "db-uuid-alice-001"; // Primary key in users table
const GLB_KEY = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/world.glb`;
const THUMBNAIL_KEY = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/thumbnail.jpg`;
const GLB_SIZE = 4096;
const THUMBNAIL_SIZE = 512;

const DB_USER_NO_TOS = {
  id: DB_USER_ID,
  clerkId: VALID_USER_ID,
  username: "alice",
  email: "alice@example.com",
  avatarUrl: null,
  createdAt: new Date("2026-01-01"),
  tosAcceptedAt: null,
};

const DB_USER_WITH_TOS = {
  ...DB_USER_NO_TOS,
  tosAcceptedAt: new Date("2026-03-01"),
};

const VALID_BODY = {
  worldId: VALID_WORLD_ID,
  title: "Alice's World",
  tosAccepted: true as const,
  glbKey: GLB_KEY,
  glbSizeBytes: GLB_SIZE,
  thumbnailKey: THUMBNAIL_KEY,
  thumbnailSizeBytes: THUMBNAIL_SIZE,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(body: unknown, rawBody?: string): Request {
  return new Request("http://localhost/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

/**
 * Sets up the "happy path" mock state: authenticated, valid R2 HEADs, user exists.
 * Individual test blocks can override individual mocks after calling this.
 */
function setupHappyPath(userRow = DB_USER_NO_TOS) {
  mockAuth.mockResolvedValue({ userId: VALID_USER_ID });

  // currentUser() is called by getOrCreateDbUser inside POST /api/worlds.
  mockCurrentUser.mockResolvedValue({
    id: VALID_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });

  mockHeadObject.mockImplementation(
    ({ bucket, objectKey }: { bucket: string; objectKey: string }) => {
      if (bucket === "glb" && objectKey === GLB_KEY) {
        return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
      }
      if (bucket === "media" && objectKey === THUMBNAIL_KEY) {
        return Promise.resolve({ exists: true, contentLength: THUMBNAIL_SIZE });
      }
      return Promise.resolve({ exists: false, contentLength: undefined });
    }
  );

  mockPublicUrlFor.mockImplementation(
    (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
  );

  mockUserLookup.mockResolvedValue([userRow]);

  // Default transaction: runs the callback with a fake tx object that routes
  // insert/update calls into mockTxInsert / mockTxUpdate so tests can assert them.
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        insert: (table: unknown) => ({
          values: (values: unknown) => {
            mockTxInsert(table, values);
            return Promise.resolve();
          },
        }),
        update: (table: unknown) => ({
          set: (values: unknown) => ({
            where: () => {
              mockTxUpdate(table, values);
              return Promise.resolve();
            },
          }),
        }),
      };
      return await callback(fakeTx);
    }
  );
}

// ---------------------------------------------------------------------------
// Block A — Auth
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Auth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 when auth() returns {userId: null}", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("auto-bootstraps the user row and returns 201 when authenticated user has no DB row yet", async () => {
    const BOOTSTRAPPED_USER = { ...DB_USER_NO_TOS };

    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
    mockCurrentUser.mockResolvedValue({
      id: VALID_USER_ID,
      username: "alice",
      emailAddresses: [{ emailAddress: "alice@example.com" }],
      imageUrl: null,
    });
    // Must pass the HEAD checks so the route reaches the user-bootstrap step.
    mockHeadObject.mockImplementation(
      ({ bucket }: { bucket: string }) => {
        if (bucket === "glb") {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
        }
        return Promise.resolve({ exists: true, contentLength: THUMBNAIL_SIZE });
      }
    );
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );
    mockUserLookup.mockResolvedValue([]); // empty → no existing DB row
    // Bootstrap INSERT returns the newly created user row.
    mockUserInsert.mockResolvedValue([BOOTSTRAPPED_USER]);
    // Transaction must succeed for the world to be created.
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          insert: (table: unknown) => ({
            values: (values: unknown) => {
              mockTxInsert(table, values);
              return Promise.resolve();
            },
          }),
          update: (table: unknown) => ({
            set: (values: unknown) => ({
              where: () => {
                mockTxUpdate(table, values);
                return Promise.resolve();
              },
            }),
          }),
        };
        return await callback(fakeTx);
      }
    );

    const res = await POST(makeRequest(VALID_BODY));

    // The route now bootstraps the user row instead of returning 401.
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ worldId: VALID_WORLD_ID });
    // The user INSERT must have been called (bootstrap happened).
    expect(mockUserInsert).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Block B — Body validation
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
  });

  it("returns 400 when body is invalid JSON", async () => {
    const res = await POST(makeRequest(null, "not-valid-json{{{{"));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when worldId is missing", async () => {
    const { worldId: _omit, ...rest } = VALID_BODY;
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when worldId is not a UUID", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, worldId: "not-a-uuid" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when title is empty string", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, title: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when title is longer than 100 characters", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, title: "a".repeat(101) }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when description exceeds 1000 characters", async () => {
    const res = await POST(
      makeRequest({ ...VALID_BODY, description: "x".repeat(1001) })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when tosAccepted is missing", async () => {
    const { tosAccepted: _omit, ...rest } = VALID_BODY;
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when tosAccepted is false", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, tosAccepted: false }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it.each([1, "yes", "true", 0])(
    "returns 400 when tosAccepted is truthy non-literal-true value %j",
    async (value) => {
      const res = await POST(makeRequest({ ...VALID_BODY, tosAccepted: value }));

      // z.literal(true) must reject anything that is not the boolean literal true.
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.any(String) });
    }
  );

  it("returns 400 when glbKey is missing", async () => {
    const { glbKey: _omit, ...rest } = VALID_BODY;
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it.each([0, -1, 1.5])(
    "returns 400 when glbSizeBytes is %d (not a positive integer)",
    async (value) => {
      const res = await POST(makeRequest({ ...VALID_BODY, glbSizeBytes: value }));

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.any(String) });
    }
  );
});

// ---------------------------------------------------------------------------
// Block C — Key prefix security check
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Key prefix security check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
  });

  it("returns 400 when glbKey belongs to a different user", async () => {
    const badKey = `worlds/wrong-user/${VALID_WORLD_ID}/world.glb`;

    const res = await POST(makeRequest({ ...VALID_BODY, glbKey: badKey }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when glbKey references a different worldId", async () => {
    const badKey = `worlds/${VALID_USER_ID}/wrong-world-id/world.glb`;

    const res = await POST(makeRequest({ ...VALID_BODY, glbKey: badKey }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when glbKey does not start with 'worlds/'", async () => {
    const badKey = `../etc/passwd`;

    const res = await POST(makeRequest({ ...VALID_BODY, glbKey: badKey }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when thumbnailKey has a wrong user prefix", async () => {
    const badKey = `worlds/other-user/${VALID_WORLD_ID}/thumbnail.jpg`;

    const res = await POST(
      makeRequest({ ...VALID_BODY, thumbnailKey: badKey })
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block D — R2 HEAD verification
// ---------------------------------------------------------------------------

describe("POST /api/worlds — R2 HEAD verification", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
  });

  it("returns 400 when HEAD on GLB returns {exists: false}", async () => {
    mockHeadObject.mockImplementation(
      ({ bucket }: { bucket: string }) => {
        if (bucket === "glb") {
          return Promise.resolve({ exists: false, contentLength: undefined });
        }
        return Promise.resolve({ exists: true, contentLength: THUMBNAIL_SIZE });
      }
    );

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    // The error message must indicate the file was not found / upload incomplete.
    expect(body.error).toMatch(/not found|did upload complete/i);
  });

  it("returns 400 when HEAD on GLB returns a contentLength different from glbSizeBytes", async () => {
    mockHeadObject.mockImplementation(
      ({ bucket }: { bucket: string }) => {
        if (bucket === "glb") {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE + 999 });
        }
        return Promise.resolve({ exists: true, contentLength: THUMBNAIL_SIZE });
      }
    );

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    // The error message must mention size mismatch.
    expect(body.error).toMatch(/mismatch/i);
  });

  it("returns 400 when HEAD on thumbnail returns {exists: false}", async () => {
    mockHeadObject.mockImplementation(
      ({ bucket }: { bucket: string }) => {
        if (bucket === "glb") {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
        }
        return Promise.resolve({ exists: false, contentLength: undefined });
      }
    );

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not found|did upload complete/i);
  });

  it("returns 400 when HEAD on thumbnail returns a size that mismatches thumbnailSizeBytes", async () => {
    mockHeadObject.mockImplementation(
      ({ bucket }: { bucket: string }) => {
        if (bucket === "glb") {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
        }
        return Promise.resolve({
          exists: true,
          contentLength: THUMBNAIL_SIZE + 1,
        });
      }
    );

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mismatch/i);
  });
});

// ---------------------------------------------------------------------------
// Block E — Success path + transaction integrity
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Success path + transaction integrity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
  });

  it("returns 201 with {worldId, url} on a fully valid request", async () => {
    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      worldId: VALID_WORLD_ID,
      url: `/world/${VALID_WORLD_ID}`,
    });
  });

  it("invokes the transaction callback", async () => {
    await POST(makeRequest(VALID_BODY));

    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("inserts a row into worlds with the correct worldId, userId, title, and glbUrl", async () => {
    const expectedGlbUrl = `https://cdn.example.com/glb/${GLB_KEY}`;
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    await POST(makeRequest(VALID_BODY));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({
        id: VALID_WORLD_ID,
        userId: DB_USER_ID,
        title: VALID_BODY.title,
        glbUrl: expectedGlbUrl,
        glbSizeBytes: GLB_SIZE,
      })
    );
  });

  it("inserts a row into world_media with type 'thumbnail' and position 0", async () => {
    const expectedThumbUrl = `https://cdn.example.com/media/${THUMBNAIL_KEY}`;
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    await POST(makeRequest(VALID_BODY));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      expect.objectContaining({
        worldId: VALID_WORLD_ID,
        type: "thumbnail",
        url: expectedThumbUrl,
        position: 0,
      })
    );
  });

  it("sets users.tosAcceptedAt when it was previously null", async () => {
    // DB_USER_NO_TOS has tosAcceptedAt: null — should trigger the update.
    mockUserLookup.mockResolvedValue([DB_USER_NO_TOS]);

    await POST(makeRequest(VALID_BODY));

    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      users,
      expect.objectContaining({ tosAcceptedAt: expect.any(Date) })
    );
  });

  it("does NOT update users.tosAcceptedAt when it was already set", async () => {
    // DB_USER_WITH_TOS already has a tosAcceptedAt — no update should happen.
    mockUserLookup.mockResolvedValue([DB_USER_WITH_TOS]);

    await POST(makeRequest(VALID_BODY));

    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("the worlds insert uses the glbUrl produced by publicUrlFor('glb', glbKey)", async () => {
    const EXPECTED_GLB_URL = "https://cdn.example.com/glb/world.glb";
    // Only return a distinct URL when called with ("glb", GLB_KEY).
    mockPublicUrlFor.mockImplementation((bucket: string, key: string) => {
      if (bucket === "glb" && key === GLB_KEY) return EXPECTED_GLB_URL;
      return `https://cdn.example.com/${bucket}/${key}`;
    });

    await POST(makeRequest(VALID_BODY));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ glbUrl: EXPECTED_GLB_URL })
    );
  });

  it("the world_media insert uses the url produced by publicUrlFor('media', thumbnailKey)", async () => {
    const EXPECTED_THUMB_URL = "https://cdn.example.com/media/thumb.jpg";
    mockPublicUrlFor.mockImplementation((bucket: string, key: string) => {
      if (bucket === "media" && key === THUMBNAIL_KEY) return EXPECTED_THUMB_URL;
      return `https://cdn.example.com/${bucket}/${key}`;
    });

    await POST(makeRequest(VALID_BODY));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      expect.objectContaining({ url: EXPECTED_THUMB_URL })
    );
  });
});
