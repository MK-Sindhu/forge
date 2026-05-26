/**
 * Unit tests for InviteCollaboratorDialog submit-handler logic.
 *
 * InviteCollaboratorDialog is a client component built around a native
 * <dialog> element. Its core behaviour is the async handleSubmit function,
 * which:
 *   1. Trims + strips leading "@" from the username input.
 *   2. POSTs to /api/worlds/{worldId}/collaborators with { username }.
 *   3. Dispatches to one of five outcome branches based on the HTTP status:
 *        201  → onSuccess(newRow) + close
 *        404  → inline error "No user @{username}"
 *        409 with `existing`  → inline error "already a collaborator"
 *        409 without `existing` → inline error "owner" / self-invite message
 *        5xx / other → inline error "Couldn't invite right now"
 *
 * Why not mount with @testing-library/react?
 *   The global vitest environment is "node" (no DOM APIs). The native <dialog>
 *   element is not present in Node.js, so showModal() would throw. Following
 *   the project pattern in ConvertToSceneGraphButton.test.ts and
 *   MobileJoysticks.test.ts, we reproduce the handleSubmit body as a standalone
 *   async helper and drive it with typed stubs. This tests the fetch contract
 *   (correct URL, method, body) and the error/success dispatch without needing
 *   a browser or JSDOM.
 *
 * Mocks:
 *   - global fetch: vi.fn() injected as a parameter
 *   - onSuccess: vi.fn() — callback the component calls on 201
 *   - onClose: vi.fn() — callback the component calls after success or on close
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Types — mirror the component's exported CollaboratorRow + internal shapes
// ---------------------------------------------------------------------------

interface CollaboratorRow {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: string;
  addedAt: string;
  addedBy: { id: string; username: string } | null;
}

type InviteResult =
  | { kind: "ok"; row: CollaboratorRow }
  | { kind: "not-found"; username: string }
  | { kind: "dupe"; username: string }
  | { kind: "owner-self" }
  | { kind: "error"; message: string };

// ---------------------------------------------------------------------------
// Logic helper — reproduces handleSubmit from InviteCollaboratorDialog.tsx.
//
// The component ties this logic to React state (setError, setSubmitting,
// onSuccess, onClose). Here we surface the outcome as a discriminated-union
// return value so tests can assert the correct branch without React state.
// ---------------------------------------------------------------------------

async function runSubmit(opts: {
  worldId: string;
  rawUsername: string;        // the value as typed by the user (may include "@")
  fetchImpl: typeof fetch;
}): Promise<InviteResult> {
  const { worldId, rawUsername, fetchImpl } = opts;

  // Mirror: const trimmed = username.trim().replace(/^@/, "");
  const trimmed = rawUsername.trim().replace(/^@/, "");

  if (!trimmed) {
    return { kind: "error", message: "Please enter a username." };
  }

  try {
    const res = await fetchImpl(`/api/worlds/${worldId}/collaborators`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: trimmed }),
    });

    if (res.status === 201) {
      const row = (await res.json()) as CollaboratorRow;
      return { kind: "ok", row };
    }

    const data = await res.json().catch(() => ({})) as {
      error?: string;
      existing?: { id: string; username: string; role: string; addedAt: string };
    };

    if (res.status === 404) {
      return { kind: "not-found", username: trimmed };
    }

    if (res.status === 409) {
      if (data.existing) {
        return { kind: "dupe", username: trimmed };
      }
      return { kind: "owner-self" };
    }

    // 5xx or unexpected
    return { kind: "error", message: "Couldn't invite right now. Try again." };
  } catch {
    return { kind: "error", message: "Couldn't invite right now. Try again." };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "world-uuid-9999-9999-9999-999999999999";

const newCollabRow: CollaboratorRow = {
  id: "collab-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  username: "alice",
  avatarUrl: null,
  role: "editor",
  addedAt: new Date().toISOString(),
  addedBy: { id: "owner-uuid-bbbb-bbbb-bbbb-bbbbbbbbbbbb", username: "worldowner" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InviteCollaboratorDialog — submit handler fetch contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calls POST /api/worlds/{worldId}/collaborators with correct body", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(newCollabRow), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await runSubmit({ worldId: WORLD_ID, rawUsername: "alice", fetchImpl: mockFetch as unknown as typeof fetch });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/worlds/${WORLD_ID}/collaborators`);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ username: "alice" });
  });

  it("strips a leading '@' from the username before sending", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(newCollabRow), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    await runSubmit({ worldId: WORLD_ID, rawUsername: "@alice", fetchImpl: mockFetch as unknown as typeof fetch });

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(opts.body as string)).toEqual({ username: "alice" });
  });
});

describe("InviteCollaboratorDialog — 201 success branch", () => {
  it("returns kind:'ok' with the new CollaboratorRow on 201", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(newCollabRow), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await runSubmit({
      worldId: WORLD_ID,
      rawUsername: "alice",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.row.id).toBe(newCollabRow.id);
      expect(result.row.username).toBe("alice");
      expect(result.row.role).toBe("editor");
    }
  });
});

describe("InviteCollaboratorDialog — 404 not-found branch", () => {
  it("returns kind:'not-found' when the target username does not exist", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "user not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await runSubmit({
      worldId: WORLD_ID,
      rawUsername: "ghost",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.kind).toBe("not-found");
    if (result.kind === "not-found") {
      // The component renders: `No user @${trimmed}. Check the spelling.`
      expect(result.username).toBe("ghost");
    }
  });
});

describe("InviteCollaboratorDialog — 409 duplicate branch", () => {
  it("returns kind:'dupe' when the 409 response includes an 'existing' field", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "already a collaborator",
          existing: {
            id: "collab-uuid-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            username: "alice",
            role: "editor",
            addedAt: new Date().toISOString(),
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await runSubmit({
      worldId: WORLD_ID,
      rawUsername: "alice",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.kind).toBe("dupe");
    if (result.kind === "dupe") {
      expect(result.username).toBe("alice");
    }
  });

  it("returns kind:'owner-self' when the 409 has no 'existing' field (self-invite guard)", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "cannot invite yourself" }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await runSubmit({
      worldId: WORLD_ID,
      rawUsername: "worldowner",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.kind).toBe("owner-self");
  });
});

describe("InviteCollaboratorDialog — 5xx error branch", () => {
  it("returns kind:'error' with a user-friendly message on a 500 response", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "database error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );

    const result = await runSubmit({
      worldId: WORLD_ID,
      rawUsername: "alice",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("Couldn't invite right now");
    }
  });

  it("returns kind:'error' when fetch throws (network failure)", async () => {
    const mockFetch = vi.fn().mockRejectedValueOnce(new Error("Failed to fetch"));

    const result = await runSubmit({
      worldId: WORLD_ID,
      rawUsername: "alice",
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("Couldn't invite right now");
    }
  });
});
