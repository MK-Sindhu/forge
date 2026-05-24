import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { eq, count, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, notifications } from "@/db/schema";
import { NotificationBell } from "@/components/notification-bell/NotificationBell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FORGE",
  description: "A feed-first social network for 3D world creators.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Look up isAdmin + unread notification count for the nav.
  // One DB query per signed-in request — acceptable per-request cost.
  const { userId } = await auth();
  let isAdmin = false;
  let unreadNotifs = 0;
  if (userId) {
    const [row] = await db
      .select({ id: users.id, isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);
    if (row) {
      isAdmin = !!row.isAdmin;
      const [countRow] = await db
        .select({ c: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, row.id), isNull(notifications.readAt)));
      unreadNotifs = Number(countRow?.c ?? 0);
    }
  }

  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;

  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="flex min-h-full flex-col bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
          {plausibleDomain && (
            <script
              defer
              data-domain={plausibleDomain}
              src="https://plausible.io/js/script.js"
            />
          )}
          {/* ----------------------------------------------------------------
              Top nav — uses Clerk's <Show> server component to branch on
              auth state without a client boundary at the layout level.
              UserButton is a Clerk client-boundary component (renders the
              user avatar dropdown); it is safe to use inside a server layout.
          ---------------------------------------------------------------- */}
          <header className="border-b border-neutral-200 bg-white dark:bg-neutral-950 dark:border-neutral-800">
            <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              {/* Wordmark */}
              <Link
                href="/"
                className="text-xl font-bold tracking-tight text-neutral-900 hover:text-neutral-700 dark:text-neutral-100 dark:hover:text-neutral-300"
              >
                FORGE
              </Link>

              {/* Public search form — hidden on mobile (no space in the narrow nav) */}
              <form action="/search" method="get" className="hidden md:block flex-1 max-w-md mx-4">
                <label htmlFor="header-search" className="sr-only">Search worlds</label>
                <input
                  id="header-search"
                  name="q"
                  type="search"
                  placeholder="Search worlds…"
                  className="block w-full rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
                />
              </form>

              {/* Right side — auth-state-aware actions */}
              <div className="flex items-center gap-3">
                {/* Signed-in state */}
                <Show when="signed-in">
                  {isAdmin && (
                    <Link
                      href="/admin/reports"
                      className="text-sm text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                    >
                      Admin
                    </Link>
                  )}
                  <NotificationBell initialUnreadCount={unreadNotifs} />
                  <Link
                    href="/upload"
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:ring-neutral-100"
                  >
                    Upload
                  </Link>
                  <UserButton />
                </Show>

                {/* Signed-out state */}
                <Show when="signed-out">
                  <Link
                    href="/sign-in"
                    className="text-sm text-neutral-700 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 dark:focus-visible:ring-neutral-100"
                  >
                    Sign up
                  </Link>
                </Show>
              </div>
            </nav>
          </header>

          <div className="flex-1">{children}</div>

          <footer className="border-t border-neutral-200 bg-white py-6 dark:border-neutral-800 dark:bg-neutral-950">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-neutral-500 dark:text-neutral-500">
              <p>FORGE — a feed of 3D worlds.</p>
              <nav className="flex gap-4">
                <Link
                  href="/legal/dmca"
                  className="hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  DMCA
                </Link>
                <Link
                  href="/legal/terms"
                  className="hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  Terms
                </Link>
                <Link
                  href="/legal/privacy"
                  className="hover:text-neutral-700 dark:hover:text-neutral-300"
                >
                  Privacy
                </Link>
              </nav>
            </div>
          </footer>
        </body>
      </html>
    </ClerkProvider>
  );
}
