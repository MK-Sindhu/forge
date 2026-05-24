"use client";

import { useEffect, useRef } from "react";

/**
 * Fires POST /api/notifications/mark-read { all: true } once, after a 1.5s
 * delay. The delay lets the user see their unread state before it clears.
 *
 * StrictMode-safe: firedRef is set synchronously BEFORE the timer is created,
 * so React 19's intentional double-mount in dev never triggers a second POST.
 * Returns null — no rendered output.
 */
export function MarkAllReadOnView() {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true; // BEFORE the timer — StrictMode safety

    const t = setTimeout(() => {
      fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      }).catch(() => {
        // best-effort — swallow errors silently
      });
    }, 1500);

    return () => clearTimeout(t);
  }, []);

  return null;
}
