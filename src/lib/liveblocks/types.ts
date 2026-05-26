/**
 * Per-user presence published while in walk mode on /world/[id].
 *
 * Updated ~10x/sec while moving. `null` when the user just connected and
 * hasn't entered walk mode yet (i.e., they're still on the Enter CTA).
 */
export interface VisitorPresence {
  mode: "visitor";
  position: [number, number, number] | null;
  yaw: number;        // radians; ignored when position is null
  pitch: number;      // radians
  inWalkMode: boolean;
}

/**
 * Per-user presence published while editing a world at /world/[id]/edit.
 *
 * Updated ~10x/sec while the cursor moves. Cursor world-position is null
 * when the pointer is outside the R3F canvas.
 *
 * NOTE: camera position is intentionally omitted from v1 editor presence.
 * Add when the first camera-frustum consumer (e.g. "look at where they're
 * looking") actually ships — see Slice 10.1 §8.
 */
export interface EditorPresence {
  mode: "editor";
  /** World-space raycast hit from the editor's cursor. null when pointer is outside the canvas. */
  cursorWorldPos: [number, number, number] | null;
  /** The object the editor currently has selected (their cyan gizmo target). */
  selectedObjectId: string | null;
  /** Current transform-gizmo mode. */
  gizmoMode: "translate" | "rotate" | "scale";
}

/** Discriminated union of all presence shapes used in FORGE Liveblocks rooms. */
export type UserPresence = VisitorPresence | EditorPresence;

// ---------------------------------------------------------------------------
// Initial-presence constants — single source of truth for both pages.
// ---------------------------------------------------------------------------

/** Pass as `initialPresence` to LiveblocksRoomProvider on /world/[id]. */
export const INITIAL_VISITOR_PRESENCE: VisitorPresence = {
  mode: "visitor",
  position: null,
  yaw: 0,
  pitch: 0,
  inWalkMode: false,
};

/** Pass as `initialPresence` to LiveblocksRoomProvider on /world/[id]/edit. */
export const INITIAL_EDITOR_PRESENCE: EditorPresence = {
  mode: "editor",
  cursorWorldPos: null,
  selectedObjectId: null,
  gizmoMode: "translate",
};

// ---------------------------------------------------------------------------
// Pure type-guard helpers — used by PresenceLayer (visitor side) and
// EditorPresenceLayer (Chunk 2) to filter useOthers() results.
// ---------------------------------------------------------------------------

/**
 * True iff the presence belongs to a visitor who is in walk mode with a valid
 * position. Used by PresenceLayer to decide whether to render a capsule avatar.
 */
export function isWalkingVisitor(
  p: UserPresence | null | undefined,
): p is VisitorPresence & { position: [number, number, number] } {
  return (
    !!p && p.mode === "visitor" && p.inWalkMode && p.position !== null
  );
}

/**
 * True iff the presence belongs to an editor. Used by EditorPresenceLayer
 * and EditorCollaborators (Chunk 2/3) to filter useOthers().
 */
export function isEditor(p: UserPresence | null | undefined): p is EditorPresence {
  return !!p && p.mode === "editor";
}

/**
 * UserInfo attached at JWT issue time. Stable for the lifetime of one
 * Liveblocks session (a session per page-load).
 */
export interface VisitorUserInfo {
  name: string;        // either @username (signed-in) or Guest_XXXX (anon)
  avatarUrl: string | null;
  color: string;       // HSL string like "hsl(214, 85%, 60%)"
  isGuest: boolean;
}

/**
 * Broadcast room events. Single discriminated union — chat in v1; more later.
 */
export type RoomEvent =
  | { type: "chat"; text: string }; // 280-char cap enforced client-side

/**
 * Stable Liveblocks room ID for a world. Used in the API auth route's
 * `session.allow()` AND in the client's `<RoomProvider id={...}>`.
 */
export function worldRoomId(worldId: string): string {
  return `world:${worldId}`;
}
