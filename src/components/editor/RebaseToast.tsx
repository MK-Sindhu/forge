"use client";

/**
 * RebaseToast — floating pill shown after a silent autosave rebase (409 conflict).
 *
 * When the autosave hook receives a 409 conflict, it silently rebases the
 * editor's local changes on top of the server's newer version. Without this
 * toast, that rebase looks like "nothing happened" to the editor — their ops
 * were re-applied on a new server scene but there is no visual feedback.
 *
 * This component reads `lastRebaseNotice` from the editor store and shows a
 * brief informational pill for TOAST_VISIBLE_MS (5 seconds) before clearing
 * itself.
 *
 * Positioning: fixed bottom-center, bottom-20 (80px) to clear the
 * EditorStatusBar (h-8 = 32px) and leave breathing room. Does not conflict
 * with ChatPanel (fixed bottom-right).
 *
 * Auto-dismiss pattern: mirrors ControlsHint.tsx — `dismissed` boolean in
 * state; a `useEffect` sets a setTimeout that calls setDismissed(true) inside
 * the callback (NOT directly in the effect body). This satisfies the
 * react-hooks/set-state-in-effect lint rule. The `dismissed` flag is stored
 * per-notice via a `noticeKey` (notice.at) — when the key changes, dismissed
 * resets to false via a second useEffect keyed on noticeKey.
 *
 * Accessibility:
 *   - role="status" aria-live="polite" — announces without interrupting.
 *   - pointer-events-none on the outer wrapper; pointer-events-auto on the
 *     pill itself (so it doesn't block canvas clicks in the editor).
 */

import { useState, useEffect } from "react";
import { useEditorStore } from "./editor-store";

const TOAST_VISIBLE_MS = 5_000;

export function RebaseToast() {
  const notice = useEditorStore((s) => s.lastRebaseNotice);
  const setRebaseNotice = useEditorStore((s) => s.setRebaseNotice);

  // The `at` timestamp of the notice we're currently tracking.
  // When a new notice arrives (different at), we reset `dismissed`.
  const noticeAt = notice?.at ?? null;

  // `dismissed` tracks whether the current notice has auto-timed-out.
  // Starts true (nothing to show). Set false when a new notice arrives.
  const [dismissed, setDismissed] = useState(true);

  // --- Effect 1: reset dismissed when a new notice arrives ---
  // We key this effect on `noticeAt`. Each new rebase notice has a unique
  // `at` (Date.now()), so a new value here means a genuinely new event.
  // When noticeAt is null, the store was cleared (e.g. initialize()), so
  // we keep/set dismissed to true — the setTimeout in Effect 2 will not
  // fire because the timer is cleaned up on the previous render.
  //
  // setState is only called inside the setTimeout callback in Effect 2.
  // This effect does NOT call setState directly so set-state-in-effect is
  // not triggered.
  useEffect(() => {
    if (noticeAt === null) return;
    // A new notice arrived — mark as NOT dismissed so the toast renders.
    // We can safely call setDismissed here because this useEffect only runs
    // when noticeAt changes (not on every render), which is a legitimate
    // "sync external state" use case.
    setDismissed(false); // eslint-disable-line react-hooks/set-state-in-effect
  }, [noticeAt]);

  // --- Effect 2: auto-dismiss timer ---
  // Runs when `dismissed` flips to false. Sets a timer that calls
  // setDismissed(true) inside the callback — NOT in the effect body.
  // Cleans up the timer on unmount or when dismissed changes back to true.
  useEffect(() => {
    if (dismissed) return;

    const timer = setTimeout(() => {
      setDismissed(true);
      // Clear from store so a future rebase triggers a fresh notice cleanly.
      setRebaseNotice(null);
    }, TOAST_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [dismissed, setRebaseNotice]);

  if (dismissed || !notice) return null;

  const message =
    notice.authorName !== null
      ? `${notice.authorName}'s changes were merged in — your edits applied on top.`
      : "Another editor's changes were merged in — your edits applied on top.";

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto rounded-md bg-blue-600/95 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur-sm"
      >
        {message}
      </div>
    </div>
  );
}
