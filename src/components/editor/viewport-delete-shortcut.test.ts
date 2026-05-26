/**
 * Unit tests for the Viewport Delete shortcut handler.
 *
 * The handler is extracted as a pure function `handleDeleteKey` below —
 * identical logic to what's in the useEffect inside Viewport.tsx. This lets
 * us test it against the Zustand store directly without mounting a Canvas.
 *
 * Vitest environment: "node" (set in vitest.config.ts) — no DOM required.
 */

import { describe, it, expect } from "vitest";
import { createEditorStore } from "./editor-store";
import { emptySceneGraph } from "@/lib/scene-graph/schema";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORLD_ID = "world-viewport-test";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "d0000000-0000-4000-8000-000000000004";

function graphWithOneObject(objectId = "obj_vp1"): SceneGraphV1 {
  const base = emptySceneGraph();
  return {
    ...base,
    objects: [
      {
        id: objectId,
        assetId: ASSET_ID,
        name: "Viewport Object",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

/**
 * Pure function that mirrors the useEffect keydown handler in Viewport.tsx.
 *
 * Returns true if deleteSelectedObject() was called, false otherwise.
 * The store mutation happens as a side effect.
 */
function handleDeleteKey(
  store: ReturnType<typeof createEditorStore>,
  event: { key: string; tagName?: string; isContentEditable?: boolean }
): boolean {
  const { selectedObjectId } = store.getState();
  if (!selectedObjectId) return false;

  const tagName = (event.tagName ?? "div").toLowerCase();
  if (
    tagName === "input" ||
    tagName === "textarea" ||
    event.isContentEditable
  ) {
    return false;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    store.getState().deleteSelectedObject();
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Viewport — Delete shortcut handler", () => {
  it("Delete key removes the selected object from the scene graph", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp1"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp1");

    expect(store.getState().sceneGraph.objects).toHaveLength(1);

    const handled = handleDeleteKey(store, { key: "Delete" });

    expect(handled).toBe(true);
    expect(store.getState().sceneGraph.objects).toHaveLength(0);
  });

  it("Backspace key also removes the selected object", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp2"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp2");

    const handled = handleDeleteKey(store, { key: "Backspace" });

    expect(handled).toBe(true);
    expect(store.getState().sceneGraph.objects).toHaveLength(0);
    // Selection is cleared after deletion
    expect(store.getState().selectedObjectId).toBeNull();
  });

  it("Delete key is a no-op when nothing is selected", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp3"),
      baseVersionId: VERSION_ID,
    });
    // No selectObject call — selectedObjectId remains null

    const handled = handleDeleteKey(store, { key: "Delete" });

    expect(handled).toBe(false);
    expect(store.getState().sceneGraph.objects).toHaveLength(1);
  });

  it("Delete key is ignored when focus is in an input element", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp4"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp4");

    const handled = handleDeleteKey(store, { key: "Delete", tagName: "input" });

    expect(handled).toBe(false);
    // Object should still exist
    expect(store.getState().sceneGraph.objects).toHaveLength(1);
  });

  it("Delete key is ignored when focus is in a textarea element", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp5"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp5");

    const handled = handleDeleteKey(store, {
      key: "Delete",
      tagName: "textarea",
    });

    expect(handled).toBe(false);
    expect(store.getState().sceneGraph.objects).toHaveLength(1);
  });

  it("Delete key is ignored when focus is in a contentEditable element", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp6"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp6");

    const handled = handleDeleteKey(store, {
      key: "Delete",
      isContentEditable: true,
    });

    expect(handled).toBe(false);
    expect(store.getState().sceneGraph.objects).toHaveLength(1);
  });

  it("other keys do not trigger deletion", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp7"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp7");

    const handled = handleDeleteKey(store, { key: "d" });

    expect(handled).toBe(false);
    expect(store.getState().sceneGraph.objects).toHaveLength(1);
  });

  it("deletion adds an op to pendingOps (undo-able)", () => {
    const store = createEditorStore();
    store.getState().initialize({
      worldId: WORLD_ID,
      sceneGraph: graphWithOneObject("obj_vp8"),
      baseVersionId: VERSION_ID,
    });
    store.getState().selectObject("obj_vp8");

    handleDeleteKey(store, { key: "Delete" });

    expect(store.getState().pendingOps).toHaveLength(1);
    expect(store.getState().pendingOps[0].op).toBe("delete_object");
    expect(store.getState().canUndo()).toBe(true);
  });
});
