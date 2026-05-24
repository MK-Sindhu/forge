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
  mockRequireActiveDbUser,
  mockHeadObject,
  mockPublicUrlFor,
  mockUserLookup,
  mockUserInsert,
  mockTransaction,
  mockTxInsert,
  mockTxUpdate,
  mockTxSelect,
  // Inner mock for db.select(...)...where() (no .limit()) — the fanout
  // followers query after world creation. The follows query does NOT call
  // .limit() — it returns all follower rows — so this separate mock handles
  // the terminal .where() call on that chain.
  mockDbSelectWhere,
  // External boundary: @/lib/notifications — mocked so tests can assert the
  // notifyMany() call shape without a real DB insert. The helper's internal
  // logic is tested in src/lib/notifications.test.ts.
  mockNotifyMany,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  // External boundary: currentUser() fetches the full Clerk user object.
  mockCurrentUser: vi.fn(),
  // External boundary: requireActiveDbUser resolves the DB user + suspension check.
  mockRequireActiveDbUser: vi.fn(),
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
  // Spy into tx.select(...).from(...).where(...) calls inside the transaction.
  // Used by the tag re-select step (SELECT id, name FROM tags WHERE name = ANY($1)).
  // By default returns [] so tests that don't care about tags pass without noise.
  mockTxSelect: vi.fn(),
  // Terminal .where() spy for the post-transaction followers fanout query:
  //   db.select({ followerId }).from(follows).where(eq(follows.followeeId, ...))
  // Returns [] by default — existing tests that don't care about fanout pass.
  mockDbSelectWhere: vi.fn(),
  // Mock for notifyMany() — the bulk notifications helper is an external DB
  // boundary; mocking at this seam lets tests assert the fanout array shape.
  mockNotifyMany: vi.fn(),
}));

// Mock @clerk/nextjs/server — real Clerk calls require a live Clerk environment
// not available in the test runner.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
  currentUser: mockCurrentUser,
}));

// Mock @/lib/users — avoids a real DB lookup for user bootstrap.
vi.mock("@/lib/users", () => ({
  requireActiveDbUser: mockRequireActiveDbUser,
}));

// Mock @/lib/r2 — real calls need Cloudflare R2 credentials + network access.
vi.mock("@/lib/r2", () => ({
  headObject: mockHeadObject,
  publicUrlFor: mockPublicUrlFor,
}));

// Mock @/lib/notifications — mocks the entire notifications helper module so
// tests can assert notifyMany() is called with the correct fanout array without
// a real DB insert or notifications table.
vi.mock("@/lib/notifications", () => ({
  notifyMany: mockNotifyMany,
}));

// Mock @/db — real DB connections require DATABASE_URL + a running Neon instance.
// We mock both `db` (HTTP, single-query) and `dbPool` (WebSocket, transactions).
//
// The db.select() chain is used in two places post-transaction:
//   1. (Legacy — no longer in this route but kept for safety) user-lookup
//      → terminates with .limit() → mockUserLookup
//   2. Followers fanout query: db.select({ followerId }).from(follows).where(...)
//      → terminates with .where() (no .limit()) → mockDbSelectWhere
//
// To distinguish the two terminal calls, we model them as separate mocks.
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (..._args: unknown[]) => ({
          // Terminal for the old user-lookup chain (has .limit())
          limit: (...args: unknown[]) => mockUserLookup(...args),
          // Also make .where() itself return the mockDbSelectWhere result
          // so the followers query (which calls .where() as the terminal step)
          // resolves correctly.
          then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            mockDbSelectWhere().then(resolve, reject),
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
import { worlds, worldMedia, users, tags, worldTags } from "@/db/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_USER_ID = "user_clerk_abc123"; // Clerk session userId
const VALID_WORLD_ID = "550e8400-e29b-41d4-a716-446655440000"; // UUID v4
const DB_USER_ID = "db-uuid-alice-001"; // Primary key in users table
const GLB_KEY = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/world.glb`;
const THUMBNAIL_KEY = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/thumbnail.jpg`;
const VIDEO_KEY = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/preview.mp4`;
const IMAGE_KEY_1 = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/image1.jpg`;
const IMAGE_KEY_2 = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/image2.jpg`;
const IMAGE_KEY_3 = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/image3.jpg`;
const IMAGE_KEY_4 = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/image4.jpg`;
const GLB_SIZE = 4096;
const THUMBNAIL_SIZE = 512;
const VIDEO_SIZE = 8192;
const IMAGE_SIZE = 1024;

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

// ---------------------------------------------------------------------------
// Body factory
//
// Produces a valid request body conforming to the Slice 2 spec.
// Individual tests override specific fields via the overrides parameter.
// ---------------------------------------------------------------------------

type MediaItem = {
  kind: "thumbnail" | "image" | "video";
  key: string;
  sizeBytes: number;
};

type ValidBodyShape = {
  worldId: string;
  title: string;
  description?: string;
  tosAccepted: true;
  glbKey: string;
  glbSizeBytes: number;
  media: MediaItem[];
  tags?: string[];
};

function makeValidBody(overrides: Partial<ValidBodyShape> = {}): ValidBodyShape {
  return {
    worldId: VALID_WORLD_ID,
    title: "Alice's World",
    description: "Description here",
    tosAccepted: true,
    glbKey: GLB_KEY,
    glbSizeBytes: GLB_SIZE,
    media: [
      {
        kind: "thumbnail" as const,
        key: THUMBNAIL_KEY,
        sizeBytes: THUMBNAIL_SIZE,
      },
    ],
    ...overrides,
  };
}

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
 * Handles both the GLB bucket and any media keys under worlds/<userId>/<worldId>/.
 * Individual test blocks can override individual mocks after calling this.
 */
function setupHappyPath(userRow = DB_USER_NO_TOS) {
  mockAuth.mockResolvedValue({ userId: VALID_USER_ID });

  // currentUser() is called before requireActiveDbUser inside POST /api/worlds.
  mockCurrentUser.mockResolvedValue({
    id: VALID_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });

  // requireActiveDbUser returns the DB user row directly.
  mockRequireActiveDbUser.mockResolvedValue(userRow);

  // Default: fanout followers query returns no followers — notifyMany not called.
  // Individual notify tests override this with mockDbSelectWhere.mockResolvedValue([...]).
  mockDbSelectWhere.mockResolvedValue([]);
  // Default: notifyMany is a no-op so existing tests that don't assert on it pass.
  mockNotifyMany.mockResolvedValue(undefined);

  // The route HEADs the GLB key and each media item key.
  // Return success for any key under the valid user/world prefix; fail otherwise.
  mockHeadObject.mockImplementation(
    ({ bucket, objectKey }: { bucket: string; objectKey: string }) => {
      const validPrefix = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/`;
      if (bucket === "glb" && objectKey === GLB_KEY) {
        return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
      }
      if (bucket === "media" && objectKey.startsWith(validPrefix)) {
        // Return the correct sizeBytes for each known key.
        if (objectKey === THUMBNAIL_KEY) {
          return Promise.resolve({ exists: true, contentLength: THUMBNAIL_SIZE });
        }
        if (objectKey === VIDEO_KEY) {
          return Promise.resolve({ exists: true, contentLength: VIDEO_SIZE });
        }
        // Default for image keys
        return Promise.resolve({ exists: true, contentLength: IMAGE_SIZE });
      }
      return Promise.resolve({ exists: false, contentLength: undefined });
    }
  );

  mockPublicUrlFor.mockImplementation(
    (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
  );

  // Default tag re-select returns an empty array. Individual tag tests override
  // this to control which tag rows are "found" after onConflictDoNothing.
  mockTxSelect.mockResolvedValue([]);

  // Default transaction: runs the callback with a fake tx object that routes
  // insert/update calls into mockTxInsert / mockTxUpdate so tests can assert them.
  // The select chain is added for the tag re-select step:
  //   tx.select({ id, name }).from(tags).where(inArray(tags.name, [...]))
  // mockTxSelect is called with the where-clause argument (the inArray value)
  // so tests can assert which names were queried.
  mockTransaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) => {
      const fakeTx = {
        insert: (table: unknown) => ({
          values: (values: unknown) => {
            mockTxInsert(table, values);
            // Return an object with onConflictDoNothing so the tags insert chain
            // tx.insert(tags).values(...).onConflictDoNothing() resolves.
            return {
              onConflictDoNothing: () => Promise.resolve(),
            };
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
        // Tag re-select chain: tx.select({...}).from(tags).where(inArray(...))
        // The terminal .where() call invokes mockTxSelect and returns its result.
        select: (_columns: unknown) => ({
          from: (_table: unknown) => ({
            where: (whereArg: unknown) => mockTxSelect(whereArg),
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

    const res = await POST(makeRequest(makeValidBody()));

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
    // requireActiveDbUser handles the bootstrap — returns the user row directly.
    mockRequireActiveDbUser.mockResolvedValue(BOOTSTRAPPED_USER);
    // Must pass the HEAD checks so the route reaches the user-bootstrap step.
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
    // Transaction must succeed for the world to be created.
    // Mirrors the fakeTx in setupHappyPath (including onConflictDoNothing + select).
    mockTransaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        const fakeTx = {
          insert: (table: unknown) => ({
            values: (values: unknown) => {
              mockTxInsert(table, values);
              return {
                onConflictDoNothing: () => Promise.resolve(),
              };
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
          select: (_columns: unknown) => ({
            from: (_table: unknown) => ({
              where: (_whereArg: unknown) => Promise.resolve([]),
            }),
          }),
        };
        return await callback(fakeTx);
      }
    );

    const res = await POST(makeRequest(makeValidBody()));

    // The route bootstraps the user row (via requireActiveDbUser) and returns 201.
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ worldId: VALID_WORLD_ID });
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
    const { worldId: _omit, ...rest } = makeValidBody();
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when worldId is not a UUID", async () => {
    const res = await POST(makeRequest(makeValidBody({ worldId: "not-a-uuid" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when title is empty string", async () => {
    const res = await POST(makeRequest(makeValidBody({ title: "" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when title is longer than 100 characters", async () => {
    const res = await POST(makeRequest(makeValidBody({ title: "a".repeat(101) })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when description exceeds 1000 characters", async () => {
    const res = await POST(
      makeRequest(makeValidBody({ description: "x".repeat(1001) }))
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when tosAccepted is missing", async () => {
    const { tosAccepted: _omit, ...rest } = makeValidBody();
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when tosAccepted is false", async () => {
    const res = await POST(makeRequest({ ...makeValidBody(), tosAccepted: false }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it.each([1, "yes", "true", 0])(
    "returns 400 when tosAccepted is truthy non-literal-true value %j",
    async (value) => {
      const res = await POST(makeRequest({ ...makeValidBody(), tosAccepted: value }));

      // z.literal(true) must reject anything that is not the boolean literal true.
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.any(String) });
    }
  );

  it("returns 400 when glbKey is missing", async () => {
    const { glbKey: _omit, ...rest } = makeValidBody();
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it.each([0, -1, 1.5])(
    "returns 400 when glbSizeBytes is %d (not a positive integer)",
    async (value) => {
      const res = await POST(makeRequest(makeValidBody({ glbSizeBytes: value })));

      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: expect.any(String) });
    }
  );

  it("returns 400 when media field is missing", async () => {
    const { media: _omit, ...rest } = makeValidBody();
    const res = await POST(makeRequest(rest));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when a media item is missing its kind field", async () => {
    const res = await POST(
      makeRequest(makeValidBody({
        media: [{ key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE } as unknown as MediaItem],
      }))
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when a media item has an unsupported kind value", async () => {
    const res = await POST(
      makeRequest(makeValidBody({
        media: [{ kind: "gif" as unknown as "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE }],
      }))
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it.each([0, -1, 1.5])(
    "returns 400 when a media item sizeBytes is %d (not a positive integer)",
    async (value) => {
      const res = await POST(
        makeRequest(makeValidBody({
          media: [{ kind: "thumbnail" as const, key: THUMBNAIL_KEY, sizeBytes: value }],
        }))
      );

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

    const res = await POST(makeRequest(makeValidBody({ glbKey: badKey })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when glbKey references a different worldId", async () => {
    const badKey = `worlds/${VALID_USER_ID}/wrong-world-id/world.glb`;

    const res = await POST(makeRequest(makeValidBody({ glbKey: badKey })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when glbKey does not start with 'worlds/'", async () => {
    const badKey = `../etc/passwd`;

    const res = await POST(makeRequest(makeValidBody({ glbKey: badKey })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when a media item key has a wrong user prefix", async () => {
    // The thumbnail key belongs to a different user.
    const badKey = `worlds/other-user/${VALID_WORLD_ID}/thumbnail.jpg`;

    const res = await POST(
      makeRequest(makeValidBody({
        media: [{ kind: "thumbnail" as const, key: badKey, sizeBytes: THUMBNAIL_SIZE }],
      }))
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

    const res = await POST(makeRequest(makeValidBody()));

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

    const res = await POST(makeRequest(makeValidBody()));

    expect(res.status).toBe(400);
    const body = await res.json();
    // The error message must mention size mismatch.
    expect(body.error).toMatch(/mismatch/i);
  });

  it("returns 400 when HEAD on thumbnail media item returns {exists: false}", async () => {
    mockHeadObject.mockImplementation(
      ({ bucket, objectKey }: { bucket: string; objectKey: string }) => {
        if (bucket === "glb" && objectKey === GLB_KEY) {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
        }
        // All media keys return not-found.
        return Promise.resolve({ exists: false, contentLength: undefined });
      }
    );

    const res = await POST(makeRequest(makeValidBody()));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/not found|did upload complete/i);
  });

  it("returns 400 when HEAD on thumbnail media item returns a size that mismatches sizeBytes", async () => {
    mockHeadObject.mockImplementation(
      ({ bucket, objectKey }: { bucket: string; objectKey: string }) => {
        if (bucket === "glb" && objectKey === GLB_KEY) {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
        }
        // Thumbnail exists but wrong size.
        return Promise.resolve({
          exists: true,
          contentLength: THUMBNAIL_SIZE + 1,
        });
      }
    );

    const res = await POST(makeRequest(makeValidBody()));

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
    const res = await POST(makeRequest(makeValidBody()));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      worldId: VALID_WORLD_ID,
      url: `/world/${VALID_WORLD_ID}`,
    });
  });

  it("invokes the transaction callback", async () => {
    await POST(makeRequest(makeValidBody()));

    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("inserts a row into worlds with the correct worldId, userId, title, and glbUrl", async () => {
    const expectedGlbUrl = `https://cdn.example.com/glb/${GLB_KEY}`;
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    await POST(makeRequest(makeValidBody()));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({
        id: VALID_WORLD_ID,
        userId: DB_USER_ID,
        title: makeValidBody().title,
        glbUrl: expectedGlbUrl,
        glbSizeBytes: GLB_SIZE,
      })
    );
  });

  it("inserts world_media rows as an array with the thumbnail at position 0", async () => {
    const expectedThumbUrl = `https://cdn.example.com/media/${THUMBNAIL_KEY}`;
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    await POST(makeRequest(makeValidBody()));

    // The implementation does a single batched insert with an array.
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      expect.arrayContaining([
        expect.objectContaining({
          worldId: VALID_WORLD_ID,
          type: "thumbnail",
          url: expectedThumbUrl,
          position: 0,
        }),
      ])
    );
  });

  it("sets users.tosAcceptedAt when it was previously null", async () => {
    // DB_USER_NO_TOS has tosAcceptedAt: null — should trigger the update.
    mockRequireActiveDbUser.mockResolvedValue(DB_USER_NO_TOS);

    await POST(makeRequest(makeValidBody()));

    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      users,
      expect.objectContaining({ tosAcceptedAt: expect.any(Date) })
    );
  });

  it("does NOT update users.tosAcceptedAt when it was already set", async () => {
    // DB_USER_WITH_TOS already has a tosAcceptedAt — no update should happen.
    mockRequireActiveDbUser.mockResolvedValue(DB_USER_WITH_TOS);

    await POST(makeRequest(makeValidBody()));

    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it("the worlds insert uses the glbUrl produced by publicUrlFor('glb', glbKey)", async () => {
    const EXPECTED_GLB_URL = "https://cdn.example.com/glb/world.glb";
    // Only return a distinct URL when called with ("glb", GLB_KEY).
    mockPublicUrlFor.mockImplementation((bucket: string, key: string) => {
      if (bucket === "glb" && key === GLB_KEY) return EXPECTED_GLB_URL;
      return `https://cdn.example.com/${bucket}/${key}`;
    });

    await POST(makeRequest(makeValidBody()));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worlds,
      expect.objectContaining({ glbUrl: EXPECTED_GLB_URL })
    );
  });

  it("the world_media insert uses publicUrlFor('media', thumbnailKey) for the thumbnail row", async () => {
    const EXPECTED_THUMB_URL = "https://cdn.example.com/media/thumb.jpg";
    mockPublicUrlFor.mockImplementation((bucket: string, key: string) => {
      if (bucket === "media" && key === THUMBNAIL_KEY) return EXPECTED_THUMB_URL;
      return `https://cdn.example.com/${bucket}/${key}`;
    });

    await POST(makeRequest(makeValidBody()));

    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      expect.arrayContaining([
        expect.objectContaining({ url: EXPECTED_THUMB_URL }),
      ])
    );
  });
});

// ---------------------------------------------------------------------------
// Block F — Media array cross-item constraints (Slice 2)
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Media array cross-item constraints", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
  });

  it("returns 400 when media array is empty (0 items)", async () => {
    const res = await POST(makeRequest(makeValidBody({ media: [] })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when media array has 7 items (exceeds max of 6)", async () => {
    const items: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
      { kind: "image", key: IMAGE_KEY_1, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_2, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_3, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_4, sizeBytes: IMAGE_SIZE },
      // 7th item — over the limit
      {
        kind: "image",
        key: `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/image5.jpg`,
        sizeBytes: IMAGE_SIZE,
      },
    ];
    const res = await POST(makeRequest(makeValidBody({ media: items })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when media array has no thumbnail (0 thumbnails)", async () => {
    const res = await POST(
      makeRequest(
        makeValidBody({
          media: [{ kind: "image", key: IMAGE_KEY_1, sizeBytes: IMAGE_SIZE }],
        })
      )
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/thumbnail/i);
  });

  it("returns 400 when media array has 2 thumbnails", async () => {
    const secondThumbKey = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/thumb2.jpg`;
    const res = await POST(
      makeRequest(
        makeValidBody({
          media: [
            { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
            { kind: "thumbnail", key: secondThumbKey, sizeBytes: THUMBNAIL_SIZE },
          ],
        })
      )
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/thumbnail/i);
  });

  it("returns 400 when media array has 2 videos", async () => {
    const secondVideoKey = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/preview2.mp4`;
    const res = await POST(
      makeRequest(
        makeValidBody({
          media: [
            { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
            { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
            { kind: "video", key: secondVideoKey, sizeBytes: VIDEO_SIZE },
          ],
        })
      )
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/video/i);
  });
});

// ---------------------------------------------------------------------------
// Block G — Multi-media success path (Slice 2)
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Multi-media success path", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
  });

  it("returns 201 for [thumbnail, video] and inserts both rows with correct types and positions", async () => {
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    const media: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
    ];

    const res = await POST(makeRequest(makeValidBody({ media })));

    expect(res.status).toBe(201);

    // The batched worldMedia insert must have received an array of 2 rows,
    // with thumbnail at position 0 and video at position 1.
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      [
        expect.objectContaining({ type: "thumbnail", position: 0 }),
        expect.objectContaining({ type: "video", position: 1 }),
      ]
    );
  });

  it("returns 201 for [thumbnail, video, image, image] and inserts 4 rows with positions 0–3", async () => {
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    const media: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
      { kind: "image", key: IMAGE_KEY_1, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_2, sizeBytes: IMAGE_SIZE },
    ];

    const res = await POST(makeRequest(makeValidBody({ media })));

    expect(res.status).toBe(201);

    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      [
        expect.objectContaining({ type: "thumbnail", position: 0 }),
        expect.objectContaining({ type: "video", position: 1 }),
        expect.objectContaining({ type: "image", position: 2 }),
        expect.objectContaining({ type: "image", position: 3 }),
      ]
    );
  });

  it("returns 201 for a maximum-size media array (6 items: thumbnail + video + 4 images)", async () => {
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    const media: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
      { kind: "image", key: IMAGE_KEY_1, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_2, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_3, sizeBytes: IMAGE_SIZE },
      { kind: "image", key: IMAGE_KEY_4, sizeBytes: IMAGE_SIZE },
    ];

    const res = await POST(makeRequest(makeValidBody({ media })));

    expect(res.status).toBe(201);

    expect(mockTxInsert).toHaveBeenCalledWith(
      worldMedia,
      expect.arrayContaining([
        expect.objectContaining({ type: "thumbnail", position: 0 }),
        expect.objectContaining({ type: "video", position: 1 }),
        expect.objectContaining({ type: "image", position: 2 }),
        expect.objectContaining({ type: "image", position: 3 }),
        expect.objectContaining({ type: "image", position: 4 }),
        expect.objectContaining({ type: "image", position: 5 }),
      ])
    );

    // Exactly 6 rows inserted.
    const worldMediaCall = mockTxInsert.mock.calls.find(
      ([table]: [unknown]) => table === worldMedia
    );
    expect(worldMediaCall).toBeDefined();
    expect((worldMediaCall![1] as unknown[]).length).toBe(6);
  });

  it("the worldMedia insert is ONE batched call (not N separate calls)", async () => {
    mockPublicUrlFor.mockImplementation(
      (bucket: string, key: string) => `https://cdn.example.com/${bucket}/${key}`
    );

    const media: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
      { kind: "image", key: IMAGE_KEY_1, sizeBytes: IMAGE_SIZE },
    ];

    await POST(makeRequest(makeValidBody({ media })));

    // Count how many times mockTxInsert was called with worldMedia as the table.
    const worldMediaCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === worldMedia
    );
    expect(worldMediaCalls).toHaveLength(1);

    // That single call must have received an array of 3 items, not a single object.
    const insertedValue = worldMediaCalls[0][1];
    expect(Array.isArray(insertedValue)).toBe(true);
    expect((insertedValue as unknown[]).length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Block H — Per-item HEAD and key-prefix failures (Slice 2)
// ---------------------------------------------------------------------------

describe("POST /api/worlds — Per-item HEAD failure and key prefix checks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
  });

  it("returns 400 when HEAD on the video succeeds but HEAD on an image returns {exists: false}", async () => {
    const media: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "video", key: VIDEO_KEY, sizeBytes: VIDEO_SIZE },
      { kind: "image", key: IMAGE_KEY_1, sizeBytes: IMAGE_SIZE },
    ];

    // GLB and thumbnail/video succeed; image fails.
    mockHeadObject.mockImplementation(
      ({ bucket, objectKey }: { bucket: string; objectKey: string }) => {
        if (bucket === "glb" && objectKey === GLB_KEY) {
          return Promise.resolve({ exists: true, contentLength: GLB_SIZE });
        }
        if (bucket === "media" && objectKey === THUMBNAIL_KEY) {
          return Promise.resolve({ exists: true, contentLength: THUMBNAIL_SIZE });
        }
        if (bucket === "media" && objectKey === VIDEO_KEY) {
          return Promise.resolve({ exists: true, contentLength: VIDEO_SIZE });
        }
        // IMAGE_KEY_1 not found
        return Promise.resolve({ exists: false, contentLength: undefined });
      }
    );

    const res = await POST(makeRequest(makeValidBody({ media })));

    expect(res.status).toBe(400);
    const body = await res.json();
    // Error must reference that a file was not found / upload incomplete.
    expect(body.error).toMatch(/not found|did upload complete/i);
  });

  it("returns 400 when one media item's key has a wrong user prefix", async () => {
    // Thumbnail has the correct prefix; image has a wrong user.
    const badImageKey = `worlds/wrong-user/${VALID_WORLD_ID}/image1.jpg`;
    const media: MediaItem[] = [
      { kind: "thumbnail", key: THUMBNAIL_KEY, sizeBytes: THUMBNAIL_SIZE },
      { kind: "image", key: badImageKey, sizeBytes: IMAGE_SIZE },
    ];

    const res = await POST(makeRequest(makeValidBody({ media })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// Block I — Tags (Slice 7.1)
//
// Tests for tag normalization, validation, and transactional persistence.
// Spec source: plan-slice-7-hazy-crystal.md §"Sub-slice 7.1 — Tags > Tests"
//
// Mock strategy:
//   - mockTxInsert spies on tx.insert(table).values(values) — asserted with
//     the imported `tags` / `worldTags` table refs as identity markers.
//   - mockTxSelect (new in this block) is the terminal call of the tag re-select
//     chain: tx.select({...}).from(tags).where(...) → returns tag rows.
//     Set it to return synthetic tag rows so tx.insert(worldTags) receives them.
// ---------------------------------------------------------------------------

describe("POST /api/worlds — tags", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
  });

  // -------------------------------------------------------------------------
  // I-1. 3 valid tags persist
  // -------------------------------------------------------------------------
  it("inserts 3 tag rows and 3 world_tag rows when tags: ['alpha', 'beta', 'gamma']", async () => {
    // The re-select returns synthetic tag rows — the route uses their IDs for
    // the world_tags insert.
    const tagRows = [
      { id: "tag-id-alpha", name: "alpha" },
      { id: "tag-id-beta",  name: "beta"  },
      { id: "tag-id-gamma", name: "gamma" },
    ];
    mockTxSelect.mockResolvedValue(tagRows);

    const res = await POST(makeRequest(makeValidBody({ tags: ["alpha", "beta", "gamma"] })));

    expect(res.status).toBe(201);

    // The tags insert must have been called with the 3 name objects.
    expect(mockTxInsert).toHaveBeenCalledWith(
      tags,
      [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }]
    );

    // The world_tags insert must have been called with exactly 3 rows.
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldTags,
      expect.arrayContaining([
        expect.objectContaining({ worldId: VALID_WORLD_ID, tagId: "tag-id-alpha" }),
        expect.objectContaining({ worldId: VALID_WORLD_ID, tagId: "tag-id-beta"  }),
        expect.objectContaining({ worldId: VALID_WORLD_ID, tagId: "tag-id-gamma" }),
      ])
    );
    const worldTagsCall = mockTxInsert.mock.calls.find(
      ([table]: [unknown]) => table === worldTags
    );
    expect((worldTagsCall![1] as unknown[]).length).toBe(3);
  });

  // -------------------------------------------------------------------------
  // I-2. Empty array allowed — no tag inserts, no world_tag inserts
  // -------------------------------------------------------------------------
  it("returns 201 and skips all tag inserts when tags: []", async () => {
    const res = await POST(makeRequest(makeValidBody({ tags: [] })));

    expect(res.status).toBe(201);

    const tagsInsertCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === tags
    );
    const worldTagsInsertCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === worldTags
    );

    expect(tagsInsertCalls).toHaveLength(0);
    expect(worldTagsInsertCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // I-3. Tags field omitted entirely — behaves like empty array
  // -------------------------------------------------------------------------
  it("returns 201 and skips all tag inserts when tags field is omitted", async () => {
    const { tags: _omit, ...bodyWithoutTags } = makeValidBody({ tags: [] });
    const res = await POST(makeRequest(bodyWithoutTags));

    expect(res.status).toBe(201);

    const tagsInsertCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === tags
    );
    const worldTagsInsertCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === worldTags
    );

    expect(tagsInsertCalls).toHaveLength(0);
    expect(worldTagsInsertCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // I-4. More than 5 tags → 400
  //
  // Note: Zod's .max(5) on the tags array fires at parse time (step 2) and
  // returns the generic "Invalid request body" error before the custom
  // normalization check in step 3 is reached. The 400 status is the contract;
  // the exact message is implementation detail.
  // -------------------------------------------------------------------------
  it("returns 400 when 6 tags are submitted", async () => {
    const sixTags = ["aaa", "bbb", "ccc", "ddd", "eee", "fff"];

    const res = await POST(makeRequest(makeValidBody({ tags: sixTags })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  // -------------------------------------------------------------------------
  // I-5. Mixed-case input is lowercased and trimmed before insert
  // -------------------------------------------------------------------------
  it("normalizes tags to lowercase + trimmed when input is ['Alpha', 'BETA', ' GamMa ']", async () => {
    const tagRows = [
      { id: "tag-id-alpha", name: "alpha" },
      { id: "tag-id-beta",  name: "beta"  },
      { id: "tag-id-gamma", name: "gamma" },
    ];
    mockTxSelect.mockResolvedValue(tagRows);

    const res = await POST(makeRequest(makeValidBody({ tags: ["Alpha", "BETA", " GamMa "] })));

    expect(res.status).toBe(201);

    // The tags insert must use the normalized (lowercased + trimmed) names.
    expect(mockTxInsert).toHaveBeenCalledWith(
      tags,
      [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }]
    );
  });

  // -------------------------------------------------------------------------
  // I-6. Duplicate tag names deduplicate to a single row
  // -------------------------------------------------------------------------
  it("deduplicates ['foo', 'FOO', '  foo  '] to a single tags insert and single world_tags row", async () => {
    const tagRows = [{ id: "tag-id-foo", name: "foo" }];
    mockTxSelect.mockResolvedValue(tagRows);

    const res = await POST(makeRequest(makeValidBody({ tags: ["foo", "FOO", "  foo  "] })));

    expect(res.status).toBe(201);

    // Tags insert: only one row.
    expect(mockTxInsert).toHaveBeenCalledWith(
      tags,
      [{ name: "foo" }]
    );

    // world_tags insert: only one row.
    const worldTagsCall = mockTxInsert.mock.calls.find(
      ([table]: [unknown]) => table === worldTags
    );
    expect(worldTagsCall).toBeDefined();
    expect((worldTagsCall![1] as unknown[]).length).toBe(1);
    expect(worldTagsCall![1]).toEqual([
      expect.objectContaining({ worldId: VALID_WORLD_ID, tagId: "tag-id-foo" }),
    ]);
  });

  // -------------------------------------------------------------------------
  // I-7. Tag exceeding 32 chars → 400
  // -------------------------------------------------------------------------
  it("returns 400 when a tag is 33 characters long", async () => {
    const tooLong = "a".repeat(33);

    const res = await POST(makeRequest(makeValidBody({ tags: [tooLong] })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  // -------------------------------------------------------------------------
  // I-8. Exactly 32 chars is allowed
  // -------------------------------------------------------------------------
  it("returns 201 when a tag is exactly 32 characters long", async () => {
    const exactly32 = "a".repeat(32);
    mockTxSelect.mockResolvedValue([{ id: "tag-id-long", name: exactly32 }]);

    const res = await POST(makeRequest(makeValidBody({ tags: [exactly32] })));

    expect(res.status).toBe(201);
  });

  // -------------------------------------------------------------------------
  // I-9. Whitespace-only and empty strings are stripped; effectively empty → 201
  // -------------------------------------------------------------------------
  it("returns 201 with no inserts when tags: ['   ', ''] (strips to empty after trim)", async () => {
    const res = await POST(makeRequest(makeValidBody({ tags: ["   ", ""] })));

    expect(res.status).toBe(201);

    const tagsInsertCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === tags
    );
    const worldTagsInsertCalls = mockTxInsert.mock.calls.filter(
      ([table]: [unknown]) => table === worldTags
    );

    expect(tagsInsertCalls).toHaveLength(0);
    expect(worldTagsInsertCalls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // I-10. Disallowed characters → 400
  // These tags fail the /^[a-z0-9][a-z0-9_-]*$/ regex after normalization.
  // -------------------------------------------------------------------------
  it("returns 400 when a tag contains a space (e.g. 'with space')", async () => {
    const res = await POST(makeRequest(makeValidBody({ tags: ["with space"] })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when a tag starts with '#' (hash not allowed)", async () => {
    const res = await POST(makeRequest(makeValidBody({ tags: ["#hash"] })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when a tag starts with '-' (leading punctuation rejected)", async () => {
    const res = await POST(makeRequest(makeValidBody({ tags: ["-leading"] })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when a tag contains an emoji character (e.g. 'emoji😀')", async () => {
    const res = await POST(makeRequest(makeValidBody({ tags: ["emoji😀"] })));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("returns 201 for 'UPPER' because it normalizes to 'upper' which is valid", async () => {
    // After lowercasing, "UPPER" becomes "upper" — passes the regex.
    mockTxSelect.mockResolvedValue([{ id: "tag-id-upper", name: "upper" }]);

    const res = await POST(makeRequest(makeValidBody({ tags: ["UPPER"] })));

    expect(res.status).toBe(201);

    // The tags insert sees the lowercased value.
    expect(mockTxInsert).toHaveBeenCalledWith(
      tags,
      [{ name: "upper" }]
    );
  });

  // -------------------------------------------------------------------------
  // I-11. Existing tag reused — world_tags insert uses the re-selected IDs
  // -------------------------------------------------------------------------
  it("uses IDs from the re-select for world_tags even when the tags insert was a no-op (conflict)", async () => {
    // Simulate: the tags.name already exists in the DB. The onConflictDoNothing
    // returns nothing, but the re-select returns the existing row with its real ID.
    const existingTagRow = { id: "existing-tag-uuid-001", name: "rust" };
    mockTxSelect.mockResolvedValue([existingTagRow]);

    const res = await POST(makeRequest(makeValidBody({ tags: ["rust"] })));

    expect(res.status).toBe(201);

    // world_tags insert must reference the pre-existing tag's ID, not a new one.
    expect(mockTxInsert).toHaveBeenCalledWith(
      worldTags,
      [expect.objectContaining({ worldId: VALID_WORLD_ID, tagId: "existing-tag-uuid-001" })]
    );
  });
});

// ---------------------------------------------------------------------------
// Block J — notifyMany() integration (sub-slice 7.5)
//
// After the world-creation transaction commits, the route queries the author's
// followers and calls notifyMany() to fan out new-world notifications.
// notifyMany() is mocked at the module level so tests see the raw call shape
// without a real DB insert or notifications table.
//
// The followers query uses db.select({ followerId }).from(follows).where(...)
// without a .limit() call. mockDbSelectWhere controls its return value — the
// @/db mock wraps the .where() result as a thenable so `await` resolves it.
// ---------------------------------------------------------------------------

describe("POST /api/worlds — notifyMany integration", () => {
  // Follower DB ids
  const FOLLOWER_1 = "db-uuid-follower-001";
  const FOLLOWER_2 = "db-uuid-follower-002";
  const FOLLOWER_3 = "db-uuid-follower-003";

  beforeEach(() => {
    vi.resetAllMocks();
    setupHappyPath();
  });

  it("calls notifyMany with N entries when the author has N followers", async () => {
    // Seed 3 follower rows returned by the fanout query.
    mockDbSelectWhere.mockResolvedValue([
      { followerId: FOLLOWER_1 },
      { followerId: FOLLOWER_2 },
      { followerId: FOLLOWER_3 },
    ]);

    const res = await POST(makeRequest(makeValidBody()));

    expect(res.status).toBe(201);
    expect(mockNotifyMany).toHaveBeenCalledOnce();
    expect(mockNotifyMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: "new_world",
          userId: FOLLOWER_1,
          actorId: DB_USER_ID,
          worldId: VALID_WORLD_ID,
        }),
        expect.objectContaining({
          type: "new_world",
          userId: FOLLOWER_2,
          actorId: DB_USER_ID,
          worldId: VALID_WORLD_ID,
        }),
        expect.objectContaining({
          type: "new_world",
          userId: FOLLOWER_3,
          actorId: DB_USER_ID,
          worldId: VALID_WORLD_ID,
        }),
      ])
    );
    // Exactly 3 entries — not more, not fewer.
    const [callArg] = mockNotifyMany.mock.calls[0];
    expect((callArg as unknown[]).length).toBe(3);
  });

  it("does NOT call notifyMany when the author has 0 followers (route guards with if (followerRows.length > 0))", async () => {
    // Default from setupHappyPath: mockDbSelectWhere returns [].
    const res = await POST(makeRequest(makeValidBody()));

    expect(res.status).toBe(201);
    expect(mockNotifyMany).not.toHaveBeenCalled();
  });

  it("still returns 201 when notifyMany throws (notification failure never breaks the world creation)", async () => {
    // Locked decision (PROJECT.md §7): notification failure must NEVER break
    // the parent action. The route wraps the notifyMany call in try/catch.
    mockDbSelectWhere.mockResolvedValue([
      { followerId: FOLLOWER_1 },
    ]);
    mockNotifyMany.mockRejectedValue(new Error("notifyMany DB exploded"));

    const res = await POST(makeRequest(makeValidBody()));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ worldId: VALID_WORLD_ID });
  });
});
