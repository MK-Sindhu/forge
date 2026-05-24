"use client";

import { useEffect, useRef } from "react";

interface Props {
  worldId: string;
  signedIn: boolean;
}

/**
 * Best-effort view-count incrementer. Fires once on mount for signed-in
 * users via POST /api/worlds/[id]/views. Backend handles per-user-per-day
 * dedup; client just needs to fire-and-forget.
 *
 * Anonymous views are intentionally ignored (locked decision; see
 * docs/backend.md "View Tracking Pattern").
 */
export function ViewTracker({ worldId, signedIn }: Props) {
  const firedRef = useRef(false);

  useEffect(() => {
    if (!signedIn) return;
    if (firedRef.current) return;
    firedRef.current = true; // set BEFORE fetch — prevents React StrictMode double-mount double-fire
    fetch(`/api/worlds/${worldId}/views`, { method: "POST" }).catch(() => {});
  }, [worldId, signedIn]);

  return null;
}
