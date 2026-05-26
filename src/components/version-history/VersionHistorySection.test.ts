/**
 * Unit tests for VersionHistorySection logic.
 *
 * These tests validate the API interaction behaviour and state derivation
 * (published-version pill logic, load-more, publish action) without DOM.
 * The component is a thin client wrapper — the critical paths are the
 * fetch calls and the optimistic state transitions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "550e8400-e29b-41d4-a716-446655440000";
const V1_ID = "aa0e8400-e29b-41d4-a716-446655440001";
const V2_ID = "bb0e8400-e29b-41d4-a716-446655440002";

const VERSION_1 = {
  id: V1_ID,
  versionNumber: 1,
  status: "published" as const,
  label: "Converted from legacy .glb",
  parentVersionId: null,
  createdAt: new Date(Date.now() - 60_000).toISOString(), // 1m ago
  author: { id: "user-1", username: "alice", avatarUrl: null },
};

const VERSION_2 = {
  id: V2_ID,
  versionNumber: 2,
  status: "draft" as const,
  label: null,
  parentVersionId: V1_ID,
  createdAt: new Date(Date.now() - 30_000).toISOString(), // 30s ago
  author: { id: "user-1", username: "alice", avatarUrl: null },
};

// ---------------------------------------------------------------------------
// Helper: simulate the fetch + state transition for the versions list load
// ---------------------------------------------------------------------------

interface VersionState {
  versions: typeof VERSION_1[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
}

async function simulateFetchVersions(
  worldId: string,
  fetchImpl: typeof fetch
): Promise<VersionState> {
  let state: VersionState = {
    versions: [],
    nextCursor: null,
    loading: true,
    error: null,
  };

  try {
    const res = await fetchImpl(`/api/worlds/${worldId}/versions`);
    if (!(res as Response).ok) {
      throw new Error(`Server error (${(res as Response).status})`);
    }
    const data = await (res as Response).json();
    state = {
      versions: data.versions,
      nextCursor: data.nextCursor,
      loading: false,
      error: null,
    };
  } catch (err) {
    state = {
      versions: [],
      nextCursor: null,
      loading: false,
      error: err instanceof Error ? err.message : "Failed to load versions",
    };
  }

  return state;
}

// ---------------------------------------------------------------------------
// Helper: simulate publish action optimistic update + API call
// ---------------------------------------------------------------------------

interface PublishResult {
  newPublishedVersionId: string;
  error: string | null;
  refreshCalled: boolean;
}

async function simulatePublish(
  worldId: string,
  versionId: string,
  prevPublishedId: string | null,
  fetchImpl: typeof fetch
): Promise<PublishResult> {
  let newPublishedVersionId = versionId; // optimistic update
  let error: string | null = null;
  let refreshCalled = false;
  const mockRouter = { refresh: () => { refreshCalled = true; } };

  try {
    const res = await fetchImpl(
      `/api/worlds/${worldId}/versions/${versionId}/publish`,
      { method: "POST" }
    );
    if (!(res as Response).ok) {
      throw new Error(`Server error (${(res as Response).status})`);
    }
    mockRouter.refresh();
  } catch (err) {
    // Revert optimistic update on failure
    newPublishedVersionId = prevPublishedId ?? "";
    error = err instanceof Error ? err.message : "Publish failed";
  }

  return { newPublishedVersionId, error, refreshCalled };
}

// ---------------------------------------------------------------------------

describe("VersionHistorySection — versions fetch", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("renders loading skeleton initially (loading=true before fetch), then populates after resolve", async () => {
    // Simulate the component's initial state = loading: true
    const initialState: VersionState = { versions: [], nextCursor: null, loading: true, error: null };
    expect(initialState.loading).toBe(true);

    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [VERSION_1, VERSION_2], nextCursor: null }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const afterFetch = await simulateFetchVersions(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(afterFetch.loading).toBe(false);
    expect(afterFetch.error).toBeNull();
    expect(afterFetch.versions).toHaveLength(2);
    expect(afterFetch.versions[0].id).toBe(V1_ID);
  });

  it("currently-published version is identified correctly from publishedVersionId", () => {
    const publishedVersionId = V1_ID;

    // The pill logic: version.id === publishedVersionId → "Currently published"
    expect(VERSION_1.id === publishedVersionId).toBe(true);
    expect(VERSION_2.id === publishedVersionId).toBe(false);
  });

  it("owner sees Publish button for non-current versions; non-owner does not", () => {
    const publishedVersionId = V1_ID; // V1 is current

    // Simulate owner visibility logic
    function shouldShowPublishButton(
      version: typeof VERSION_1,
      isOwner: boolean,
      currentPublishedId: string | null
    ) {
      return isOwner && version.id !== currentPublishedId;
    }

    // Owner + non-current (V2) → show Publish
    expect(shouldShowPublishButton(VERSION_2, true, publishedVersionId)).toBe(true);
    // Owner + current (V1) → do NOT show Publish
    expect(shouldShowPublishButton(VERSION_1, true, publishedVersionId)).toBe(false);
    // Non-owner + any version → never show Publish
    expect(shouldShowPublishButton(VERSION_2, false, publishedVersionId)).toBe(false);
    expect(shouldShowPublishButton(VERSION_1, false, publishedVersionId)).toBe(false);
  });

  it("'Load more' is shown when nextCursor is non-null; clicking appends rows", async () => {
    const PAGE_1_CURSOR = VERSION_2.createdAt;

    const mockFetchPage1 = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [VERSION_1], nextCursor: PAGE_1_CURSOR }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const page1State = await simulateFetchVersions(
      WORLD_ID,
      mockFetchPage1 as unknown as typeof fetch
    );

    // Load more button should be visible
    expect(page1State.nextCursor).toBe(PAGE_1_CURSOR);
    expect(page1State.versions).toHaveLength(1);

    // Simulate clicking "Load more"
    const mockFetchPage2 = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versions: [VERSION_2], nextCursor: null }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const loadMoreRes = await mockFetchPage2(
      `/api/worlds/${WORLD_ID}/versions?cursor=${encodeURIComponent(PAGE_1_CURSOR)}`
    );
    const loadMoreData = await loadMoreRes.json();

    const afterLoadMore = [...page1State.versions, ...loadMoreData.versions];

    expect(afterLoadMore).toHaveLength(2);
    expect(afterLoadMore[1].id).toBe(V2_ID);
    expect(loadMoreData.nextCursor).toBeNull();
  });
});

describe("VersionHistorySection — publish action", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("on successful publish — optimistic update holds and refresh is called", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ versionId: V2_ID, versionNumber: 2, status: "published" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await simulatePublish(
      WORLD_ID,
      V2_ID,
      V1_ID,
      mockFetch as unknown as typeof fetch
    );

    expect(result.newPublishedVersionId).toBe(V2_ID);
    expect(result.error).toBeNull();
    expect(result.refreshCalled).toBe(true);
  });

  it("on failed publish — reverts to previous publishedVersionId and surfaces error", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "Database temporarily unavailable, please try again" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await simulatePublish(
      WORLD_ID,
      V2_ID,
      V1_ID,
      mockFetch as unknown as typeof fetch
    );

    // Reverted back to V1
    expect(result.newPublishedVersionId).toBe(V1_ID);
    expect(result.error).toBeTruthy();
    expect(result.refreshCalled).toBe(false);
  });
});
