/**
 * Per-user presence published while in walk mode on /world/[id].
 *
 * Updated ~10x/sec while moving. `null` when the user just connected and
 * hasn't entered walk mode yet (i.e., they're still on the Enter CTA).
 */
export interface VisitorPresence {
  position: [number, number, number] | null;
  yaw: number;        // radians; ignored when position is null
  pitch: number;      // radians
  inWalkMode: boolean;
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
