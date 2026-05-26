"use client";

// EnterWorldOverlay — preview-mode CTA.
//
// Sits as a small pill near the bottom of the canvas instead of a full-bleed
// overlay. The orbit view (PreviewMode) stays unobstructed — visitors can
// look at the world freely; entering walk mode is opt-in via this button.
// The hint string sits below the pill so first-time users discover controls
// without losing the view.

interface Props {
  onEnter: () => void;
}

export function EnterWorldOverlay({ onEnter }: Props) {
  return (
    <div
      // pointer-events: none on the outer wrapper so the canvas underneath
      // still receives orbit drag/zoom events; pointer-events: auto only on
      // the pill + hint container so the button is interactive.
      className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex flex-col items-center gap-2"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onEnter}
        className="pointer-events-auto rounded-full bg-blue-600/95 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 focus:ring-offset-transparent active:bg-blue-700"
      >
        Enter world →
      </button>

      <p className="pointer-events-none rounded-md bg-black/55 px-3 py-1 text-center text-[11px] font-medium text-white/90 backdrop-blur-sm">
        WASD&nbsp;&middot;&nbsp;Mouse&nbsp;&middot;&nbsp;Shift to run&nbsp;&middot;&nbsp;F fullscreen&nbsp;&middot;&nbsp;T chat&nbsp;&middot;&nbsp;ESC to exit
      </p>
    </div>
  );
}
