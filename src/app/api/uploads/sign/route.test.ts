import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock hoisting
// All mocks must be hoisted so they are registered before any module import
// resolves. vi.hoisted() runs at the top of the module scope, before imports.
// ---------------------------------------------------------------------------

const { mockAuth, mockGetPresignedPutUrl, mockBuildGlbKey, mockBuildThumbnailKey } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    // External boundary: real getPresignedPutUrl would call AWS SDK + Cloudflare R2.
    // We mock it to return a predictable URL without any network calls.
    mockGetPresignedPutUrl: vi.fn(),
    // buildGlbKey / buildThumbnailKey are pure key-builders; mocked so the test
    // controls objectKey values and we can assert the route passes them correctly
    // to getPresignedPutUrl without coupling to R2's key-generation logic.
    mockBuildGlbKey: vi.fn(),
    mockBuildThumbnailKey: vi.fn(),
  }));

// Mock @clerk/nextjs/server — external boundary; real Clerk calls require a
// valid Clerk environment which is unavailable in the test runner.
vi.mock("@clerk/nextjs/server", () => ({
  auth: mockAuth,
}));

// Mock @/lib/r2 — external boundary (AWS SDK + Cloudflare R2 credentials are
// not available in the test environment, and we don't want real network calls).
vi.mock("@/lib/r2", () => ({
  getPresignedPutUrl: mockGetPresignedPutUrl,
  buildGlbKey: mockBuildGlbKey,
  buildThumbnailKey: mockBuildThumbnailKey,
}));

// Import the handler AFTER mocks are registered.
import { POST } from "./route";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_USER_ID = "user_clerk_abc123";
const VALID_WORLD_ID = "550e8400-e29b-41d4-a716-446655440000"; // UUID v4

const PRESIGNED_URL = "https://r2.example.com/signed-put?token=abc";

function makeRequest(body: unknown, rawBody?: string): Request {
  return new Request("http://localhost/api/uploads/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody !== undefined ? rawBody : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// describe A — Auth
// ---------------------------------------------------------------------------

describe("POST /api/uploads/sign — Auth", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 with {error: 'Unauthorized'} when auth() returns {userId: null}", async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });
});

// ---------------------------------------------------------------------------
// describe B — Body validation
// ---------------------------------------------------------------------------

describe("POST /api/uploads/sign — Body validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Authenticated for all body-validation tests — auth failures are Block A.
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
  });

  it("returns 400 when body is invalid JSON", async () => {
    const res = await POST(
      makeRequest(null, "not-valid-json{{{{")
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when kind is missing", async () => {
    const res = await POST(
      makeRequest({
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when kind is an unknown value", async () => {
    const res = await POST(
      makeRequest({
        kind: "audio",
        worldId: VALID_WORLD_ID,
        contentType: "audio/mpeg",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when worldId is missing", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when worldId is not a UUID", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: "not-a-uuid",
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when contentType is an empty string", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when sizeBytes is 0", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 0,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when sizeBytes is negative", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: -100,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 400 when sizeBytes is a float", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 1.5,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// describe C — Slice 2 kinds blocked in Slice 1
// ---------------------------------------------------------------------------

describe("POST /api/uploads/sign — Slice 2 kinds (blocked in Slice 1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
  });

  it("returns 400 with a Slice 2 error message when kind is 'image'", async () => {
    const res = await POST(
      makeRequest({
        kind: "image",
        worldId: VALID_WORLD_ID,
        contentType: "image/jpeg",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    // The error message must clearly indicate this is blocked until Slice 2.
    expect(body.error).toMatch(/slice 2/i);
  });

  it("returns 400 with a Slice 2 error message when kind is 'video'", async () => {
    const res = await POST(
      makeRequest({
        kind: "video",
        worldId: VALID_WORLD_ID,
        contentType: "video/mp4",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/slice 2/i);
  });
});

// ---------------------------------------------------------------------------
// describe D — Per-kind content type validation
// ---------------------------------------------------------------------------

describe("POST /api/uploads/sign — Per-kind content type validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
    mockGetPresignedPutUrl.mockResolvedValue(PRESIGNED_URL);
    mockBuildGlbKey.mockImplementation(
      (userId: string, worldId: string) => `worlds/${userId}/${worldId}/world.glb`
    );
    mockBuildThumbnailKey.mockImplementation(
      (userId: string, worldId: string, ext: string) =>
        `worlds/${userId}/${worldId}/thumbnail.${ext}`
    );
  });

  it.each([
    "model/gltf-binary",
    "model/gltf+json",
    "application/octet-stream",
  ])(
    "glb accepts content type '%s'",
    async (contentType) => {
      const res = await POST(
        makeRequest({
          kind: "glb",
          worldId: VALID_WORLD_ID,
          contentType,
          sizeBytes: 1024,
        })
      );

      expect(res.status).toBe(200);
    }
  );

  it.each(["image/jpeg", "text/plain", "application/json"])(
    "glb rejects content type '%s'",
    async (contentType) => {
      const res = await POST(
        makeRequest({
          kind: "glb",
          worldId: VALID_WORLD_ID,
          contentType,
          sizeBytes: 1024,
        })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
    }
  );

  it.each(["image/jpeg", "image/png", "image/webp"])(
    "thumbnail accepts content type '%s'",
    async (contentType) => {
      const res = await POST(
        makeRequest({
          kind: "thumbnail",
          worldId: VALID_WORLD_ID,
          contentType,
          sizeBytes: 1024,
        })
      );

      expect(res.status).toBe(200);
    }
  );

  it.each(["model/gltf-binary", "image/gif", "image/jpg"])(
    "thumbnail rejects content type '%s'",
    async (contentType) => {
      const res = await POST(
        makeRequest({
          kind: "thumbnail",
          worldId: VALID_WORLD_ID,
          contentType,
          sizeBytes: 1024,
        })
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(typeof body.error).toBe("string");
    }
  );

  it("thumbnail rejects application/octet-stream", async () => {
    const res = await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType: "application/octet-stream",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// describe E — Per-kind size cap
// ---------------------------------------------------------------------------

describe("POST /api/uploads/sign — Per-kind size cap", () => {
  const GLB_MAX = 52428800; // 50 * 1024 * 1024
  const THUMBNAIL_MAX = 2097152; // 2 * 1024 * 1024

  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
    mockGetPresignedPutUrl.mockResolvedValue(PRESIGNED_URL);
    mockBuildGlbKey.mockImplementation(
      (userId: string, worldId: string) => `worlds/${userId}/${worldId}/world.glb`
    );
    mockBuildThumbnailKey.mockImplementation(
      (userId: string, worldId: string, ext: string) =>
        `worlds/${userId}/${worldId}/thumbnail.${ext}`
    );
  });

  it("glb accepts sizeBytes equal to the 50 MB cap (52428800)", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: GLB_MAX,
      })
    );

    expect(res.status).toBe(200);
  });

  it("glb rejects sizeBytes one byte over the 50 MB cap (52428801)", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: GLB_MAX + 1,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("thumbnail accepts sizeBytes equal to the 2 MB cap (2097152)", async () => {
    const res = await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType: "image/jpeg",
        sizeBytes: THUMBNAIL_MAX,
      })
    );

    expect(res.status).toBe(200);
  });

  it("thumbnail rejects sizeBytes one byte over the 2 MB cap (2097153)", async () => {
    const res = await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType: "image/jpeg",
        sizeBytes: THUMBNAIL_MAX + 1,
      })
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// describe F — Successful sign (the contract)
// ---------------------------------------------------------------------------

describe("POST /api/uploads/sign — Successful sign", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.mockResolvedValue({ userId: VALID_USER_ID });
    mockGetPresignedPutUrl.mockResolvedValue(PRESIGNED_URL);
    mockBuildGlbKey.mockImplementation(
      (userId: string, worldId: string) => `worlds/${userId}/${worldId}/world.glb`
    );
    mockBuildThumbnailKey.mockImplementation(
      (userId: string, worldId: string, ext: string) =>
        `worlds/${userId}/${worldId}/thumbnail.${ext}`
    );
  });

  it("valid glb request returns 200 with {uploadUrl, objectKey}", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.uploadUrl).toBe("string");
    expect(typeof body.objectKey).toBe("string");
  });

  it("valid glb request returns objectKey = worlds/{userId}/{worldId}/world.glb", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    const body = await res.json();
    expect(body.objectKey).toBe(
      `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/world.glb`
    );
  });

  it("valid thumbnail request with image/jpeg returns objectKey containing thumbnail.jpg", async () => {
    const res = await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType: "image/jpeg",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.objectKey).toBe(
      `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/thumbnail.jpg`
    );
  });

  it("valid thumbnail request with image/png returns objectKey ending in .png", async () => {
    const res = await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType: "image/png",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.objectKey).toMatch(/\.png$/);
  });

  it("valid thumbnail request with image/webp returns objectKey ending in .webp", async () => {
    const res = await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType: "image/webp",
        sizeBytes: 1024,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.objectKey).toMatch(/\.webp$/);
  });

  it("calls getPresignedPutUrl with the correct {bucket, objectKey, contentType, contentLength} for a glb request", async () => {
    const contentType = "model/gltf-binary";
    const sizeBytes = 8192;
    const expectedObjectKey = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/world.glb`;

    await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType,
        sizeBytes,
      })
    );

    expect(mockGetPresignedPutUrl).toHaveBeenCalledOnce();
    expect(mockGetPresignedPutUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "glb",
        objectKey: expectedObjectKey,
        contentType,
        contentLength: sizeBytes,
      })
    );
  });

  it("calls getPresignedPutUrl with bucket='media' for a thumbnail request", async () => {
    const contentType = "image/jpeg";
    const sizeBytes = 512;
    const expectedObjectKey = `worlds/${VALID_USER_ID}/${VALID_WORLD_ID}/thumbnail.jpg`;

    await POST(
      makeRequest({
        kind: "thumbnail",
        worldId: VALID_WORLD_ID,
        contentType,
        sizeBytes,
      })
    );

    expect(mockGetPresignedPutUrl).toHaveBeenCalledOnce();
    expect(mockGetPresignedPutUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "media",
        objectKey: expectedObjectKey,
        contentType,
        contentLength: sizeBytes,
      })
    );
  });

  it("returns the uploadUrl produced by getPresignedPutUrl in the response", async () => {
    const res = await POST(
      makeRequest({
        kind: "glb",
        worldId: VALID_WORLD_ID,
        contentType: "model/gltf-binary",
        sizeBytes: 1024,
      })
    );

    const body = await res.json();
    expect(body.uploadUrl).toBe(PRESIGNED_URL);
  });
});
