"use client";

interface Props {
  worldId: string;
  worldTitle: string;
}

export function PhoneNotice({ worldId, worldTitle }: Props) {
  return (
    <div
      className="flex md:hidden min-h-screen items-center justify-center bg-zinc-950 px-6"
      role="main"
    >
      <div className="max-w-sm w-full rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-4">
        <div aria-hidden className="text-4xl">
          {/* Monitor icon — inline SVG, no icon library */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="mx-auto h-12 w-12 text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
            aria-hidden="true"
          >
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-zinc-100">
          Switch to a bigger screen to edit
        </h1>
        <p className="text-sm text-zinc-400">
          The FORGE editor needs a tablet or desktop. We don&apos;t have a
          phone-friendly version yet.
        </p>
        <a
          href={`/world/${worldId}`}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-300 hover:text-zinc-100 underline underline-offset-2 transition-colors"
        >
          <span aria-hidden>&#8592;</span>
          Back to {worldTitle}
        </a>
      </div>
    </div>
  );
}
