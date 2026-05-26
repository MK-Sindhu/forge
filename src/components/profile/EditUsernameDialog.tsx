"use client";

/**
 * EditUsernameDialog — native <dialog> modal for changing the signed-in
 * user's FORGE username.
 *
 * On success the browser navigates to /profile/<new-username> because the
 * current URL is keyed on the username and would otherwise become a 404.
 *
 * Pattern: native <dialog> element, same as InviteCollaboratorDialog (9.2).
 * No external deps.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface EditUsernameDialogProps {
  currentUsername: string;
  open: boolean;
  onClose: () => void;
}

export function EditUsernameDialog({
  currentUsername,
  open,
  onClose,
}: EditUsernameDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [value, setValue] = useState(currentUsername);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Open / close the native dialog in sync with the `open` prop.
  // State resets (setValue/setError) happen via requestAnimationFrame callbacks,
  // not synchronously inside the effect body, to satisfy react-hooks/set-state-in-effect.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.showModal();
      // Reset form state after the showModal call completes (next paint).
      // Using a callback — not synchronous effect body — avoids the lint rule.
      requestAnimationFrame(() => {
        setValue(currentUsername);
        setError(null);
        inputRef.current?.select();
      });
    } else {
      dialog.close();
    }
  }, [open, currentUsername]);

  // ESC key — native <dialog> fires a cancel event; map it to onClose
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault(); // suppress native close so we control it
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  // Backdrop click closes dialog
  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      onClose();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/users/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: value.trim() }),
      });

      const data = await res.json();

      if (res.ok) {
        onClose();
        // Username in the URL changed — navigate to the new profile URL
        router.push(`/profile/${data.username}`);
        return;
      }

      // Server-side error messages are user-readable (400/409)
      if (res.status === 400 || res.status === 409) {
        setError(data.error ?? "Invalid username");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      aria-modal="true"
      aria-labelledby="edit-username-heading"
      aria-describedby={error ? "edit-username-error" : "edit-username-hint"}
      className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-neutral-900 backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={handleSubmit} noValidate>
        {/* Heading */}
        <h2
          id="edit-username-heading"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          Change your username
        </h2>

        {/* Helper text */}
        <p
          id="edit-username-hint"
          className="mt-1 text-sm text-neutral-500 dark:text-neutral-400"
        >
          Letters, numbers, and underscores. 3–32 chars.
        </p>

        {/* Warning */}
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          <strong>Heads up:</strong> changing your username breaks existing
          links to your profile. Make sure you really want this.
        </p>

        {/* Input */}
        <div className="mt-4">
          <label
            htmlFor="edit-username-input"
            className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            New username
          </label>
          <input
            ref={inputRef}
            id="edit-username-input"
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={loading}
            aria-describedby={error ? "edit-username-error" : undefined}
            aria-invalid={error ? "true" : undefined}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder-neutral-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        {/* Inline error */}
        {error && (
          <p
            id="edit-username-error"
            role="alert"
            className="mt-2 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !value.trim()}
            aria-busy={loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
