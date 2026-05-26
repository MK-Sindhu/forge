"use client";

// EnterWorldOverlay — shown in preview mode over the canvas.
// The single action "Enter world" transitions to walk mode.

interface Props {
  onEnter: () => void;
}

export function EnterWorldOverlay({ onEnter }: Props) {
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      aria-live="polite"
    >
      {/* Semi-transparent backdrop */}
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" />

      {/* Card */}
      <div className="relative z-10 flex flex-col items-center gap-4 rounded-xl bg-white/95 px-8 py-7 shadow-xl dark:bg-neutral-900/95">
        <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Ready to walk around?
        </h2>

        <button
          type="button"
          onClick={onEnter}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 active:bg-blue-700"
          autoFocus
        >
          Enter world
        </button>

        <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
          WASD to move&nbsp;&middot;&nbsp;Mouse to look&nbsp;&middot;&nbsp;Shift to run&nbsp;&middot;&nbsp;F for fullscreen&nbsp;&middot;&nbsp;T to chat&nbsp;&middot;&nbsp;ESC to exit
        </p>
      </div>
    </div>
  );
}
