"use client";

// PresenceLayer — renders capsule avatars for all OTHER visitors currently
// connected to this room with an active walk-mode presence.
//
// Rendered inside the R3F Canvas in WorldVisitor. Always mounted regardless of
// whether the local user is in preview or walk mode — you should be able to see
// other people moving around even before you click "Enter world" yourself.
//
// Info access (Liveblocks v3):
//   other.info — directly on the User object (as User["info"] which resolves to
//   VisitorUserInfo from the global augmentation in types.d.ts). NOT nested under
//   other.user.info. The v3 SDK exposes id/info at the top level of the User shape.
//
// Cluster-at-spawn limitation (documented):
//   All users who just entered walk mode start at the same spawn point. Their
//   avatars will overlap until they move. Acceptable for v1 — users naturally
//   drift apart as they walk.
//
// Smoothing:
//   No lerp smoothing in v1. Liveblocks updates presence ~10 times/sec by default;
//   raw position-set produces minor visual jumps but is acceptable at that rate.
//   A lerp pass can be added in a follow-up slice if the jitter is distracting.

import { useOthers } from "@liveblocks/react";
import type { VisitorPresence, VisitorUserInfo } from "@/lib/liveblocks/types";
import { VisitorAvatar } from "./VisitorAvatar";

export function PresenceLayer() {
  const others = useOthers();

  return (
    <>
      {others.map((other) => {
        // Cast to our concrete types. The global `Liveblocks.Presence` augmentation
        // wires these types, but TypeScript cannot narrow tuple types (e.g.
        // `[number, number, number]`) back out of Liveblocks's Json constraint —
        // the constraint system widens them on the way in and doesn't recover the
        // tuple on the way out. The cast is safe: the server auth endpoint and the
        // WalkMode presence-push both produce exactly VisitorPresence-shaped data.
        const presence = other.presence as unknown as VisitorPresence;
        // other.info is the VisitorUserInfo set server-side via prepareSession.
        // Liveblocks v3 exposes it directly as other.info (NOT other.user.info).
        const info = other.info as unknown as VisitorUserInfo | undefined;

        // Skip users who haven't entered walk mode or whose info hasn't arrived.
        if (!presence?.position) return null;
        if (!presence.inWalkMode) return null;
        if (!info) return null;

        return (
          <VisitorAvatar
            key={other.connectionId}
            position={presence.position}
            yaw={presence.yaw ?? 0}
            name={info.name}
            color={info.color}
            isGuest={info.isGuest}
          />
        );
      })}
    </>
  );
}
