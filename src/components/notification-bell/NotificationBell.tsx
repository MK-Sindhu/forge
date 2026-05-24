import Link from "next/link";

interface Props {
  initialUnreadCount: number;
}

export function NotificationBell({ initialUnreadCount }: Props) {
  const display =
    initialUnreadCount >= 100 ? "99+" : String(initialUnreadCount);
  const hasUnread = initialUnreadCount > 0;

  return (
    <Link
      href="/notifications"
      aria-label={
        hasUnread
          ? `Notifications, ${initialUnreadCount} unread`
          : "Notifications"
      }
      className="relative inline-flex items-center justify-center rounded-full p-1.5 text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 dark:focus-visible:ring-neutral-100"
    >
      {/* Bell icon — inline SVG, no icon library (matches existing pattern) */}
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>

      {hasUnread && (
        <span
          aria-hidden
          className="absolute -top-0.5 -right-0.5 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {display}
        </span>
      )}
    </Link>
  );
}
