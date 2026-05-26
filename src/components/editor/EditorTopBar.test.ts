/**
 * Unit tests for EditorTopBar logic (keyboard shortcut handling + button state).
 *
 * These tests isolate the keyboard shortcut logic from the React component by
 * extracting and testing the handler behaviour using the editor store directly.
 * No DOM mounting required — compatible with the vitest node environment.
 */

import { describe, it, expect, vi } from "vitest";
import { createEditorStore } from "./editor-store";
import { emptySceneGraph } from "@/lib/scene-graph/schema";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORLD_ID = "world-topbar-test";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_ID = "c0000000-0000-4000-8000-000000000003";

function graphWithOneObject(): SceneGraphV1 {
  const base = emptySceneGraph();
  return {
    ...base,
    objects: [
      {
        id: "obj_bar1",
        assetId: ASSET_ID,
        name: "Bar Object",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

/**
 * Simulates the keydown handler logic from EditorTopBar.
 * Returns what action was taken (if any) for assertions.
 */
function simulateKeyDown(
  store: ReturnType<typeof createEditorStore>,
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; tagName?: string }
): "translate" | "rotate" | "scale" | "undo" | "redo" | "deselect" | null {
  const tagName = (event.tagName ?? "div").toLowerCase();
  if (tagName === "input" || tagName === "textarea") return null;

  const modKey = event.ctrlKey || event.metaKey;

  if (modKey && event.shiftKey && event.key.toLowerCase() === "z") {
    store.getState().redo();
    return "redo";
  }
  if (modKey && event.key.toLowerCase() === "z") {
    store.getState().undo();
    return "undo";
  }
  if (modKey && event.key.toLowerCase() === "y") {
    store.getState().redo();
    return "redo";
  }

  if (!modKey && !event.shiftKey) {
    if (event.key === "t" || event.key === "T") {
      store.getState().setGizmoMode("translate");
      return "translate";
    }
    if (event.key === "r" || event.key === "R") {
      store.getState().setGizmoMode("rotate");
      return "rotate";
    }
    if (event.key === "s" || event.key === "S") {
      store.getState().setGizmoMode("scale");
      return "scale";
    }
    if (event.key === "Escape") {
      store.getState().selectObject(null);
      return "deselect";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EditorTopBar — gizmo mode shortcuts", () => {
  it("T key sets gizmoMode to translate", () => {
    const store = createEditorStore();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: emptySceneGraph(), baseVersionId: VERSION_ID });
    store.getState().setGizmoMode("rotate"); // start on a different mode

    simulateKeyDown(store, { key: "T" });

    expect(store.getState().gizmoMode).toBe("translate");
  });

  it("R key sets gizmoMode to rotate", () => {
    const store = createEditorStore();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: emptySceneGraph(), baseVersionId: VERSION_ID });

    simulateKeyDown(store, { key: "R" });

    expect(store.getState().gizmoMode).toBe("rotate");
  });

  it("S key sets gizmoMode to scale", () => {
    const store = createEditorStore();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: emptySceneGraph(), baseVersionId: VERSION_ID });

    simulateKeyDown(store, { key: "S" });

    expect(store.getState().gizmoMode).toBe("scale");
  });

  it("shortcuts are ignored when target is an input element", () => {
    const store = createEditorStore();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: emptySceneGraph(), baseVersionId: VERSION_ID });
    store.getState().setGizmoMode("rotate");

    const result = simulateKeyDown(store, { key: "T", tagName: "input" });

    expect(result).toBeNull();
    expect(store.getState().gizmoMode).toBe("rotate"); // unchanged
  });
});

describe("EditorTopBar — undo/redo shortcuts", () => {
  it("Ctrl+Z triggers undo when undo stack has entries", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: graph, baseVersionId: VERSION_ID });

    // Make a change to populate the undo stack
    store.getState().updateObject("obj_bar1", { name: "Renamed" });
    expect(store.getState().canUndo()).toBe(true);

    simulateKeyDown(store, { key: "z", ctrlKey: true });

    // After undo, object name should revert
    const obj = store.getState().sceneGraph.objects.find((o) => o.id === "obj_bar1");
    expect(obj?.name).toBe("Bar Object");
  });

  it("Ctrl+Z is a no-op when undo stack is empty", () => {
    const store = createEditorStore();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: emptySceneGraph(), baseVersionId: VERSION_ID });

    expect(store.getState().canUndo()).toBe(false);
    const undoSpy = vi.spyOn(store.getState(), "undo");

    simulateKeyDown(store, { key: "z", ctrlKey: true });

    // undo() was called but had no effect (stack was empty)
    // Store state should remain pristine
    expect(store.getState().pendingOps).toHaveLength(0);
    undoSpy.mockRestore();
  });

  it("Ctrl+Shift+Z triggers redo", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: graph, baseVersionId: VERSION_ID });

    store.getState().updateObject("obj_bar1", { name: "Renamed" });
    store.getState().undo(); // populate redo stack

    expect(store.getState().canRedo()).toBe(true);
    simulateKeyDown(store, { key: "z", ctrlKey: true, shiftKey: true });

    const obj = store.getState().sceneGraph.objects.find((o) => o.id === "obj_bar1");
    expect(obj?.name).toBe("Renamed"); // redo applied the rename
  });
});

describe("EditorTopBar — Escape deselects", () => {
  it("Escape key calls selectObject(null)", () => {
    const store = createEditorStore();
    const graph = graphWithOneObject();
    store.getState().initialize({ worldId: WORLD_ID, sceneGraph: graph, baseVersionId: VERSION_ID });
    store.getState().selectObject("obj_bar1");

    expect(store.getState().selectedObjectId).toBe("obj_bar1");

    simulateKeyDown(store, { key: "Escape" });

    expect(store.getState().selectedObjectId).toBeNull();
  });
});
