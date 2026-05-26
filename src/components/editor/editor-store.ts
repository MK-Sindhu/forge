/**
 * Editor store — Zustand-based state layer for the FORGE in-browser world editor.
 *
 * Pure logic module. No fetch calls. No R3F imports.
 *
 * Architecture:
 *  - createEditorStore() returns a vanilla Zustand StoreApi (no React).
 *    Tests import this function and create a fresh instance per test,
 *    avoiding shared state between test cases.
 *  - useEditorStore is a React-bound store (created with zustand/react `create`)
 *    for use by editor page components.
 *
 * Undo/redo uses "snapshot pair" triples:
 *   { before, after, op, pendingOpsLengthBefore }
 *  - On applyOp: push { before, after, op } to undoStack; clear redoStack.
 *  - On undo: pop entry → restore `before` snapshot → truncate pendingOps to
 *    entry.pendingOpsLengthBefore → push entry to redoStack.
 *  - On redo: pop entry → restore `after` snapshot → append entry.op to
 *    pendingOps → push entry to undoStack.
 *
 * Pending ops contract:
 *  - Only grows via applyOp() and redo().
 *  - Shrinks via undo(), completeSave(), and rebaseOnServerVersion().
 *  - beginSave() snapshots the first ≤100 ops to send; does NOT clear them yet
 *    (needed for retry on failure). completeSave() slices off the sent count.
 */

import { createStore } from "zustand/vanilla";
import { create } from "zustand";
import type { StoreApi, StateCreator } from "zustand/vanilla";
import {
  applyOps,
  OperationError,
  MAX_OPS_PER_BATCH,
} from "@/lib/scene-graph/operations";
import type { SceneGraphOp } from "@/lib/scene-graph/operations";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";
import { emptySceneGraph } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GizmoMode = "translate" | "rotate" | "scale";
export type PropertiesTab = "object" | "lights" | "environment" | "spawn-points";
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

/** Snapshot of the relevant scene state at a point in time. */
interface Snapshot {
  sceneGraph: SceneGraphV1;
  selectedObjectId: string | null;
}

/** One entry in the undo/redo stack. */
interface UndoEntry {
  before: Snapshot;
  after: Snapshot;
  op: SceneGraphOp;
  /**
   * Length of pendingOps at the moment applyOp() was called (BEFORE appending
   * the new op). On undo, pendingOps is truncated back to this length.
   */
  pendingOpsLengthBefore: number;
}

export interface EditorState {
  // --- Data ---
  worldId: string;
  sceneGraph: SceneGraphV1;
  /**
   * The version this local state is based on. Advances after a successful
   * save (completeSave) or a server-side rebase (rebaseOnServerVersion).
   * Empty string = uninitialized.
   */
  baseVersionId: string;
  /**
   * Server-truth snapshot. Updated after every successful save or rebase.
   * Used to compute isDirty and as the base for conflict recovery.
   */
  serverSceneGraph: SceneGraphV1;

  // --- UI ---
  selectedObjectId: string | null;
  gizmoMode: GizmoMode;
  propertiesTab: PropertiesTab;

  // --- Save/autosave ---
  pendingOps: SceneGraphOp[];
  autosaveStatus: AutosaveStatus;
  lastSaveError: string | null;
  /**
   * How many ops were bundled in the most recent beginSave() call.
   * completeSave() uses this to know how many leading ops to drop from
   * pendingOps.
   */
  lastSaveOpCount: number;

  // --- Undo/redo ---
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
}

export interface EditorActions {
  // Initialization
  initialize(args: {
    worldId: string;
    sceneGraph: SceneGraphV1;
    baseVersionId: string;
  }): void;

  // Selection / UI
  selectObject(id: string | null): void;
  setGizmoMode(mode: GizmoMode): void;
  setPropertiesTab(tab: PropertiesTab): void;

  // Core op application — heart of the store
  applyOp(op: SceneGraphOp): void;

  // Convenience mutation helpers (all delegate to applyOp)
  updateObject(
    id: string,
    patch: Partial<{
      position: [number, number, number];
      rotation: [number, number, number];
      scale: [number, number, number];
      name: string;
    }>
  ): void;
  addObject(
    assetId: string,
    opts?: { name?: string; position?: [number, number, number] }
  ): string;
  deleteSelectedObject(): void;
  setObjectAsset(id: string, assetId: string): void;
  setEnvironment(environment: SceneGraphV1["environment"]): void;
  setLights(lights: SceneGraphV1["lights"]): void;
  addSpawn(spawn: SceneGraphV1["spawnPoints"][number]): void;
  updateSpawn(
    id: string,
    patch: Partial<Omit<SceneGraphV1["spawnPoints"][number], "id">>
  ): void;
  deleteSpawn(id: string): void;

  // Undo/redo
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // Save lifecycle (called by the autosave hook in a later chunk)
  beginSave(): { ops: SceneGraphOp[]; baseVersionId: string } | null;
  completeSave(args: { versionId: string; sceneGraph: SceneGraphV1 }): void;
  failSave(message: string): void;
  rebaseOnServerVersion(args: {
    versionId: string;
    sceneGraph: SceneGraphV1;
  }): void;

  // Selectors
  isDirty(): boolean;
  getSelectedObject(): SceneGraphV1["objects"][number] | undefined;
}

export type EditorStore = EditorState & EditorActions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNDO_STACK_CAP = 50;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

function buildInitialState(): EditorState {
  const empty = emptySceneGraph();
  return {
    worldId: "",
    sceneGraph: empty,
    baseVersionId: "",
    serverSceneGraph: empty,
    selectedObjectId: null,
    gizmoMode: "translate",
    propertiesTab: "object",
    pendingOps: [],
    autosaveStatus: "idle",
    lastSaveError: null,
    lastSaveOpCount: 0,
    undoStack: [],
    redoStack: [],
  };
}

// ---------------------------------------------------------------------------
// State creator — shared between vanilla + React store factories
// ---------------------------------------------------------------------------

const editorStateCreator: StateCreator<EditorStore> = (set, get) => ({
  ...buildInitialState(),

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  initialize({ worldId, sceneGraph, baseVersionId }) {
    set({
      worldId,
      sceneGraph,
      baseVersionId,
      serverSceneGraph: sceneGraph,
      selectedObjectId: null,
      gizmoMode: "translate",
      propertiesTab: "object",
      pendingOps: [],
      autosaveStatus: "idle",
      lastSaveError: null,
      lastSaveOpCount: 0,
      undoStack: [],
      redoStack: [],
    });
  },

  // -------------------------------------------------------------------------
  // Selection / UI
  // -------------------------------------------------------------------------

  selectObject(id) {
    set({ selectedObjectId: id });
  },

  setGizmoMode(mode) {
    set({ gizmoMode: mode });
  },

  setPropertiesTab(tab) {
    set({ propertiesTab: tab });
  },

  // -------------------------------------------------------------------------
  // Core op application
  // -------------------------------------------------------------------------

  applyOp(op) {
    const state = get();

    const before: Snapshot = {
      sceneGraph: state.sceneGraph,
      selectedObjectId: state.selectedObjectId,
    };
    const pendingOpsLengthBefore = state.pendingOps.length;

    let nextSceneGraph: SceneGraphV1;
    try {
      nextSceneGraph = applyOps(state.sceneGraph, [op]);
    } catch (err) {
      if (err instanceof OperationError) {
        // Log but do NOT mutate state — not pushed to undoStack either
        console.error("[editor-store] applyOp rejected:", err.message, op);
        return;
      }
      throw err;
    }

    const after: Snapshot = {
      sceneGraph: nextSceneGraph,
      selectedObjectId: state.selectedObjectId,
    };

    const entry: UndoEntry = {
      before,
      after,
      op,
      pendingOpsLengthBefore,
    };

    const newUndoStack = [...state.undoStack, entry];
    // Cap at UNDO_STACK_CAP — drop oldest entries first
    if (newUndoStack.length > UNDO_STACK_CAP) {
      newUndoStack.splice(0, newUndoStack.length - UNDO_STACK_CAP);
    }

    set({
      sceneGraph: nextSceneGraph,
      pendingOps: [...state.pendingOps, op],
      undoStack: newUndoStack,
      redoStack: [], // any new action clears forward history
      autosaveStatus: "pending",
    });
  },

  // -------------------------------------------------------------------------
  // Convenience helpers
  // -------------------------------------------------------------------------

  updateObject(id, patch) {
    get().applyOp({ op: "update_object", id, patch });
  },

  addObject(assetId, opts) {
    // Generate a deterministic-ish id up front so callers can reference it
    // immediately for selection, gizmo targeting, etc.
    const id = `obj_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
    get().applyOp({
      op: "add_object",
      id,
      assetId,
      name: opts?.name,
      position: opts?.position ?? [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    });
    return id;
  },

  deleteSelectedObject() {
    const { selectedObjectId } = get();
    if (!selectedObjectId) return; // no-op if nothing selected

    get().applyOp({ op: "delete_object", id: selectedObjectId });

    // Clear selection if the delete succeeded (object is gone from graph)
    const { sceneGraph } = get();
    const stillExists = sceneGraph.objects.some((o) => o.id === selectedObjectId);
    if (!stillExists) {
      set({ selectedObjectId: null });
    }
  },

  setObjectAsset(id, assetId) {
    get().applyOp({ op: "set_object_asset", id, assetId });
  },

  setEnvironment(environment) {
    get().applyOp({ op: "set_environment", environment });
  },

  setLights(lights) {
    get().applyOp({ op: "set_lights", lights });
  },

  addSpawn(spawn) {
    get().applyOp({
      op: "add_spawn",
      id: spawn.id,
      position: spawn.position,
      rotation: spawn.rotation,
    });
  },

  updateSpawn(id, patch) {
    get().applyOp({ op: "update_spawn", id, patch });
  },

  deleteSpawn(id) {
    get().applyOp({ op: "delete_spawn", id });
  },

  // -------------------------------------------------------------------------
  // Undo / redo
  // -------------------------------------------------------------------------

  undo() {
    const state = get();
    if (state.undoStack.length === 0) return;

    const newUndoStack = [...state.undoStack];
    const entry = newUndoStack.pop()!;

    const newPendingOps = state.pendingOps.slice(0, entry.pendingOpsLengthBefore);
    const newRedoStack = [...state.redoStack, entry];

    set({
      sceneGraph: entry.before.sceneGraph,
      selectedObjectId: entry.before.selectedObjectId,
      pendingOps: newPendingOps,
      undoStack: newUndoStack,
      redoStack: newRedoStack,
      autosaveStatus: newPendingOps.length > 0 ? "pending" : "idle",
    });
  },

  redo() {
    const state = get();
    if (state.redoStack.length === 0) return;

    const newRedoStack = [...state.redoStack];
    const entry = newRedoStack.pop()!;

    const newPendingOps = [...state.pendingOps, entry.op];
    const newUndoStack = [...state.undoStack, entry];

    set({
      sceneGraph: entry.after.sceneGraph,
      selectedObjectId: entry.after.selectedObjectId,
      pendingOps: newPendingOps,
      undoStack: newUndoStack,
      redoStack: newRedoStack,
      autosaveStatus: "pending",
    });
  },

  canUndo() {
    return get().undoStack.length > 0;
  },

  canRedo() {
    return get().redoStack.length > 0;
  },

  // -------------------------------------------------------------------------
  // Save lifecycle
  // -------------------------------------------------------------------------

  beginSave() {
    const state = get();
    if (state.pendingOps.length === 0) return null;
    if (state.autosaveStatus === "saving") return null;

    const opCount = Math.min(state.pendingOps.length, MAX_OPS_PER_BATCH);
    const ops = state.pendingOps.slice(0, opCount);

    set({
      autosaveStatus: "saving",
      lastSaveOpCount: opCount,
    });

    return { ops, baseVersionId: state.baseVersionId };
  },

  completeSave({ versionId, sceneGraph }) {
    const state = get();
    const remainingOps = state.pendingOps.slice(state.lastSaveOpCount);

    set({
      baseVersionId: versionId,
      serverSceneGraph: sceneGraph,
      pendingOps: remainingOps,
      autosaveStatus: remainingOps.length > 0 ? "pending" : "saved",
      lastSaveError: null,
    });
  },

  failSave(message) {
    set({
      autosaveStatus: "error",
      lastSaveError: message,
    });
    // pendingOps are intentionally NOT cleared — the next autosave tick retries
  },

  rebaseOnServerVersion({ versionId, sceneGraph }) {
    const state = get();
    // Replay ALL pending ops (both "currently saving" and newer) onto the
    // fresh server graph. Skip any op that fails on the new base.
    let rebased = sceneGraph;
    const survivingOps: SceneGraphOp[] = [];

    for (const op of state.pendingOps) {
      try {
        rebased = applyOps(rebased, [op]);
        survivingOps.push(op);
      } catch (err) {
        if (err instanceof OperationError) {
          console.error(
            "[editor-store] rebaseOnServerVersion: dropping incompatible op",
            err.message,
            op
          );
          // This op's edit is lost — the object/spawn it targeted no longer
          // exists on the server graph. Continue replaying the rest.
        } else {
          throw err;
        }
      }
    }

    set({
      baseVersionId: versionId,
      serverSceneGraph: sceneGraph,
      sceneGraph: rebased,
      pendingOps: survivingOps,
      // Undo history is invalid after a rebase — any undo would restore a
      // snapshot from before the server graph changed, reaching an inconsistent
      // state. Clear both stacks.
      undoStack: [],
      redoStack: [],
      autosaveStatus: "pending",
      lastSaveError: null,
    });
  },

  // -------------------------------------------------------------------------
  // Selectors
  // -------------------------------------------------------------------------

  isDirty() {
    return get().pendingOps.length > 0;
  },

  getSelectedObject() {
    const state = get();
    if (!state.selectedObjectId) return undefined;
    return state.sceneGraph.objects.find((o) => o.id === state.selectedObjectId);
  },
});

// ---------------------------------------------------------------------------
// Vanilla store factory (for tests — each test creates a fresh instance)
// ---------------------------------------------------------------------------

export function createEditorStore(): StoreApi<EditorStore> {
  return createStore<EditorStore>(editorStateCreator);
}

// ---------------------------------------------------------------------------
// React-bound store (for editor UI components)
// ---------------------------------------------------------------------------

export const useEditorStore = create<EditorStore>(editorStateCreator);
