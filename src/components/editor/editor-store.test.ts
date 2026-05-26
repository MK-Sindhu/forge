/**
 * Unit tests for the editor store.
 *
 * Each test creates a fresh store via createEditorStore() (vanilla Zustand —
 * no React, no DOM). State mutations are exercised via store.getState().action()
 * and assertions are made via store.getState().field.
 *
 * Vitest environment: "node" (set in vitest.config.ts).
 */

import { describe, it, expect, vi } from "vitest";
import { createEditorStore } from "./editor-store";
import { emptySceneGraph } from "@/lib/scene-graph/schema";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import type { SceneGraphOp } from "@/lib/scene-graph/operations";
import { MAX_OPS_PER_BATCH } from "@/lib/scene-graph/operations";
import type { StoreApi } from "zustand/vanilla";
import type { EditorStore } from "./editor-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORLD_ID = "world-abc-123";
const VERSION_ID = "11111111-1111-1111-8111-111111111111";
// Valid RFC 4122 v4 UUIDs (version digit = 4, variant digit = 8-b)
const ASSET_ID = "a0000000-0000-4000-8000-000000000001";
const ASSET_ID_2 = "b0000000-0000-4000-8000-000000000002";

/** Build a minimal scene graph with one object. */
function graphWithOneObject(objectId = "obj_testobj"): SceneGraphV1 {
  const base = emptySceneGraph();
  return {
    ...base,
    objects: [
      {
        id: objectId,
        assetId: ASSET_ID,
        name: "Test Object",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

/** Initialize a fresh store for a given worldId + optional sceneGraph. */
function initStore(
  store: StoreApi<EditorStore>,
  sceneGraph?: SceneGraphV1
): void {
  store.getState().initialize({
    worldId: WORLD_ID,
    sceneGraph: sceneGraph ?? emptySceneGraph(),
    baseVersionId: VERSION_ID,
  });
}

/** Apply an add_object op with a known assetId. */
function addObjectOp(id?: string): SceneGraphOp {
  return {
    op: "add_object",
    id: id ?? "obj_added01",
    assetId: ASSET_ID,
    position: [1, 2, 3],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

describe("initialize()", () => {
  it("sets worldId, sceneGraph, baseVersionId, serverSceneGraph and clears all mutable state", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject();

    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graph,
      baseVersionId: VERSION_ID,
    });

    const s = store.getState();
    expect(s.worldId).toBe(WORLD_ID);
    expect(s.sceneGraph).toEqual(graph);
    expect(s.baseVersionId).toBe(VERSION_ID);
    expect(s.serverSceneGraph).toEqual(graph);
    expect(s.pendingOps).toHaveLength(0);
    expect(s.undoStack).toHaveLength(0);
    expect(s.redoStack).toHaveLength(0);
    expect(s.autosaveStatus).toBe("idle");
    expect(s.selectedObjectId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Basic UI setters
// ---------------------------------------------------------------------------

describe("selectObject / setGizmoMode / setPropertiesTab", () => {
  it("selectObject updates selectedObjectId", () => {
    const store = createEditorStore();
    initStore(store);
    store.getState().selectObject("obj_xyz");
    expect(store.getState().selectedObjectId).toBe("obj_xyz");
    store.getState().selectObject(null);
    expect(store.getState().selectedObjectId).toBeNull();
  });

  it("setGizmoMode updates gizmoMode", () => {
    const store = createEditorStore();
    initStore(store);
    store.getState().setGizmoMode("rotate");
    expect(store.getState().gizmoMode).toBe("rotate");
    store.getState().setGizmoMode("scale");
    expect(store.getState().gizmoMode).toBe("scale");
  });

  it("setPropertiesTab updates propertiesTab", () => {
    const store = createEditorStore();
    initStore(store);
    store.getState().setPropertiesTab("lights");
    expect(store.getState().propertiesTab).toBe("lights");
    store.getState().setPropertiesTab("environment");
    expect(store.getState().propertiesTab).toBe("environment");
  });
});

// ---------------------------------------------------------------------------
// 3. applyOp — happy path
// ---------------------------------------------------------------------------

describe("applyOp() — happy path", () => {
  it("add_object updates sceneGraph, appends to pendingOps, pushes undo entry, sets autosaveStatus=pending, clears redoStack", () => {
    const store = createEditorStore();
    initStore(store);

    const op = addObjectOp();
    store.getState().applyOp(op);

    const s = store.getState();
    expect(s.sceneGraph.objects).toHaveLength(1);
    expect(s.sceneGraph.objects[0].id).toBe("obj_added01");
    expect(s.pendingOps).toHaveLength(1);
    expect(s.pendingOps[0]).toEqual(op);
    expect(s.undoStack).toHaveLength(1);
    expect(s.redoStack).toHaveLength(0);
    expect(s.autosaveStatus).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// 4. applyOp — OperationError path
// ---------------------------------------------------------------------------

describe("applyOp() — OperationError does not mutate state", () => {
  it("update_object with non-existent id: sceneGraph, pendingOps, undoStack all unchanged", () => {
    const store = createEditorStore();
    initStore(store);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const badOp: SceneGraphOp = {
      op: "update_object",
      id: "does_not_exist",
      patch: { position: [1, 2, 3] },
    };

    store.getState().applyOp(badOp);

    const s = store.getState();
    expect(s.sceneGraph.objects).toHaveLength(0); // unchanged — empty initial graph
    expect(s.pendingOps).toHaveLength(0);
    expect(s.undoStack).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalledOnce();

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 5. applyOp clears redoStack
// ---------------------------------------------------------------------------

describe("applyOp() clears redoStack", () => {
  it("after undoing to create redoStack, a new applyOp clears it", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_first"));
    store.getState().undo();

    expect(store.getState().redoStack).toHaveLength(1);

    store.getState().applyOp(addObjectOp("obj_second"));

    expect(store.getState().redoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. undoStack cap at 50
// ---------------------------------------------------------------------------

describe("undoStack cap", () => {
  it("applying 51 ops caps undoStack at 50 (oldest evicted), redoStack stays empty", () => {
    const store = createEditorStore();
    initStore(store);

    for (let i = 0; i < 51; i++) {
      const id = `obj_${"a" + i.toString().padStart(7, "0")}`;
      // Each op is add_object with unique id
      store.getState().applyOp({
        op: "add_object",
        id,
        assetId: ASSET_ID,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
    }

    const s = store.getState();
    expect(s.undoStack).toHaveLength(50);
    expect(s.redoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. undo — basic
// ---------------------------------------------------------------------------

describe("undo() — basic", () => {
  it("undo after one add_object restores initial graph; redoStack has 1 entry; pendingOps emptied; autosaveStatus → idle", () => {
    const store = createEditorStore();
    const initial = emptySceneGraph();
    initStore(store, initial);

    store.getState().applyOp(addObjectOp());
    store.getState().undo();

    const s = store.getState();
    expect(s.sceneGraph.objects).toHaveLength(0);
    expect(s.sceneGraph).toEqual(initial);
    expect(s.redoStack).toHaveLength(1);
    expect(s.pendingOps).toHaveLength(0);
    expect(s.autosaveStatus).toBe("idle");
    expect(s.undoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. undo with multi-op pending
// ---------------------------------------------------------------------------

describe("undo() with multiple pending ops", () => {
  it("undo once after 3 ops → pendingOps length is 2, sceneGraph matches state after op 2", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_op1"));
    const afterOp2Graph = (() => {
      // We need the graph state after exactly 2 ops
      store.getState().applyOp(addObjectOp("obj_op2"));
      return store.getState().sceneGraph;
    })();
    store.getState().applyOp(addObjectOp("obj_op3"));

    store.getState().undo(); // undo op 3

    const s = store.getState();
    expect(s.pendingOps).toHaveLength(2);
    expect(s.sceneGraph).toEqual(afterOp2Graph);
  });
});

// ---------------------------------------------------------------------------
// 9. redo
// ---------------------------------------------------------------------------

describe("redo()", () => {
  it("redo after undo restores post-op graph; redoStack empty; pendingOps has the op again", () => {
    const store = createEditorStore();
    initStore(store);

    const op = addObjectOp();
    store.getState().applyOp(op);
    const postOpGraph = store.getState().sceneGraph;

    store.getState().undo();
    store.getState().redo();

    const s = store.getState();
    expect(s.sceneGraph).toEqual(postOpGraph);
    expect(s.redoStack).toHaveLength(0);
    expect(s.pendingOps).toHaveLength(1);
    expect(s.pendingOps[0]).toEqual(op);
  });
});

// ---------------------------------------------------------------------------
// 10. redo then new applyOp clears redoStack
// ---------------------------------------------------------------------------

describe("redo + new applyOp", () => {
  it("apply → undo → applyOp(different op) → redoStack is empty", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_first"));
    store.getState().undo();

    expect(store.getState().redoStack).toHaveLength(1);

    store.getState().applyOp(addObjectOp("obj_different"));

    expect(store.getState().redoStack).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 11. deleteSelectedObject
// ---------------------------------------------------------------------------

describe("deleteSelectedObject()", () => {
  it("selects then deletes → selection cleared, object removed from sceneGraph", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject("obj_target");
    initStore(store, graph);

    store.getState().selectObject("obj_target");
    store.getState().deleteSelectedObject();

    const s = store.getState();
    expect(s.sceneGraph.objects).toHaveLength(0);
    expect(s.selectedObjectId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. deleteSelectedObject with no selection
// ---------------------------------------------------------------------------

describe("deleteSelectedObject() with no selection", () => {
  it("is a no-op when selectedObjectId is null", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject("obj_stay");
    initStore(store, graph);

    // selectedObjectId is null by default after initialize
    store.getState().deleteSelectedObject();

    const s = store.getState();
    expect(s.sceneGraph.objects).toHaveLength(1); // unchanged
    expect(s.pendingOps).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 13. addObject generates an id
// ---------------------------------------------------------------------------

describe("addObject()", () => {
  it("adds object with obj_<8hex> id; id is present in sceneGraph.objects", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().addObject(ASSET_ID, { name: "My Asset" });

    const s = store.getState();
    expect(s.sceneGraph.objects).toHaveLength(1);
    const added = s.sceneGraph.objects[0];
    expect(added.id).toMatch(/^obj_[0-9a-f]{8}$/);
    expect(added.assetId).toBe(ASSET_ID);
    expect(added.name).toBe("My Asset");
  });
});

// ---------------------------------------------------------------------------
// 14. isDirty()
// ---------------------------------------------------------------------------

describe("isDirty()", () => {
  it("false on init, true after one applyOp, false after completeSave clears pendingOps", () => {
    const store = createEditorStore();
    initStore(store);

    expect(store.getState().isDirty()).toBe(false);

    store.getState().applyOp(addObjectOp());

    expect(store.getState().isDirty()).toBe(true);

    // Simulate a full save cycle
    const saveResult = store.getState().beginSave();
    expect(saveResult).not.toBeNull();
    store.getState().completeSave({
      versionId: "22222222-2222-2222-2222-222222222222",
      sceneGraph: store.getState().sceneGraph,
    });

    expect(store.getState().isDirty()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 15. getSelectedObject()
// ---------------------------------------------------------------------------

describe("getSelectedObject()", () => {
  it("returns the matching object when selectedObjectId is set", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject("obj_target");
    initStore(store, graph);

    store.getState().selectObject("obj_target");

    const obj = store.getState().getSelectedObject();
    expect(obj).toBeDefined();
    expect(obj?.id).toBe("obj_target");
    expect(obj?.assetId).toBe(ASSET_ID);
  });

  it("returns undefined when selectedObjectId is null", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject("obj_target");
    initStore(store, graph);

    expect(store.getState().getSelectedObject()).toBeUndefined();
  });

  it("returns undefined for a non-existent id", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().selectObject("obj_ghost");
    expect(store.getState().getSelectedObject()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 16. beginSave — normal
// ---------------------------------------------------------------------------

describe("beginSave() — normal", () => {
  it("pendingOps has 3 → beginSave returns { ops: [3 ops], baseVersionId }; autosaveStatus = saving; lastSaveOpCount = 3", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_a"));
    store.getState().applyOp(addObjectOp("obj_b"));
    store.getState().applyOp(addObjectOp("obj_c"));

    const result = store.getState().beginSave();

    expect(result).not.toBeNull();
    expect(result!.ops).toHaveLength(3);
    expect(result!.baseVersionId).toBe(VERSION_ID);
    expect(store.getState().autosaveStatus).toBe("saving");
    expect(store.getState().lastSaveOpCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 17. beginSave with no pending ops
// ---------------------------------------------------------------------------

describe("beginSave() — no pending ops", () => {
  it("returns null; autosaveStatus remains idle", () => {
    const store = createEditorStore();
    initStore(store);

    const result = store.getState().beginSave();

    expect(result).toBeNull();
    expect(store.getState().autosaveStatus).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// 18. beginSave while already saving
// ---------------------------------------------------------------------------

describe("beginSave() — while already saving", () => {
  it("returns null if autosaveStatus is already 'saving'", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_a"));

    const first = store.getState().beginSave();
    expect(first).not.toBeNull(); // consumed the pending op
    expect(store.getState().autosaveStatus).toBe("saving");

    const second = store.getState().beginSave();
    expect(second).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 19. beginSave caps at MAX_OPS_PER_BATCH
// ---------------------------------------------------------------------------

describe("beginSave() — caps at MAX_OPS_PER_BATCH", () => {
  it("pendingOps has 150 → returned ops length is 100", () => {
    const store = createEditorStore();
    initStore(store);

    // Add 150 unique objects
    for (let i = 0; i < 150; i++) {
      // We bypass applyOp to avoid undo cap issues (51-cap would stop us)
      // Instead, directly set pendingOps
    }
    // Use setState to inject pendingOps directly (test helper pattern)
    const ops: SceneGraphOp[] = Array.from({ length: 150 }, (_, i) => ({
      op: "add_object" as const,
      id: `obj_${i.toString().padStart(8, "0")}`,
      assetId: ASSET_ID,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    }));
    store.setState({ pendingOps: ops, autosaveStatus: "pending" });

    const result = store.getState().beginSave();

    expect(result).not.toBeNull();
    expect(result!.ops).toHaveLength(MAX_OPS_PER_BATCH);
    expect(store.getState().lastSaveOpCount).toBe(MAX_OPS_PER_BATCH);
  });
});

// ---------------------------------------------------------------------------
// 20. completeSave clears flushed ops + advances baseVersionId
// ---------------------------------------------------------------------------

describe("completeSave()", () => {
  it("pendingOps had 3 (saved count 3) → after completeSave: pendingOps empty, baseVersionId new, serverSceneGraph new, autosaveStatus 'saved'", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_a"));
    store.getState().applyOp(addObjectOp("obj_b"));
    store.getState().applyOp(addObjectOp("obj_c"));

    store.getState().beginSave();

    const newVersionId = "33333333-3333-3333-3333-333333333333";
    const newGraph = store.getState().sceneGraph;

    store.getState().completeSave({ versionId: newVersionId, sceneGraph: newGraph });

    const s = store.getState();
    expect(s.pendingOps).toHaveLength(0);
    expect(s.baseVersionId).toBe(newVersionId);
    expect(s.serverSceneGraph).toEqual(newGraph);
    expect(s.autosaveStatus).toBe("saved");
    expect(s.lastSaveError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 21. completeSave with new ops added during save
// ---------------------------------------------------------------------------

describe("completeSave() with ops added mid-save", () => {
  it("3 ops in pendingOps when beginSave called; 2 more added during save; completeSave → pendingOps left with 2, autosaveStatus 'pending'", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp("obj_a"));
    store.getState().applyOp(addObjectOp("obj_b"));
    store.getState().applyOp(addObjectOp("obj_c"));

    store.getState().beginSave(); // saves 3 ops

    // User adds 2 more ops while save is in-flight
    store.getState().applyOp(addObjectOp("obj_d"));
    store.getState().applyOp(addObjectOp("obj_e"));

    expect(store.getState().pendingOps).toHaveLength(5);

    const newVersionId = "44444444-4444-4444-4444-444444444444";
    store.getState().completeSave({
      versionId: newVersionId,
      sceneGraph: store.getState().sceneGraph,
    });

    const s = store.getState();
    expect(s.pendingOps).toHaveLength(2); // obj_d and obj_e remain
    expect(s.autosaveStatus).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// 22. failSave preserves pendingOps
// ---------------------------------------------------------------------------

describe("failSave()", () => {
  it("sets autosaveStatus='error', stores error message, leaves pendingOps unchanged", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().applyOp(addObjectOp());
    store.getState().beginSave();

    store.getState().failSave("Network timeout");

    const s = store.getState();
    expect(s.autosaveStatus).toBe("error");
    expect(s.lastSaveError).toBe("Network timeout");
    expect(s.pendingOps).toHaveLength(1); // NOT cleared
  });
});

// ---------------------------------------------------------------------------
// 23. rebaseOnServerVersion — happy path
// ---------------------------------------------------------------------------

describe("rebaseOnServerVersion() — compatible ops", () => {
  it("server graph differs but local ops are compatible → serverSceneGraph updated, sceneGraph = server + ops applied, undoStack/redoStack cleared, autosaveStatus 'pending'", () => {
    const store = createEditorStore();
    const serverInitial = graphWithOneObject("obj_server1");
    initStore(store, serverInitial);

    // Apply a local op (add another object)
    store.getState().applyOp(addObjectOp("obj_local1"));

    // Simulate a 409: server has a different version (e.g., another client
    // edited it) — still has obj_server1 but also a new obj_server2
    const serverConflictGraph: SceneGraphV1 = {
      ...serverInitial,
      objects: [
        ...serverInitial.objects,
        {
          id: "obj_server2",
          assetId: ASSET_ID_2,
          name: "Server Added",
          position: [5, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
      ],
    };

    store.getState().rebaseOnServerVersion({
      versionId: "55555555-5555-5555-5555-555555555555",
      sceneGraph: serverConflictGraph,
    });

    const s = store.getState();
    expect(s.serverSceneGraph).toEqual(serverConflictGraph);
    // sceneGraph should be serverConflictGraph + local op applied
    expect(s.sceneGraph.objects).toHaveLength(3); // obj_server1 + obj_server2 + obj_local1
    expect(s.undoStack).toHaveLength(0);
    expect(s.redoStack).toHaveLength(0);
    expect(s.autosaveStatus).toBe("pending");
    expect(s.pendingOps).toHaveLength(1); // surviving op
  });
});

// ---------------------------------------------------------------------------
// 24. rebaseOnServerVersion drops incompatible op
// ---------------------------------------------------------------------------

describe("rebaseOnServerVersion() — incompatible op dropped", () => {
  it("local has update_object for id=X but X doesn't exist on new server graph → op dropped from pendingOps, console.error called", () => {
    const store = createEditorStore();
    initStore(store, graphWithOneObject("obj_x"));

    // Apply a compatible op first, then an op that will become incompatible
    store.getState().applyOp(addObjectOp("obj_compatible"));
    store.getState().applyOp({
      op: "update_object",
      id: "obj_x", // this object exists now but won't exist on the new server graph
      patch: { position: [9, 9, 9] },
    });

    expect(store.getState().pendingOps).toHaveLength(2);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // New server graph does NOT contain obj_x
    const serverWithoutX = emptySceneGraph();
    store.getState().rebaseOnServerVersion({
      versionId: "66666666-6666-6666-6666-666666666666",
      sceneGraph: serverWithoutX,
    });

    const s = store.getState();
    // update_object for obj_x should be dropped; add_object for obj_compatible survives
    expect(s.pendingOps).toHaveLength(1);
    expect(s.pendingOps[0]).toMatchObject({ op: "add_object", id: "obj_compatible" });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 25. Convenience methods build correct op shapes
// ---------------------------------------------------------------------------

describe("Convenience method — updateObject builds correct op shape", () => {
  it("updateObject('id1', { position: [1,2,3] }) → applyOp called with update_object op for id1", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject("obj_id1");
    initStore(store, graph);

    store.getState().updateObject("obj_id1", { position: [1, 2, 3] });

    const s = store.getState();
    expect(s.pendingOps).toHaveLength(1);
    const op = s.pendingOps[0];
    expect(op.op).toBe("update_object");
    if (op.op === "update_object") {
      expect(op.id).toBe("obj_id1");
      expect(op.patch.position).toEqual([1, 2, 3]);
    }
  });
});

describe("Convenience method — setObjectAsset builds correct op shape", () => {
  it("setObjectAsset('obj_id1', newAssetId) → pendingOps has set_object_asset op", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject("obj_id1");
    initStore(store, graph);

    store.getState().setObjectAsset("obj_id1", ASSET_ID_2);

    const s = store.getState();
    expect(s.pendingOps).toHaveLength(1);
    const op = s.pendingOps[0];
    expect(op.op).toBe("set_object_asset");
    if (op.op === "set_object_asset") {
      expect(op.id).toBe("obj_id1");
      expect(op.assetId).toBe(ASSET_ID_2);
    }
  });
});

describe("Convenience method — setEnvironment builds correct op shape", () => {
  it("setEnvironment updates environment in sceneGraph", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().setEnvironment({ skybox: "sunset", fog: null });

    const s = store.getState();
    expect(s.sceneGraph.environment.skybox).toBe("sunset");
    expect(s.pendingOps).toHaveLength(1);
    expect(s.pendingOps[0].op).toBe("set_environment");
  });
});

describe("Convenience method — addSpawn / deleteSpawn", () => {
  it("addSpawn adds a spawn point; deleteSpawn removes it", () => {
    const store = createEditorStore();
    initStore(store);

    store.getState().addSpawn({
      id: "spawn_2",
      position: [10, 0, 10],
      rotation: [0, 0, 0],
    });

    expect(store.getState().sceneGraph.spawnPoints).toHaveLength(2); // default + new

    store.getState().deleteSpawn("spawn_2");
    expect(store.getState().sceneGraph.spawnPoints).toHaveLength(1);
  });
});
