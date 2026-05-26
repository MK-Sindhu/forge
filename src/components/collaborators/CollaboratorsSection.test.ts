/**
 * Unit tests for CollaboratorsSection fetch + action logic.
 *
 * CollaboratorsSection is a client component with three logical seams:
 *   1. fetchCollaborators — GET /api/worlds/{id}/collaborators on mount
 *   2. handleRemove — DELETE /api/worlds/{id}/collaborators/{userId} + local splice
 *   3. handleLeave — same DELETE route, but the current user removes themselves
 *      → triggers router.push("/world/{worldId}")
 *
 * Why not mount with @testing-library/react?
 *   The global vitest environment is "node" (no DOM APIs). Following the project
 *   pattern in ConvertToSceneGraphButton.test.ts, MobileJoysticks.test.ts, and
 *   EnterWorldOverlay.test.ts, we reproduce the handler bodies as standalone
 *   async functions and drive them with mocked fetch and router stubs. The tests
 *   cover the observable contract (correct URLs, correct state transitions,
 *   correct routing) without needing a React renderer.
 *
 * Mocks:
 *   - global fetch: vi.fn() passed directly to the helpers (no module-level mock
 *     needed because the helpers accept fetch as a parameter)
 *   - window.confirm: vi.fn() — guard for destructive Remove / Leave actions
 *   - mockPush: vi.fn() — router.push spy for the Leave action
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Types — mirror component internals
// ---------------------------------------------------------------------------

interface CollaboratorRow {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: string;
  addedAt: string;
  addedBy: { id: string; username: string } | null;
}

interface OwnerRow {
  id: string;
  username: string;
  avatarUrl: string | null;
}

interface CollaboratorsResponse {
  owner: OwnerRow;
  collaborators: CollaboratorRow[];
}

// ---------------------------------------------------------------------------
// Logic helpers — reproduce the async function bodies from CollaboratorsSection.tsx
// without any React state. We thread the I/O boundaries (fetch, confirm, push)
// as explicit parameters so tests can control and observe them cleanly.
// ---------------------------------------------------------------------------

/** Reproduces fetchCollaborators from CollaboratorsSection. */
async function runFetch(
  worldId: string,
  fetchImpl: typeof fetch
): Promise<{ data: CollaboratorsResponse | null; error: string | null }> {
  let data: CollaboratorsResponse | null = null;
  let error: string | null = null;
  try {
    const res = await fetchImpl(`/api/worlds/${worldId}/collaborators`);
    if (!res.ok) throw new Error(`Server error (${res.status})`);
    data = (await res.json()) as CollaboratorsResponse;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load collaborators";
  }
  return { data, error };
}

/** Reproduces handleRemove from CollaboratorsSection. */
async function runRemove(opts: {
  worldId: string;
  collab: CollaboratorRow;
  currentUserId: string | null;
  fetchImpl: typeof fetch;
  confirmImpl: (msg: string) => boolean;
  pushImpl: (url: string) => void;
}): Promise<{
  pushed: boolean;
  removedId: string | null;
  actionError: string | null;
}> {
  const { worldId, collab, currentUserId, fetchImpl, confirmImpl, pushImpl } = opts;

  const isSelf = collab.id === currentUserId;
  const confirmed = confirmImpl(
    isSelf
      ? "Stop collaborating on this world?"
      : `Remove @${collab.username} as a collaborator?`
  );

  if (!confirmed) return { pushed: false, removedId: null, actionError: null };

  let pushed = false;
  let removedId: string | null = null;
  let actionError: string | null = null;

  try {
    const res = await fetchImpl(
      `/api/worlds/${worldId}/collaborators/${collab.id}`,
      { method: "DELETE" }
    );
    if (!res.ok) throw new Error(`Server error (${res.status})`);

    if (isSelf) {
      pushImpl(`/world/${worldId}`);
      pushed = true;
    } else {
      removedId = collab.id;
    }
  } catch (err) {
    actionError = err instanceof Error ? err.message : "Couldn't remove collaborator";
  }

  return { pushed, removedId, actionError };
}

// ---------------------------------------------------------------------------
// Visibility helpers — reproduce the JSX conditional logic for button labels
// without rendering. These are pure functions of the component's props/state.
// ---------------------------------------------------------------------------

/**
 * Mirrors: {(isOwner || isSelf) && <button>…</button>}
 * Returns whether the Remove/Leave button is shown for a given collab row.
 */
function canShowActionButton(
  isOwner: boolean,
  currentUserId: string | null,
  collabId: string
): boolean {
  const isSelf = collabId === currentUserId;
  return isOwner || isSelf;
}

/**
 * Mirrors: {isSelf ? "Leave" : "Remove"}
 * Returns the button label for a given row.
 */
function actionButtonLabel(
  currentUserId: string | null,
  collabId: string
): "Leave" | "Remove" {
  return collabId === currentUserId ? "Leave" : "Remove";
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "world-uuid-1111-1111-1111-111111111111";
const OWNER_ID = "owner-uuid-2222-2222-2222-222222222222";
const COLLAB_ID = "collab-uuid-3333-3333-3333-333333333333";

const ownerRow: OwnerRow = {
  id: OWNER_ID,
  username: "worldowner",
  avatarUrl: null,
};

const collabRow: CollaboratorRow = {
  id: COLLAB_ID,
  username: "aliceeditor",
  avatarUrl: null,
  role: "editor",
  addedAt: new Date().toISOString(),
  addedBy: { id: OWNER_ID, username: "worldowner" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CollaboratorsSection — initial fetch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fetches from the correct URL on mount", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ owner: ownerRow, collaborators: [collabRow] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await runFetch(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toBe(`/api/worlds/${WORLD_ID}/collaborators`);
  });

  it("returns parsed owner + collaborators on a 200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ owner: ownerRow, collaborators: [collabRow] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const { data, error } = await runFetch(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(error).toBeNull();
    expect(data?.owner.id).toBe(OWNER_ID);
    expect(data?.collaborators).toHaveLength(1);
    expect(data?.collaborators[0].id).toBe(COLLAB_ID);
  });

  it("returns an error message on a non-ok response (e.g. 500)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const { data, error } = await runFetch(WORLD_ID, mockFetch as unknown as typeof fetch);

    expect(data).toBeNull();
    expect(error).toContain("500");
  });
});

describe("CollaboratorsSection — button visibility logic", () => {
  it("owner sees action button on every collaborator row", () => {
    const isOwner = true;
    const currentUserId = OWNER_ID;

    // Owner's own row is never in the collaborators list (the owner row is
    // rendered separately with no Remove button). For each collaborator row:
    expect(canShowActionButton(isOwner, currentUserId, COLLAB_ID)).toBe(true);
  });

  it("non-owner does NOT see action button on rows that belong to others", () => {
    const isOwner = false;
    const currentUserId = "some-other-user-id";

    expect(canShowActionButton(isOwner, currentUserId, COLLAB_ID)).toBe(false);
  });

  it("collaborator sees their own Leave button on their own row", () => {
    const isOwner = false;
    const currentUserId = COLLAB_ID; // viewing as the collaborator themselves

    expect(canShowActionButton(isOwner, currentUserId, COLLAB_ID)).toBe(true);
    expect(actionButtonLabel(currentUserId, COLLAB_ID)).toBe("Leave");
  });

  it("owner sees 'Remove' label (not 'Leave') on rows that are not themselves", () => {
    const currentUserId = OWNER_ID; // the owner viewing a collab's row

    expect(actionButtonLabel(currentUserId, COLLAB_ID)).toBe("Remove");
  });
});

describe("CollaboratorsSection — Remove action (owner removes collaborator)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls DELETE /api/worlds/{worldId}/collaborators/{userId} when confirmed", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ removed: true, worldId: WORLD_ID, userId: COLLAB_ID }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const mockConfirm = vi.fn().mockReturnValue(true);
    const mockPush = vi.fn();

    await runRemove({
      worldId: WORLD_ID,
      collab: collabRow,
      currentUserId: OWNER_ID,
      fetchImpl: mockFetch as unknown as typeof fetch,
      confirmImpl: mockConfirm,
      pushImpl: mockPush,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/worlds/${WORLD_ID}/collaborators/${COLLAB_ID}`);
    expect(opts.method).toBe("DELETE");
  });

  it("does NOT call fetch when the user dismisses the confirmation dialog", async () => {
    const mockFetch = vi.fn();
    const mockConfirm = vi.fn().mockReturnValue(false);
    const mockPush = vi.fn();

    const result = await runRemove({
      worldId: WORLD_ID,
      collab: collabRow,
      currentUserId: OWNER_ID,
      fetchImpl: mockFetch as unknown as typeof fetch,
      confirmImpl: mockConfirm,
      pushImpl: mockPush,
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.pushed).toBe(false);
    expect(result.removedId).toBeNull();
  });

  it("returns removedId equal to collab.id on a successful 200 remove", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ removed: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const mockConfirm = vi.fn().mockReturnValue(true);
    const mockPush = vi.fn();

    const { removedId, pushed, actionError } = await runRemove({
      worldId: WORLD_ID,
      collab: collabRow,
      currentUserId: OWNER_ID,
      fetchImpl: mockFetch as unknown as typeof fetch,
      confirmImpl: mockConfirm,
      pushImpl: mockPush,
    });

    expect(actionError).toBeNull();
    expect(pushed).toBe(false);
    expect(removedId).toBe(COLLAB_ID);
  });
});

describe("CollaboratorsSection — Leave action (collaborator removes self)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls router.push('/world/{worldId}') after a successful self-removal", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ removed: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    const mockConfirm = vi.fn().mockReturnValue(true);
    const mockPush = vi.fn();

    const { pushed } = await runRemove({
      worldId: WORLD_ID,
      collab: collabRow,
      // currentUserId === collab.id → isSelf = true → Leave path
      currentUserId: COLLAB_ID,
      fetchImpl: mockFetch as unknown as typeof fetch,
      confirmImpl: mockConfirm,
      pushImpl: mockPush,
    });

    expect(pushed).toBe(true);
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush).toHaveBeenCalledWith(`/world/${WORLD_ID}`);
  });

  it("uses the 'Stop collaborating' confirm message for self-removal", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ removed: true }), { status: 200 })
    );
    const mockConfirm = vi.fn().mockReturnValue(true);

    await runRemove({
      worldId: WORLD_ID,
      collab: collabRow,
      currentUserId: COLLAB_ID, // self
      fetchImpl: mockFetch as unknown as typeof fetch,
      confirmImpl: mockConfirm,
      pushImpl: vi.fn(),
    });

    expect(mockConfirm).toHaveBeenCalledWith("Stop collaborating on this world?");
  });
});
