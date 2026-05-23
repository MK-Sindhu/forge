"use client";

export function ViewerLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-neutral-100/80 dark:bg-neutral-950/80 backdrop-blur-sm">
      <div className="text-sm text-neutral-600 dark:text-neutral-400">
        Loading world…
      </div>
    </div>
  );
}

export function ViewerError() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-8 text-center">
      <div>
        <div className="font-medium text-neutral-800 dark:text-neutral-200">
          Couldn&apos;t load this world
        </div>
        <div className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          The 3D file may be corrupted or unreachable. Try refreshing.
        </div>
      </div>
    </div>
  );
}
