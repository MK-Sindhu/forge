/**
 * types.test.ts — unit tests for liveblocks/types.ts
 *
 * All helpers are pure functions — no mocks needed.
 */

import { describe, it, expect } from "vitest";
import {
  worldRoomId,
  isWalkingVisitor,
  isEditor,
  INITIAL_VISITOR_PRESENCE,
  INITIAL_EDITOR_PRESENCE,
} from "./types";
import type { VisitorPresence, EditorPresence } from "./types";

describe("worldRoomId", () => {
  it("returns world:<uuid> for the given worldId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(worldRoomId(uuid)).toBe(`world:${uuid}`);
  });

  it("works for any arbitrary string worldId (not just uuids)", () => {
    expect(worldRoomId("abc")).toBe("world:abc");
    expect(worldRoomId("")).toBe("world:");
  });
});

// ---------------------------------------------------------------------------
// isWalkingVisitor
// ---------------------------------------------------------------------------

describe("isWalkingVisitor", () => {
  it("returns true for a visitor presence with inWalkMode=true and a non-null position", () => {
    const p: VisitorPresence = {
      mode: "visitor",
      position: [1, 0, 2],
      yaw: 0,
      pitch: 0,
      inWalkMode: true,
    };
    expect(isWalkingVisitor(p)).toBe(true);
  });

  it("returns false for a visitor presence with inWalkMode=false", () => {
    const p: VisitorPresence = {
      mode: "visitor",
      position: [1, 0, 2],
      yaw: 0,
      pitch: 0,
      inWalkMode: false,
    };
    expect(isWalkingVisitor(p)).toBe(false);
  });

  it("returns false for a visitor presence with position=null", () => {
    const p: VisitorPresence = {
      mode: "visitor",
      position: null,
      yaw: 0,
      pitch: 0,
      inWalkMode: true,
    };
    expect(isWalkingVisitor(p)).toBe(false);
  });

  it("returns false for an editor presence", () => {
    const p: EditorPresence = {
      mode: "editor",
      cursorWorldPos: null,
      selectedObjectId: null,
      gizmoMode: "translate",
    };
    expect(isWalkingVisitor(p)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isWalkingVisitor(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isWalkingVisitor(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isEditor
// ---------------------------------------------------------------------------

describe("isEditor", () => {
  it("returns true for an editor presence", () => {
    const p: EditorPresence = {
      mode: "editor",
      cursorWorldPos: [1, 2, 3],
      selectedObjectId: "obj_abc",
      gizmoMode: "rotate",
    };
    expect(isEditor(p)).toBe(true);
  });

  it("returns false for a visitor presence", () => {
    const p: VisitorPresence = {
      mode: "visitor",
      position: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      inWalkMode: true,
    };
    expect(isEditor(p)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isEditor(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isEditor(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Initial presence constants — discriminant checks
// ---------------------------------------------------------------------------

describe("INITIAL_VISITOR_PRESENCE", () => {
  it("has mode='visitor'", () => {
    expect(INITIAL_VISITOR_PRESENCE.mode).toBe("visitor");
  });

  it("has inWalkMode=false and position=null (not yet in walk mode)", () => {
    expect(INITIAL_VISITOR_PRESENCE.inWalkMode).toBe(false);
    expect(INITIAL_VISITOR_PRESENCE.position).toBeNull();
  });
});

describe("INITIAL_EDITOR_PRESENCE", () => {
  it("has mode='editor'", () => {
    expect(INITIAL_EDITOR_PRESENCE.mode).toBe("editor");
  });

  it("has cursorWorldPos=null and gizmoMode='translate'", () => {
    expect(INITIAL_EDITOR_PRESENCE.cursorWorldPos).toBeNull();
    expect(INITIAL_EDITOR_PRESENCE.gizmoMode).toBe("translate");
  });
});
