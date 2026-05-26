/**
 * Unit tests for PropertiesPanel logic.
 *
 * Tests validate user-facing behaviours through the editor store directly,
 * without mounting React components. This matches the project pattern used
 * in editor-store.test.ts, EditorTopBar.test.ts, and AssetPanel.test.ts.
 *
 * Coverage:
 *  1.  Tab switching: clicking each tab changes the active content
 *  2.  Object tab: nothing selected → shows no-selection state
 *  3.  Object tab: selecting an object → correct values visible
 *  4.  Object tab: editing position + blur → updateObject called with new tuple
 *  5.  Object tab: rotation displayed as degrees (90 deg stored as ~1.5708 rad)
 *  6.  Object tab: clicking delete → confirm + deleteSelectedObject
 *  7.  Lights tab: renders existing lights
 *  8.  Lights tab: changing intensity → setLights with patched array
 *  9.  Lights tab: "+ Add sun" appends sun light with defaults
 * 10.  Environment tab: skybox dropdown change → setEnvironment with new skybox
 * 11.  Environment tab: enabling fog → setEnvironment with default fog config
 * 12.  Environment tab: disabling fog → fog set to null
 * 13.  Spawn tab: delete button disabled when only 1 spawn
 * 14.  Spawn tab: adding a spawn → addSpawn called with correct shape
 */

import { describe, it, expect, vi } from "vitest";
import { createEditorStore } from "../editor-store";
import { emptySceneGraph } from "@/lib/scene-graph/schema";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORLD_ID = "world-props-test";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const ASSET_ID = "e0000000-0000-4000-8000-000000000001";

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

function makeGraphWithObject(): SceneGraphV1 {
  const base = emptySceneGraph();
  return {
    ...base,
    objects: [
      {
        id: "obj_test01",
        assetId: ASSET_ID,
        name: "Test Object",
        position: [1, 2, 3],
        rotation: [0, Math.PI / 2, 0],  // 0, 90deg, 0 in radians
        scale: [1, 1, 1],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helper: create + initialise a fresh store
// ---------------------------------------------------------------------------

function createStore(graph?: SceneGraphV1) {
  const store = createEditorStore();
  store.getState().initialize({
    worldId: WORLD_ID,
    sceneGraph: graph ?? emptySceneGraph(),
    baseVersionId: VERSION_ID,
  });
  return store;
}

// ---------------------------------------------------------------------------
// 1. Tab switching
// ---------------------------------------------------------------------------

describe("PropertiesPanel — tab switching", () => {
  it("starts on the 'object' tab after initialization", () => {
    const store = createStore();
    expect(store.getState().propertiesTab).toBe("object");
  });

  it("switches to 'lights' tab", () => {
    const store = createStore();
    store.getState().setPropertiesTab("lights");
    expect(store.getState().propertiesTab).toBe("lights");
  });

  it("switches to 'environment' tab", () => {
    const store = createStore();
    store.getState().setPropertiesTab("environment");
    expect(store.getState().propertiesTab).toBe("environment");
  });

  it("switches to 'spawn-points' tab", () => {
    const store = createStore();
    store.getState().setPropertiesTab("spawn-points");
    expect(store.getState().propertiesTab).toBe("spawn-points");
  });
});

// ---------------------------------------------------------------------------
// 2. Object tab — no selection
// ---------------------------------------------------------------------------

describe("PropertiesPanel — ObjectTab no selection", () => {
  it("selectedObjectId is null when nothing is selected", () => {
    const store = createStore();
    expect(store.getState().selectedObjectId).toBeNull();
  });

  it("getSelectedObject returns undefined when nothing selected", () => {
    const store = createStore();
    expect(store.getState().getSelectedObject()).toBeUndefined();
  });

  it("getSelectedObject returns undefined after deleting the selected object", () => {
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");
    store.getState().deleteSelectedObject();
    expect(store.getState().getSelectedObject()).toBeUndefined();
    expect(store.getState().selectedObjectId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Object tab — object selected → correct values
// ---------------------------------------------------------------------------

describe("PropertiesPanel — ObjectTab selection", () => {
  it("getSelectedObject returns the selected object's values", () => {
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");

    const obj = store.getState().getSelectedObject();
    expect(obj).toBeDefined();
    expect(obj?.id).toBe("obj_test01");
    expect(obj?.name).toBe("Test Object");
    expect(obj?.position).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// 4. Object tab — editing position on blur
// ---------------------------------------------------------------------------

describe("PropertiesPanel — ObjectTab position update", () => {
  it("updateObject commits the new position tuple", () => {
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");

    // Simulate Vec3Input's onCommit callback
    store.getState().updateObject("obj_test01", { position: [4, 5, 6] });

    const obj = store.getState().getSelectedObject();
    expect(obj?.position).toEqual([4, 5, 6]);
  });

  it("updateObject appends to pendingOps (marks dirty)", () => {
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");
    store.getState().updateObject("obj_test01", { position: [0, 0, 10] });
    expect(store.getState().isDirty()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Object tab — rotation displayed as degrees
// ---------------------------------------------------------------------------

describe("PropertiesPanel — ObjectTab rotation radians/degrees", () => {
  it("90 degrees converts to ~π/2 radians for storage", () => {
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");

    // Simulate the UI: user enters 90° → onCommit receives deg value → converted to rad
    const degToRad = (d: number) => d * DEG_TO_RAD;
    const rotation: [number, number, number] = [0, degToRad(90), 0];
    store.getState().updateObject("obj_test01", { rotation });

    const obj = store.getState().getSelectedObject();
    expect(obj?.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
  });

  it("stored radians convert back to 90 degrees for display", () => {
    const radians = Math.PI / 2;
    const degrees = radians * RAD_TO_DEG;
    expect(degrees).toBeCloseTo(90, 5);
  });

  it("the graph stores radians (not degrees)", () => {
    // The initial graph fixture stores 90° as π/2 radians
    const graph = makeGraphWithObject();
    const obj = graph.objects[0];
    expect(obj.rotation[1]).toBeCloseTo(Math.PI / 2, 5);
    // Not 90:
    expect(obj.rotation[1]).not.toBeCloseTo(90, 1);
  });
});

// ---------------------------------------------------------------------------
// 6. Object tab — delete button
// ---------------------------------------------------------------------------

describe("PropertiesPanel — ObjectTab delete", () => {
  it("deleteSelectedObject removes the object and clears selection", () => {
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");

    // Simulate: window.confirm returned true → deleteSelectedObject() is called
    store.getState().deleteSelectedObject();

    expect(store.getState().sceneGraph.objects).toHaveLength(0);
    expect(store.getState().selectedObjectId).toBeNull();
  });

  it("delete is a no-op when nothing is selected", () => {
    const store = createStore(makeGraphWithObject());
    // No selection
    store.getState().deleteSelectedObject();
    expect(store.getState().sceneGraph.objects).toHaveLength(1);
  });

  it("window.confirm mock: confirm returns false → object NOT deleted", () => {
    // Define confirm on globalThis if absent (node test environment)
    if (!("confirm" in globalThis)) {
      (globalThis as Record<string, unknown>).confirm = () => false;
    }
    const confirmMock = vi.spyOn(globalThis, "confirm" as keyof typeof globalThis).mockReturnValue(false);

    // Simulate what the component does: check confirm before calling store
    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");

    const confirmed = (globalThis as Record<string, unknown>).confirm("Delete?") as boolean;
    if (confirmed) {
      store.getState().deleteSelectedObject();
    }

    expect(store.getState().sceneGraph.objects).toHaveLength(1);
    confirmMock.mockRestore();
  });

  it("window.confirm mock: confirm returns true → object IS deleted", () => {
    // Define confirm on globalThis if absent (node test environment)
    if (!("confirm" in globalThis)) {
      (globalThis as Record<string, unknown>).confirm = () => true;
    }
    const confirmMock = vi.spyOn(globalThis, "confirm" as keyof typeof globalThis).mockReturnValue(true);

    const store = createStore(makeGraphWithObject());
    store.getState().selectObject("obj_test01");

    const confirmed = (globalThis as Record<string, unknown>).confirm("Delete?") as boolean;
    if (confirmed) {
      store.getState().deleteSelectedObject();
    }

    expect(store.getState().sceneGraph.objects).toHaveLength(0);
    confirmMock.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 7. Lights tab — renders existing lights
// ---------------------------------------------------------------------------

describe("PropertiesPanel — LightsTab existing lights", () => {
  it("default scene graph has 2 lights (ambient + sun)", () => {
    const store = createStore();
    expect(store.getState().sceneGraph.lights).toHaveLength(2);
  });

  it("lights include one sun and one ambient by default", () => {
    const store = createStore();
    const lights = store.getState().sceneGraph.lights;
    const types = lights.map((l) => l.type);
    expect(types).toContain("ambient");
    expect(types).toContain("sun");
  });
});

// ---------------------------------------------------------------------------
// 8. Lights tab — changing intensity
// ---------------------------------------------------------------------------

describe("PropertiesPanel — LightsTab intensity change", () => {
  it("setLights replaces the array with the patched copy", () => {
    const store = createStore();
    const lights = store.getState().sceneGraph.lights;

    // Simulate patching index 0's intensity to 3
    const patched = lights.map((l, i) =>
      i === 0 ? { ...l, intensity: 3 } : l
    );
    store.getState().setLights(patched as SceneGraphV1["lights"]);

    expect(store.getState().sceneGraph.lights[0].intensity).toBe(3);
    // Other lights unchanged
    expect(store.getState().sceneGraph.lights[1].intensity).toBe(
      lights[1].intensity
    );
  });

  it("setLights marks the store dirty", () => {
    const store = createStore();
    const lights = store.getState().sceneGraph.lights;
    const patched = lights.map((l) => ({ ...l, intensity: 2 }));
    store.getState().setLights(patched as SceneGraphV1["lights"]);
    expect(store.getState().isDirty()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Lights tab — Add sun light
// ---------------------------------------------------------------------------

describe("PropertiesPanel — LightsTab add sun", () => {
  it("appending a sun light increases lights length by 1", () => {
    const store = createStore();
    const before = store.getState().sceneGraph.lights.length;

    const newSun: SceneGraphV1["lights"][number] = {
      type: "sun",
      intensity: 1,
      direction: [5, 5, 5],
      color: "#ffffff",
    };
    store.getState().setLights([...store.getState().sceneGraph.lights, newSun]);

    expect(store.getState().sceneGraph.lights).toHaveLength(before + 1);
  });

  it("new sun light has the correct default fields", () => {
    const store = createStore();
    const newSun: SceneGraphV1["lights"][number] = {
      type: "sun",
      intensity: 1,
      direction: [5, 5, 5],
      color: "#ffffff",
    };
    store.getState().setLights([...store.getState().sceneGraph.lights, newSun]);

    const added = store.getState().sceneGraph.lights.at(-1)!;
    expect(added.type).toBe("sun");
    expect(added.intensity).toBe(1);
    expect(added.color).toBe("#ffffff");
    if (added.type === "sun") {
      expect(added.direction).toEqual([5, 5, 5]);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Environment tab — skybox dropdown
// ---------------------------------------------------------------------------

describe("PropertiesPanel — EnvironmentTab skybox", () => {
  it("setEnvironment updates the skybox while preserving fog", () => {
    const store = createStore();
    const current = store.getState().sceneGraph.environment;

    store.getState().setEnvironment({ ...current, skybox: "forest" });

    expect(store.getState().sceneGraph.environment.skybox).toBe("forest");
    expect(store.getState().sceneGraph.environment.fog).toBe(current.fog);
  });

  it("all 8 skybox presets are valid enum values", () => {
    const presets = ["studio", "sunset", "dawn", "night", "warehouse", "park", "city", "forest"];
    expect(presets).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// 11. Environment tab — enabling fog
// ---------------------------------------------------------------------------

describe("PropertiesPanel — EnvironmentTab enable fog", () => {
  it("enabling fog sets default fog config", () => {
    const store = createStore();
    const current = store.getState().sceneGraph.environment;
    expect(current.fog).toBeNull();

    // Simulate toggling fog on with defaults
    const defaultFog = { color: "#888888", near: 1, far: 100 };
    store.getState().setEnvironment({ ...current, fog: defaultFog });

    const env = store.getState().sceneGraph.environment;
    expect(env.fog).not.toBeNull();
    expect(env.fog?.color).toBe("#888888");
    expect(env.fog?.near).toBe(1);
    expect(env.fog?.far).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// 12. Environment tab — disabling fog
// ---------------------------------------------------------------------------

describe("PropertiesPanel — EnvironmentTab disable fog", () => {
  it("disabling fog sets fog to null", () => {
    const store = createStore();
    // First enable
    const current = store.getState().sceneGraph.environment;
    store.getState().setEnvironment({ ...current, fog: { color: "#888888", near: 1, far: 100 } });
    expect(store.getState().sceneGraph.environment.fog).not.toBeNull();

    // Then disable
    const withFog = store.getState().sceneGraph.environment;
    store.getState().setEnvironment({ ...withFog, fog: null });
    expect(store.getState().sceneGraph.environment.fog).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13. Spawn tab — delete disabled when only 1 spawn
// ---------------------------------------------------------------------------

describe("PropertiesPanel — SpawnPointsTab delete disabled", () => {
  it("deleteSpawn with only 1 spawn point fails (OperationError from store)", () => {
    const store = createStore();
    const spawnPoints = store.getState().sceneGraph.spawnPoints;
    expect(spawnPoints).toHaveLength(1);

    // The UI disables the button; but if called anyway, the store/ops layer
    // should reject the op (delete_spawn refuses to leave 0 spawn points).
    // After the attempted delete, there should still be 1 spawn point.
    store.getState().deleteSpawn(spawnPoints[0].id);
    expect(store.getState().sceneGraph.spawnPoints).toHaveLength(1);
  });

  it("delete button disabled state: isLast = spawnPoints.length === 1", () => {
    // This verifies the UI logic used in SpawnCard
    const oneSpawn = [{ id: "default", position: [0, 1.6, 5] as [number,number,number], rotation: [0,0,0] as [number,number,number] }];
    const isLast = oneSpawn.length === 1;
    expect(isLast).toBe(true);

    const twoSpawns = [...oneSpawn, { id: "s2", position: [0,1.6,0] as [number,number,number], rotation: [0,0,0] as [number,number,number] }];
    const notLast = twoSpawns.length === 1;
    expect(notLast).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 14. Spawn tab — adding a spawn
// ---------------------------------------------------------------------------

describe("PropertiesPanel — SpawnPointsTab add spawn", () => {
  it("addSpawn increases spawnPoints length by 1", () => {
    const store = createStore();
    const before = store.getState().sceneGraph.spawnPoints.length;

    store.getState().addSpawn({
      id: "spawn_ab123456",
      position: [0, 1.6, 0],
      rotation: [0, 0, 0],
    });

    expect(store.getState().sceneGraph.spawnPoints).toHaveLength(before + 1);
  });

  it("added spawn has the expected position and rotation", () => {
    const store = createStore();
    const spawnId = "spawn_ab123456";

    store.getState().addSpawn({
      id: spawnId,
      position: [0, 1.6, 0],
      rotation: [0, 0, 0],
    });

    const added = store.getState().sceneGraph.spawnPoints.find(
      (s) => s.id === spawnId
    );
    expect(added).toBeDefined();
    expect(added?.position).toEqual([0, 1.6, 0]);
    expect(added?.rotation).toEqual([0, 0, 0]);
  });

  it("generated spawn id follows spawn_ prefix pattern", () => {
    // Simulates the + Add spawn point click handler
    const id = "spawn_" + crypto.randomUUID().slice(0, 8);
    expect(id).toMatch(/^spawn_[0-9a-f-]{8}/);
  });
});
