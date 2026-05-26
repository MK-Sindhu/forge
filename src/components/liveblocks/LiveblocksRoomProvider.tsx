"use client";

/**
 * LiveblocksRoomProvider
 *
 * Wraps children in the two Liveblocks React layers required for multi-user
 * presence and chat:
 *
 *   <LiveblocksProvider authEndpoint={...}>   ← sets up auth + client
 *     <RoomProvider id={roomId} ...>          ← joins the specific room
 *       {children}                            ← descendants can call all hooks
 *     </RoomProvider>
 *   </LiveblocksProvider>
 *
 * Pattern rationale:
 *   v3.19 exports `LiveblocksProvider` (takes ClientOptions directly, including
 *   authEndpoint) and `RoomProvider` (joins a specific room by id).  This is
 *   the canonical two-layer approach documented in the v3 SDK.  The older
 *   `createRoomContext` factory is still exported but is for the "scoped hooks"
 *   pattern where you want separate, isolated hook sets per context.  We do NOT
 *   need that here: a single global `useOthers()` / `useMyPresence()` etc. is
 *   exactly what the visitors page wants.
 *
 * Auth callback strategy:
 *   We always send `guestId` along with the room id.  The auth endpoint at
 *   /api/liveblocks/auth ignores `guestId` when a Clerk session is present
 *   (signed-in path).  This keeps the client simple — it doesn't need to know
 *   whether the user is signed in.  The server is the authority on identity.
 *
 * Connection lifecycle + presence:
 *   The provider connects as soon as it mounts, even before the user clicks
 *   "Enter world" (i.e., while they're still on the preview screen).  Their
 *   initial presence has `position: null` and `inWalkMode: false`.  Chunk 5
 *   (PresenceLayer) only renders avatars for users with `position !== null`, so
 *   a user in preview mode is connected but invisible in the 3D scene — which
 *   is exactly the right behaviour.
 *
 * SSR:
 *   LiveblocksProvider is SSR-safe — it renders {children} without opening a
 *   WebSocket connection until effects run on the client.  No `dynamic` wrapper
 *   is needed.  The build confirms this.
 */

import React, { useMemo } from "react";
import { LiveblocksProvider, RoomProvider } from "@liveblocks/react";
import { worldRoomId, type VisitorPresence } from "@/lib/liveblocks/types";
import { getOrCreateGuestId } from "@/lib/guest-id";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** The FORGE world uuid — converted to "world:{id}" internally. */
  worldId: string;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Initial presence
// ---------------------------------------------------------------------------

// Cast needed: JsonObject requires an index signature (`[key: string]: Json`)
// that our specific VisitorPresence interface doesn't declare.  Once the
// `Liveblocks.Presence = VisitorPresence` global augmentation is resolved by
// TypeScript, `RoomProvider`'s generic picks it up correctly at the hook level.
// The cast here is safe — all fields on VisitorPresence are JSON-serializable.
const initialPresence = {
  position: null,
  yaw: 0,
  pitch: 0,
  inWalkMode: false,
} satisfies VisitorPresence;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LiveblocksRoomProvider({ worldId, children }: Props) {
  const roomId = worldRoomId(worldId);

  /**
   * authEndpoint: function variant so we can inject guestId into the body.
   * Strategy (a): always send guestId.  The server uses it only on the guest
   * path (no Clerk session).  For signed-in users the server ignores it.
   *
   * The Liveblocks AuthEndpoint type declares `room?: string` (optional) even
   * though the SDK always supplies the current room id when called from
   * RoomProvider.  We fall back to `worldId` directly if for any reason the
   * SDK passes undefined — which keeps our server validation happy (it expects
   * a UUID string in the `room` field).
   *
   * useMemo so the function reference is stable across re-renders — avoids
   * Liveblocks re-creating its internal client on every render.
   */
  const authEndpoint = useMemo(
    () =>
      async (room?: string) => {
        const guestId = getOrCreateGuestId();
        const res = await fetch("/api/liveblocks/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // `room` is the canonical room id ("world:{uuid}") supplied by the
          // SDK.  The auth endpoint extracts the uuid from it.  Fall back to
          // worldId directly (the plain uuid) if the SDK omits it.
          body: JSON.stringify({ room: room ?? worldId, guestId }),
        });
        if (!res.ok) {
          throw new Error(`Liveblocks auth failed: ${res.status}`);
        }
        return res.json() as Promise<{ token: string }>;
      },
    [worldId]
  );

  return (
    <LiveblocksProvider authEndpoint={authEndpoint}>
      <RoomProvider id={roomId} initialPresence={initialPresence}>
        {children}
      </RoomProvider>
    </LiveblocksProvider>
  );
}
