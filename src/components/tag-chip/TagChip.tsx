import Link from "next/link";

interface Props {
  name: string;
  /** Optional override sizing variant. Defaults to "default". */
  size?: "default" | "small";
}

export function TagChip({ name, size = "default" }: Props) {
  const sizeClasses =
    size === "small"
      ? "px-2 py-0.5 text-xs"
      : "px-2.5 py-0.5 text-xs";

  return (
    <Link
      href={`/search?tag=${encodeURIComponent(name)}`}
      className={`inline-flex items-center rounded-full bg-neutral-100 font-medium text-neutral-700 transition hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-1 dark:focus-visible:ring-neutral-400 ${sizeClasses}`}
    >
      #{name}
    </Link>
  );
}
