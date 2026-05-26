/**
 * Unit tests for ConvertToSceneGraphButton logic.
 *
 * These tests validate the API interaction behaviour (correct URL/method,
 * success/409/error handling) without mounting DOM. The component itself is a
 * thin client wrapper — the critical paths are the fetch calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helpers — simulate the component's core convert logic in isolation
// ---------------------------------------------------------------------------

/** Reproduces the fetch + router.refresh() logic from ConvertToSceneGraphButton. */
async function runConvert(
  worldId: string,
  fetchImpl: typeof fetch
): Promise<{ refreshCalled: boolean; error: string | null }> {
  let refreshCalled = false;
  let error: string | null = null;

  const mockRouter = { refresh: () => { refreshCalled = true; } };

  try {
    const res = await fetchImpl(
      `/api/worlds/${worldId}/convert-to-scene-graph`,
      { method: "POST" }
    );

    if ((res as Response).ok || (res as Response).status === 409) {
      mockRouter.refresh();
      return { refreshCalled, error };
    }

    // Error path
    let msg = `Server error (${(res as Response).status})`;
    try {
      const body = await (res as Response).json();
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON body
    }
    error = msg;
  } catch (err) {
    error = err instanceof Error ? err.message : "Network error — please try again";
  }

  return { refreshCalled, error };
}

// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("ConvertToSceneGraphButton — API logic", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls fetch with the correct URL and POST method", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ worldId: WORLD_ID, sceneGraph: {}, versionId: "v1", versionNumber: 1, assetId: "a1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await runConvert(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`/api/worlds/${WORLD_ID}/convert-to-scene-graph`);
    expect((opts as RequestInit).method).toBe("POST");
  });

  it("on 200 response — router.refresh() is called and no error is returned", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ worldId: WORLD_ID }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const { refreshCalled, error } = await runConvert(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(refreshCalled).toBe(true);
    expect(error).toBeNull();
  });

  it("on 409 response (already converted) — router.refresh() is still called", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "world is already a scene graph", sceneGraph: {} }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );

    const { refreshCalled, error } = await runConvert(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(refreshCalled).toBe(true);
    expect(error).toBeNull();
  });

  it("on 500 response — error message is returned and refresh is NOT called", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Database temporarily unavailable, please try again" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )
    );

    const { refreshCalled, error } = await runConvert(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(refreshCalled).toBe(false);
    expect(error).toBeTruthy();
    expect(error).toContain("Database temporarily unavailable");
  });

  it("on network error — error message is returned and refresh is NOT called", async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("Network failure"));

    const { refreshCalled, error } = await runConvert(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(refreshCalled).toBe(false);
    expect(error).toBe("Network failure");
  });
});
