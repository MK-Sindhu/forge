"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatRelative } from "@/lib/format-relative";

interface ReportRowProps {
  report: {
    id: string;
    reason: string;
    body: string | null;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
    world: {
      id: string;
      title: string;
      userId: string; // creator's DB id — for the "Suspend creator" action
      media: { url: string }[];
      user: { id: string; username: string };
    };
    reporter: { id: string; username: string; avatarUrl: string | null };
  };
}

export function ReportRow({ report }: ReportRowProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const thumbnailUrl = report.world.media[0]?.url;

  async function patchStatus(status: "resolved" | "dismissed") {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/admin/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  async function suspendCreator() {
    if (
      !window.confirm(
        `Suspend @${report.world.user.username}? They won't be able to post or interact until unsuspended.`
      )
    )
      return;
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(
        `/api/admin/users/${report.world.userId}/suspend`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="flex gap-4">
      {/* Thumbnail */}
      <Link href={`/world/${report.world.id}`} className="block flex-shrink-0">
        <div className="relative h-24 w-32 overflow-hidden rounded-md bg-neutral-100 dark:bg-neutral-800">
          {thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={report.world.title}
              fill
              sizes="128px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-400">
              No thumb
            </div>
          )}
        </div>
      </Link>

      {/* Details */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm">
          <Link
            href={`/world/${report.world.id}`}
            className="truncate font-medium hover:underline"
          >
            {report.world.title}
          </Link>
          <span className="text-neutral-500">by</span>
          <Link
            href={`/profile/${report.world.user.username}`}
            className="text-neutral-700 hover:underline dark:text-neutral-300"
          >
            @{report.world.user.username}
          </Link>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <ReasonBadge reason={report.reason} />
          <span>·</span>
          <span>reported by</span>
          <Link
            href={`/profile/${report.reporter.username}`}
            className="hover:underline"
          >
            @{report.reporter.username}
          </Link>
          <span>·</span>
          <time dateTime={report.createdAt.toISOString()}>
            {formatRelative(report.createdAt.toISOString())}
          </time>
          {report.resolvedAt && (
            <>
              <span>·</span>
              <span>
                resolved {formatRelative(report.resolvedAt.toISOString())}
              </span>
            </>
          )}
        </div>

        {report.body && (
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
            &quot;{report.body}&quot;
          </p>
        )}

        {/* Actions — only on open reports */}
        {report.status === "open" && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => patchStatus("resolved")}
              disabled={pending}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Resolve
            </button>
            <button
              onClick={() => patchStatus("dismissed")}
              disabled={pending}
              className="rounded-md bg-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-400 disabled:opacity-50 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600"
            >
              Dismiss
            </button>
            <button
              onClick={suspendCreator}
              disabled={pending}
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Suspend creator
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function ReasonBadge({ reason }: { reason: string }) {
  const colors: Record<string, string> = {
    copyright:
      "bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400",
    nsfw: "bg-pink-100 text-pink-800 dark:bg-pink-950/30 dark:text-pink-400",
    abusive:
      "bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400",
    spam: "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-400",
    other:
      "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-400",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 ${colors[reason] ?? colors.other}`}
    >
      {reason}
    </span>
  );
}
