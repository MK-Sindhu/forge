"use client";

import { useRef, useState } from "react";

interface Props {
  worldId: string;
  signedIn: boolean;
}

const REASONS = [
  { value: "copyright", label: "Copyright violation" },
  { value: "nsfw", label: "NSFW / inappropriate content" },
  { value: "abusive", label: "Abusive or harassing" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
] as const;

type ReasonValue = (typeof REASONS)[number]["value"];

export function ReportButton({ worldId, signedIn }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reported, setReported] = useState(false);
  const [reason, setReason] = useState<ReasonValue>("other");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setError(null);
    setReason("other");
    setNotes("");
    dialogRef.current?.showModal();
  }

  function closeModal() {
    dialogRef.current?.close();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/worlds/${worldId}/reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, body: notes.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      setReported(true);
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        disabled={!signedIn || reported}
        aria-label={reported ? "Already reported" : "Report this world"}
        title={
          !signedIn
            ? "Sign in to report"
            : reported
              ? "You've reported this world"
              : undefined
        }
        className={`inline-flex items-center gap-2 rounded-full border border-neutral-300 px-3 py-1.5 text-sm transition ${
          reported
            ? "bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500"
            : "bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <FlagIcon />
        <span>{reported ? "Reported" : "Report"}</span>
      </button>

      {/* Native <dialog> — Escape closes automatically; outside-click intentionally does NOT close */}
      <dialog
        ref={dialogRef}
        className="rounded-lg p-0 backdrop:bg-black/50 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <form onSubmit={submit} className="w-[400px] max-w-[90vw] p-6">
          <h2 className="text-lg font-semibold">Report this world</h2>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Our team reviews every report. Thanks for keeping FORGE safe.
          </p>

          <div className="mt-4">
            <label
              htmlFor="report-reason"
              className="block text-sm font-medium"
            >
              Reason
            </label>
            <select
              id="report-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonValue)}
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <label
              htmlFor="report-notes"
              className="block text-sm font-medium"
            >
              Notes (optional)
            </label>
            <textarea
              id="report-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What's wrong? (max 1000 chars)"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <div className="mt-1 text-right text-xs text-neutral-500">
              {notes.length} / 1000
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={submitting}
              className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {submitting ? "Reporting..." : "Submit report"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function FlagIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="4" y1="22" x2="4" y2="15" />
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    </svg>
  );
}
