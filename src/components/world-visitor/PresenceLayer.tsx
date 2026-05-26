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
import type { UserPresence, VisitorUserInfo } from "@/lib/liveblocks/types";
import { isWalkingVisitor } from "@/lib/liveblocks/types";
import { VisitorAvatar } from "./VisitorAvatar";

export function PresenceLayer() {
  const others = useOthers();

  return (
    <>
      {others.map((other) => {
        // Cast to our concrete union type. The global `Liveblocks.Presence`
        // augmentation wires UserPresence, but TypeScript cannot narrow tuple
        // types (e.g. `[number, number, number]`) back out of Liveblocks's Json
        // constraint. The cast is safe: the server auth endpoint and WalkMode
        // presence-push both produce exactly the typed shapes.
        const presence = other.presence as unknown as UserPresence | null;
        // other.info is the VisitorUserInfo set server-side via prepareSession.
        // Liveblocks v3 exposes it directly as other.info (NOT other.user.info).
        const info = other.info as unknown as VisitorUserInfo | undefined;

        // isWalkingVisitor narrows to VisitorPresence & { position: [n,n,n] },
        // so `presence.position` below is guaranteed non-null.
        // Crucially this also filters out editor-mode presence, keeping the
        // visitor viewport free of editor entries.
        if (!isWalkingVisitor(presence)) return null;
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
