"use client";

/**
 * EditorCollaborators — top-bar avatar stack showing other editors in the room.
 *
 * Renders up to 4 circular avatars for other users whose presence mode is
 * "editor". Each circle shows the user's Clerk avatar (if available) or an
 * initials fallback colored with their assigned HSL color.
 *
 * - 0 remote editors     → renders null (status bar shows "Just you editing")
 * - 1–4 remote editors   → row of circles with slight –8px overlap
 * - 5+ remote editors    → first 3 circles + "+N" pill
 *
 * TypeScript cast note:
 *   Liveblocks v3 widens presence/info to broad JSON types even with the
 *   global augmentation. We use `as unknown as` casts (same pattern as
 *   EditorPresenceLayer.tsx).
 *
 * Accessibility: each circle carries a native `title` attribute showing the
 * editor's name. The stack is low-priority on narrow viewports — wrap it in
 * `hidden xl:flex` at the call site when the top bar gets tight.
 */

import Image from "next/image";
import { useOthers } from "@liveblocks/react";
import type { UserPresence, VisitorUserInfo } from "@/lib/liveblocks/types";
import { isEditor } from "@/lib/liveblocks/types";

const MAX_AVATARS = 4;
const AVATAR_SIZE = 28; // px

export function EditorCollaborators() {
  const others = useOthers();

  // Filter to editor-mode users only. Walking visitors share the same
  // Liveblocks room but should not appear in this editor-specific stack.
  const editors = others.filter((o) => {
    const presence = o.presence as unknown as UserPresence | null;
    return isEditor(presence);
  });

  if (editors.length === 0) return null;

  // Determine how many avatars to show vs the overflow pill.
  const showPill = editors.length > MAX_AVATARS;
  // When showing a pill, render 3 circles + "+N" pill; otherwise up to 4.
  const avatarsToRender = showPill ? editors.slice(0, MAX_AVATARS - 1) : editors;
  const overflowCount = editors.length - avatarsToRender.length;

  return (
    <div
      className="flex items-center"
      role="group"
      aria-label={`${editors.length} other ${editors.length === 1 ? "editor" : "editors"} here`}
    >
      {avatarsToRender.map((other, idx) => {
        const info = other.info as unknown as VisitorUserInfo | undefined;
        const name = info?.name ?? "Editor";
        const color = info?.color ?? "hsl(214, 70%, 55%)";
        const avatarUrl = info?.avatarUrl ?? null;

        return (
          <AvatarCircle
            key={other.connectionId}
            name={name}
            color={color}
            avatarUrl={avatarUrl}
            // Overlap: each circle after the first shifts left by 8px.
            style={{ marginLeft: idx === 0 ? 0 : -8, zIndex: avatarsToRender.length - idx }}
          />
        );
      })}

      {showPill && overflowCount > 0 && (
        <div
          className="flex items-center justify-center rounded-full text-xs font-semibold text-zinc-200 bg-zinc-700 border-2 border-zinc-800"
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            marginLeft: -8,
            fontSize: 10,
            zIndex: 0,
          }}
          title={`${overflowCount} more editor${overflowCount === 1 ? "" : "s"}`}
          aria-label={`${overflowCount} more editor${overflowCount === 1 ? "" : "s"}`}
        >
          +{overflowCount}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AvatarCircle — single avatar with image-or-initials fallback.
// ---------------------------------------------------------------------------

interface AvatarCircleProps {
  name: string;
  color: string;
  avatarUrl: string | null;
  style?: React.CSSProperties;
}

function AvatarCircle({ name, color, avatarUrl, style }: AvatarCircleProps) {
  // First letter of the display name (strip leading "@" for sign-in users).
  const initial = name.replace(/^@/, "").charAt(0).toUpperCase() || "?";

  return (
    <div
      className="relative rounded-full overflow-hidden shrink-0 border-2"
      style={{
        width: AVATAR_SIZE,
        height: AVATAR_SIZE,
        borderColor: color,
        ...style,
      }}
      title={name}
      aria-label={name}
    >
      {avatarUrl ? (
        <Image
          src={avatarUrl}
          alt={name}
          width={AVATAR_SIZE}
          height={AVATAR_SIZE}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        // Initials fallback — white letter on the user's color fill.
        <div
          className="flex items-center justify-center w-full h-full text-white font-semibold"
          style={{ backgroundColor: color, fontSize: 11 }}
          aria-hidden="true"
        >
          {initial}
        </div>
      )}
    </div>
  );
}
