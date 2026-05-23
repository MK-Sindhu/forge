import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { ClerkProvider, Show, UserButton } from "@clerk/nextjs";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="flex min-h-full flex-col">
          {/* ----------------------------------------------------------------
              Top nav — uses Clerk's <Show> server component to branch on
              auth state without a client boundary at the layout level.
              UserButton is a Clerk client-boundary component (renders the
              user avatar dropdown); it is safe to use inside a server layout.
          ---------------------------------------------------------------- */}
          <header className="border-b border-neutral-200 bg-white">
            <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              {/* Wordmark */}
              <Link
                href="/"
                className="text-xl font-bold tracking-tight text-neutral-900 hover:text-neutral-700"
              >
                FORGE
              </Link>

              {/* Right side — auth-state-aware actions */}
              <div className="flex items-center gap-3">
                {/* Signed-in state */}
                <Show when="signed-in">
                  <Link
                    href="/upload"
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                  >
                    Upload
                  </Link>
                  <UserButton />
                </Show>

                {/* Signed-out state */}
                <Show when="signed-out">
                  <Link
                    href="/sign-in"
                    className="text-sm text-neutral-700 hover:text-neutral-900"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/sign-up"
                    className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                  >
                    Sign up
                  </Link>
                </Show>
              </div>
            </nav>
          </header>

          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
