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

  // currentUser() is called by getOrCreateDbUser inside POST /api/worlds.
  mockCurrentUser.mockResolvedValue({
    id: VALID_USER_ID,
    username: "alice",
    emailAddresses: [{ emailAddress: "alice@example.com" }],
    imageUrl: null,
  });

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

    const res = await POST(makeRequest(makeValidBody()));

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
    mockUserLookup.mockResolvedValue([DB_USER_NO_TOS]);

    await POST(makeRequest(makeValidBody()));

    expect(mockTxUpdate).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      users,
      expect.objectContaining({ tosAcceptedAt: expect.any(Date) })
    );
  });

  it("does NOT update users.tosAcceptedAt when it was already set", async () => {
    // DB_USER_WITH_TOS already has a tosAcceptedAt — no update should happen.
    mockUserLookup.mockResolvedValue([DB_USER_WITH_TOS]);

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
