/**
 * Liveblocks global type augmentation.
 *
 * This file registers our application-specific types on the global
 * `Liveblocks` namespace that `@liveblocks/core` declares.  Once this
 * augmentation is in scope, every hook from `@liveblocks/react` is
 * fully typed:
 *
 *   useMyPresence()  → [UserPresence, (patch) => void]
 *   useOthers()      → User<UserPresence, { id: string; info: VisitorUserInfo }>[]
 *   useBroadcastEvent() → (event: RoomEvent) => void
 *   useEventListener(cb) → cb receives RoomEvent
 *
 * Placement: a separate `.d.ts` file rather than appending to `types.ts`
 * keeps this as pure type augmentation — no runtime import needed.  TypeScript
 * picks it up automatically because it lives inside `src/` which is covered by
 * `tsconfig.json`'s `include`.
 *
 * Presence is the `UserPresence` discriminated union (VisitorPresence |
 * EditorPresence). Both visitor and editor pages share the same Liveblocks room
 * per world; the `mode` field lets each surface filter out irrelevant entries.
 *
 * Storage is intentionally empty (`Record<string, never>`): Slice 9.3 uses
 * presence + broadcast events for position sync and chat.  Shared persistent
 * storage (LiveObject) is not used in v1.
 */

import type { UserPresence, VisitorUserInfo, RoomEvent } from "./types";

declare global {
  interface Liveblocks {
    Presence: UserPresence;
    UserMeta: {
      id: string;
      info: VisitorUserInfo;
    };
    RoomEvent: RoomEvent;
    /** No shared persistent storage in v1. */
    Storage: Record<string, never>;
  }
}
