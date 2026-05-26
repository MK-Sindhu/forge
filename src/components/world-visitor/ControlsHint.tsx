"use client";

/**
 * ControlsHint — first-time bottom banner explaining walk-mode controls.
 *
 * Behavior:
 *   - On mount: checks localStorage for "forge-walk-hint-dismissed" === "true".
 *     If set, renders nothing.
 *   - Otherwise: renders a centered bottom banner with control instructions.
 *   - Content varies by `isTouchDevice` prop.
 *   - "Got it" button dismisses and writes localStorage.
 *   - Auto-dismisses after 12 seconds (also writes localStorage so refresh
 *     won't re-show it).
 *   - localStorage access is wrapped in try/catch — private browsing mode can
 *     throw SecurityError on storage access.
 *
 * Accessibility:
 *   - role="status" aria-live="polite" so screen readers announce it
 *     without interrupting the user.
 *   - The dismiss button has an explicit aria-label.
 *
 * z-index: 60 (above joysticks at 50, below any future modal overlays).
 * pointer-events: none on outer container; pointer-events: auto on the banner.
 */

import { useState, useEffect, useRef } from "react";

const STORAGE_KEY = "forge-walk-hint-dismissed";
const AUTO_DISMISS_MS = 12_000;

function readDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    // Private browsing / storage access denied.
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Silently ignore storage errors — dismissal is best-effort.
  }
}

interface Props {
  /** True if we're on a touch device — picks the wording. */
  isTouchDevice: boolean;
}

export function ControlsHint({ isTouchDevice }: Props) {
  // Initialize to true if already dismissed to avoid a visible flash.
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (dismissed) return;

    timerRef.current = setTimeout(() => {
      writeDismissed();
      setDismissed(true);
    }, AUTO_DISMISS_MS);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, [dismissed]);

  if (dismissed) return null;

  function handleDismiss() {
    writeDismissed();
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setDismissed(true);
  }

  const hintText = isTouchDevice
    ? "Left stick to move · Right stick to look · Tap Exit to leave · Walks through walls for now"
    : "WASD to move · Mouse to look · Shift to run · ESC to exit · Walks through walls for now";

  return (
    // Outer: covers the full screen but pointer-events: none so canvas stays interactive.
    <div className="fixed inset-0 z-60 pointer-events-none flex items-end justify-center pb-6">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-4 rounded-xl px-5 py-3 text-sm text-white"
        style={{
          background: "rgba(0,0,0,0.7)",
          maxWidth: 600,
          width: "80%",
        }}
      >
        <span className="flex-1">{hintText}</span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss controls hint"
          className="flex-shrink-0 rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
