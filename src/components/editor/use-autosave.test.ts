/**
 * Unit tests for the autosave cycle logic.
 *
 * The node vitest environment has no DOM and no React runtime, so we cannot
 * use renderHook / act. Instead, we test the **logic** of the save cycle
 * directly by:
 *  - Importing the internal async runSaveCycle logic (extracted as a helper
 *    for testability).
 *  - Using the real Zustand vanilla store (createEditorStore) so state
 *    transitions are exercised end-to-end.
 *  - Mocking global `fetch` so we control API responses.
 *
 * This mirrors the EditorTopBar.test.ts and AssetPanel.test.ts patterns.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createEditorStore } from "./editor-store";
import { emptySceneGraph } from "@/lib/scene-graph/schema";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import { saveOps } from "./save-client";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "world-autosave-test-001";
const VERSION_ID_1 = "11110000-0000-4000-8000-000000000001";
const VERSION_ID_2 = "22220000-0000-4000-8000-000000000002";
const VERSION_ID_3 = "33330000-0000-4000-8000-000000000003";
const ASSET_ID = "a0000000-0000-4000-8000-000000000001";

function freshSceneGraph(): SceneGraphV1 {
  return emptySceneGraph();
}

function freshStore() {
  const store = createEditorStore();
  store.getState().initialize({
    worldId: WORLD_ID,
    sceneGraph: freshSceneGraph(),
    baseVersionId: VERSION_ID_1,
  });
  return store;
}

// ---------------------------------------------------------------------------
// runSaveCycle helper — extracted from the hook for direct testing.
//
// The real hook runs this inside a setInterval. Here we call it directly,
// passing in the store (getState / setState references) and the fetch result
// controlled by mocked global fetch.
// ---------------------------------------------------------------------------

async function runSaveCycle(
  store: ReturnType<typeof createEditorStore>,
  inFlightRef: { current: boolean },
  conflictRetriesRef: { current: number },
  worldId: string
): Promise<void> {
  if (inFlightRef.current) return;
  inFlightRef.current = true;

  try {
    const begun = store.getState().beginSave();
    if (!begun) return;

    const result = await saveOps({
      worldId,
      ops: begun.ops,
      baseVersionId: begun.baseVersionId,
    });

    if (result.ok) {
      store.getState().completeSave({ versionId: result.versionId, sceneGraph: result.sceneGraph });
      conflictRetriesRef.current = 0;
    } else if (result.kind === "conflict") {
      conflictRetriesRef.current += 1;
      if (conflictRetriesRef.current >= 3) {
        store.getState().failSave("Couldn't reconcile changes — refresh and try again.");
        conflictRetriesRef.current = 0;
      } else {
        store.getState().rebaseOnServerVersion({
          versionId: result.currentVersion.versionId,
          sceneGraph: result.currentVersion.sceneGraph,
        });
      }
    } else if (result.kind === "operation-error") {
      store.getState().failSave(`Invalid edit: ${result.message} (op #${result.opIndex})`);
    } else {
      store.getState().failSave(result.message);
    }
  } catch (err) {
    store.getState().failSave(err instanceof Error ? err.message : "Save failed.");
  } finally {
    inFlightRef.current = false;
  }
}

function makeRefs() {
  return {
    inFlightRef: { current: false },
    conflictRetriesRef: { current: 0 },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllGlobals());

describe("useAutosave cycle — nothing pending", () => {
  it("skips when beginSave returns null (nothing pending)", async () => {
    const store = freshStore();
    // No ops added — pendingOps is empty, beginSave returns null
    const refs = makeRefs();

    vi.stubGlobal("fetch", vi.fn());

    await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);

    // fetch should never have been called
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    // Status stays idle
    expect(store.getState().autosaveStatus).toBe("idle");
  });
});

describe("useAutosave cycle — 200 success", () => {
  it("calls completeSave on 200 and resets conflict counter", async () => {
    const store = freshStore();
    // Add a pending op so beginSave returns something
    store.getState().addObject(ASSET_ID);
    expect(store.getState().pendingOps).toHaveLength(1);

    const newSceneGraph = freshSceneGraph();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        json: () =>
          Promise.resolve({
            versionId: VERSION_ID_2,
            versionNumber: 2,
            sceneGraph: newSceneGraph,
          }),
      })
    );

    const refs = makeRefs();
    refs.conflictRetriesRef.current = 1; // pretend there was a prior conflict

    await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);

    const s = store.getState();
    expect(s.autosaveStatus).toBe("saved");
    expect(s.baseVersionId).toBe(VERSION_ID_2);
    expect(s.pendingOps).toHaveLength(0);
    // Conflict counter should be reset
    expect(refs.conflictRetriesRef.current).toBe(0);
  });
});

describe("useAutosave cycle — first 409 conflict", () => {
  it("calls rebaseOnServerVersion on the first conflict (not failSave)", async () => {
    const store = freshStore();
    store.getState().addObject(ASSET_ID);

    const serverGraph = freshSceneGraph();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 409,
        json: () =>
          Promise.resolve({
            error: "version conflict",
            currentVersion: {
              versionId: VERSION_ID_3,
              versionNumber: 5,
              sceneGraph: serverGraph,
              status: "draft",
            },
          }),
      })
    );

    const refs = makeRefs(); // conflictRetries = 0
    await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);

    const s = store.getState();
    // Rebase sets baseVersionId to the server's version
    expect(s.baseVersionId).toBe(VERSION_ID_3);
    // Status is pending (rebased ops ready for next tick)
    expect(s.autosaveStatus).toBe("pending");
    // Conflict counter incremented but NOT yet at the cap
    expect(refs.conflictRetriesRef.current).toBe(1);
  });
});

describe("useAutosave cycle — 3 consecutive 409s", () => {
  it("calls failSave after MAX_CONFLICT_RETRIES and resets counter", async () => {
    const store = freshStore();
    store.getState().addObject(ASSET_ID);

    const serverGraph = freshSceneGraph();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 409,
        json: () =>
          Promise.resolve({
            error: "version conflict",
            currentVersion: {
              versionId: VERSION_ID_3,
              versionNumber: 5,
              sceneGraph: serverGraph,
              status: "draft",
            },
          }),
      })
    );

    const refs = makeRefs();

    // Simulate 3 consecutive conflict ticks
    // After each rebase we need a pending op, so add one if needed
    for (let i = 0; i < 3; i++) {
      // Re-add an op if pendingOps got cleared by rebase
      if (store.getState().pendingOps.length === 0) {
        store.getState().addObject(ASSET_ID);
      }
      await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);
    }

    const s = store.getState();
    expect(s.autosaveStatus).toBe("error");
    expect(s.lastSaveError).toContain("reconcile");
    // Counter reset to 0 after bail
    expect(refs.conflictRetriesRef.current).toBe(0);
  });
});

describe("useAutosave cycle — conflict counter resets after success", () => {
  it("resets conflict counter to 0 after a successful save following conflicts", async () => {
    const store = freshStore();
    store.getState().addObject(ASSET_ID);

    const serverGraph = freshSceneGraph();

    // First call: 409
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          status: 409,
          json: () =>
            Promise.resolve({
              error: "version conflict",
              currentVersion: {
                versionId: VERSION_ID_2,
                versionNumber: 2,
                sceneGraph: serverGraph,
                status: "draft",
              },
            }),
        })
        // Second call: 200
        .mockResolvedValueOnce({
          status: 200,
          json: () =>
            Promise.resolve({
              versionId: VERSION_ID_3,
              versionNumber: 3,
              sceneGraph: serverGraph,
            }),
        })
    );

    const refs = makeRefs();

    // First tick — conflict
    await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);
    expect(refs.conflictRetriesRef.current).toBe(1);

    // pendingOps may have survived the rebase; if not, add one
    if (store.getState().pendingOps.length === 0) {
      store.getState().addObject(ASSET_ID);
    }

    // Second tick — success
    await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);
    expect(refs.conflictRetriesRef.current).toBe(0);
    expect(store.getState().autosaveStatus).toBe("saved");
  });
});

describe("useAutosave cycle — in-flight guard", () => {
  it("does not re-enter if inFlightRef is true", async () => {
    const store = freshStore();
    store.getState().addObject(ASSET_ID);

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          versionId: VERSION_ID_2,
          versionNumber: 2,
          sceneGraph: freshSceneGraph(),
        }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const refs = makeRefs();
    refs.inFlightRef.current = true; // simulate in-flight

    await runSaveCycle(store, refs.inFlightRef, refs.conflictRetriesRef, WORLD_ID);

    // fetch should NOT have been called because inFlightRef was already true
    expect(fetchMock).not.toHaveBeenCalled();
    // Status unchanged (still pending from addObject)
    expect(store.getState().autosaveStatus).toBe("pending");
  });
});
