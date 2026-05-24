import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { users, reports } from "@/db/schema";
import { ReportRow } from "./ReportRow";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ReportStatus = "open" | "resolved" | "dismissed";

// ---------------------------------------------------------------------------
// Page (server component)
// ---------------------------------------------------------------------------
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // 1. Auth check — redirect to sign-in if not authenticated
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/admin/reports");

  // 2. Server-side admin gate via DB query
  const [me] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);

  if (!me?.isAdmin) {
    // Silent redirect — don't leak that the page exists
    redirect("/");
  }

  // 3. Parse status filter (closed-set — same pattern as feed's tab param)
  const { status: statusParam } = await searchParams;
  const activeStatus: ReportStatus =
    statusParam === "resolved" || statusParam === "dismissed"
      ? statusParam
      : "open";

  // 4. Query reports with world + reporter joins
  const rows = await db.query.reports.findMany({
    where: eq(reports.status, activeStatus),
    orderBy: [desc(reports.createdAt)],
    limit: 50,
    columns: {
      id: true,
      reason: true,
      body: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
    },
    with: {
      world: {
        columns: { id: true, title: true, userId: true },
        with: {
          media: {
            where: (m, { eq: meq }) => meq(m.type, "thumbnail"),
            limit: 1,
            columns: { url: true },
          },
          user: {
            columns: { id: true, username: true },
          },
        },
      },
      reporter: {
        columns: { id: true, username: true, avatarUrl: true },
      },
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Reports queue</h1>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Triage user-submitted reports. Resolve good-faith concerns; dismiss
          spam reports.
        </p>
      </header>

      {/* Status tabs */}
      <div
        className="mb-6 flex gap-1 border-b border-neutral-200 dark:border-neutral-800"
        role="tablist"
      >
        <StatusTab
          href="/admin/reports"
          active={activeStatus === "open"}
          label="Open"
        />
        <StatusTab
          href="/admin/reports?status=resolved"
          active={activeStatus === "resolved"}
          label="Resolved"
        />
        <StatusTab
          href="/admin/reports?status=dismissed"
          active={activeStatus === "dismissed"}
          label="Dismissed"
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState status={activeStatus} />
      ) : (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((r) => (
            <li key={r.id} className="py-6">
              <ReportRow
                report={{
                  id: r.id,
                  reason: r.reason,
                  body: r.body ?? null,
                  status: r.status,
                  createdAt: r.createdAt,
                  resolvedAt: r.resolvedAt ?? null,
                  world: {
                    id: r.world!.id,
                    title: r.world!.title,
                    userId: r.world!.userId,
                    media: r.world!.media,
                    user: {
                      id: r.world!.user!.id,
                      username: r.world!.user!.username,
                    },
                  },
                  reporter: {
                    id: r.reporter!.id,
                    username: r.reporter!.username,
                    avatarUrl: r.reporter!.avatarUrl ?? null,
                  },
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// StatusTab — same pattern as TabLink in src/app/page.tsx
// ---------------------------------------------------------------------------
function StatusTab({
  href,
  active,
  label,
}: {
  href: string;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={active}
      className={`relative px-4 py-2 text-sm font-medium transition ${
        active
          ? "text-neutral-900 dark:text-neutral-100"
          : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-500 dark:hover:text-neutral-300"
      }`}
    >
      {label}
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-px h-0.5 bg-neutral-900 dark:bg-neutral-100"
        />
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
function EmptyState({ status }: { status: ReportStatus }) {
  const messages: Record<ReportStatus, { title: string; body: string }> = {
    open: {
      title: "No open reports",
      body: "All clear — no reports waiting for triage.",
    },
    resolved: {
      title: "No resolved reports",
      body: "Reports you resolve will appear here.",
    },
    dismissed: {
      title: "No dismissed reports",
      body: "Reports you dismiss will appear here.",
    },
  };

  const { title, body } = messages[status];

  return (
    <div className="rounded-lg border border-dashed border-neutral-300 py-20 text-center dark:border-neutral-700">
      <p className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
        {title}
      </p>
      <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
        {body}
      </p>
    </div>
  );
}
