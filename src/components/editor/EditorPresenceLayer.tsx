"use client";

/**
 * EditorPresenceLayer — R3F Canvas component that renders remote editors'
 * cursors and selection outlines.
 *
 * Must be rendered inside a <Canvas> tree. Calls useOthers() to get the
 * current list of other connected users, filters to editors only (skips
 * visitors in walk mode, spectators, disconnected users), then renders one
 * <RemoteEditorCursor> + (optionally) one <RemoteEditorSelectionOutline>
 * per remote editor.
 *
 * Filtering:
 *   - `isEditor(presence)` rejects any presence whose `mode !== "editor"`.
 *     This means walking visitors appear in the editor's room (they share the
 *     same `world:{id}` room) but are NOT rendered in the 3D viewport — editing
 *     is heads-down work and capsule avatars walking through your scene are
 *     distracting.
 *   - `info` guard: if the user's metadata hasn't propagated yet (can briefly
 *     happen on connect), skip the entry rather than crashing.
 *
 * TypeScript note:
 *   Liveblocks v3 widens presence/info to broad JSON types even with the
 *   global augmentation — the constraint system can't narrow tuple arrays.
 *   We use `as unknown as` casts (same pattern as PresenceLayer.tsx).
 */

import { useOthers } from "@liveblocks/react";
import type { UserPresence, VisitorUserInfo } from "@/lib/liveblocks/types";
import { isEditor } from "@/lib/liveblocks/types";
import { RemoteEditorCursor } from "./RemoteEditorCursor";
import { RemoteEditorSelectionOutline } from "./RemoteEditorSelectionOutline";

export function EditorPresenceLayer() {
  const others = useOthers();

  return (
    <>
      {others.map((other) => {
        // Widen to our union type. Safe because the auth endpoint and
        // useEditorPresence hook always write exactly these typed shapes.
        const presence = other.presence as unknown as UserPresence | null;
        const info = other.info as unknown as VisitorUserInfo | undefined;

        if (!isEditor(presence)) return null;
        if (!info) return null;

        return (
          <group key={other.connectionId}>
            {presence.cursorWorldPos && (
              <RemoteEditorCursor
                position={presence.cursorWorldPos}
                color={info.color}
                name={info.name}
              />
            )}
            {presence.selectedObjectId && (
              <RemoteEditorSelectionOutline
                objectId={presence.selectedObjectId}
                color={info.color}
              />
            )}
          </group>
        );
      })}
    </>
  );
}
