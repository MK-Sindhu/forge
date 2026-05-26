"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CollaboratorRow {
  id: string;
  username: string;
  avatarUrl: string | null;
  role: string;
  addedAt: string;
  addedBy: { id: string; username: string } | null;
}

interface Props {
  worldId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: (newRow: CollaboratorRow) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InviteCollaboratorDialog({
  worldId,
  open,
  onClose,
  onSuccess,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form to a clean slate — called when the dialog opens or closes
  const resetForm = useCallback(() => {
    setUsername("");
    setError(null);
    setSubmitting(false);
  }, []);

  // Track whether the dialog was previously open so we can detect the
  // open→transition and run imperatives only when the state actually changes.
  const prevOpenRef = useRef(false);

  // Sync the native <dialog> open/close state. Avoid setState in effect body
  // by using refs and imperative DOM calls only.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !prevOpenRef.current) {
      // Dialog is opening
      if (!dialog.open) dialog.showModal();
      // Autofocus input on next frame so it is definitely rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && prevOpenRef.current) {
      // Dialog is closing
      if (dialog.open) dialog.close();
    }

    prevOpenRef.current = open;
  });

  // Close when the native "cancel" event fires (Escape key) and reset form
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleCancel(e: Event) {
      e.preventDefault(); // prevent browser from closing without notifying React
      resetForm();
      onClose();
    }
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose, resetForm]);

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    const rect = dialogRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      handleClose();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const trimmed = username.trim().replace(/^@/, "");
    if (!trimmed) {
      setError("Please enter a username.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/worlds/${worldId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });

      if (res.status === 201) {
        const newRow: CollaboratorRow = await res.json();
        onSuccess(newRow);
        resetForm();
        onClose();
        return;
      }

      const data = await res.json().catch(() => ({})) as {
        error?: string;
        existing?: { id: string; username: string; role: string; addedAt: string };
      };

      if (res.status === 404) {
        setError(`No user @${trimmed}. Check the spelling.`);
        setSubmitting(false);
        return;
      }

      if (res.status === 409) {
        if (data.existing) {
          setError(`@${trimmed} is already a collaborator.`);
        } else {
          setError("You can't invite yourself — you're the owner.");
        }
        setSubmitting(false);
        return;
      }

      // 5xx or other
      setError("Couldn't invite right now. Try again.");
      setSubmitting(false);
    } catch {
      setError("Couldn't invite right now. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="invite-dialog-heading"
      onClick={handleBackdropClick}
      className="rounded-xl p-0 shadow-xl backdrop:bg-black/50 dark:bg-neutral-900 dark:text-neutral-100"
    >
      {/* Stop click propagation inside the card to prevent backdrop-close misfires */}
      <div
        className="w-[400px] max-w-[90vw] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="invite-dialog-heading"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Invite collaborator
        </h2>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Type their @username — they&apos;ll get a notification.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mt-4">
            <label
              htmlFor="invite-username"
              className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
            >
              Username
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-neutral-400 text-sm select-none">
                @
              </span>
              <input
                ref={inputRef}
                id="invite-username"
                type="text"
                value={username.replace(/^@/, "")}
                onChange={(e) => {
                  setError(null);
                  setUsername(e.target.value);
                }}
                placeholder="username"
                autoComplete="off"
                aria-describedby={error ? "invite-error" : undefined}
                aria-invalid={error ? "true" : undefined}
                disabled={submitting}
                className="w-full rounded-md border border-neutral-300 bg-white py-1.5 pl-7 pr-3 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
              />
            </div>
            {error && (
              <p
                id="invite-error"
                role="alert"
                className="mt-1.5 text-sm text-red-600 dark:text-red-400"
              >
                {error}
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="inline-flex items-center gap-2 rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {submitting && (
                <svg
                  className="h-3.5 w-3.5 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
              )}
              {submitting ? "Inviting…" : "Invite"}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
