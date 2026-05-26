/**
 * Best-effort notification helpers.
 *
 * Locked decision (PROJECT.md §7): notification failures must NEVER propagate
 * to the parent action. All DB errors are caught, logged, and swallowed.
 *
 * Self-notifications (recipient === actor) are suppressed at this layer —
 * no row is inserted when userId === actorId. The DB has no CHECK for this;
 * the helper is the single enforcement point.
 *
 * Usage:
 *   After the parent transaction commits, call notify() / notifyMany() in a
 *   try/catch at the call site too, as a second defensive layer:
 *     try { await notify({ ... }); } catch { /* already swallowed *\/ }
 */

import { db } from "@/db";
import { notifications } from "@/db/schema";

export type NotifyInput = {
  userId: string;   // recipient
  type: "like" | "comment" | "follow" | "new_world" | "collaborator_added";
  actorId?: string | null;
  worldId?: string | null;
  commentId?: string | null;
};

/**
 * Best-effort notification insert. Suppresses self-notifications.
 * Never throws — DB errors are caught, logged, and swallowed.
 */
export async function notify(input: NotifyInput): Promise<void> {
  if (input.actorId && input.userId === input.actorId) return;
  try {
    await db.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      actorId: input.actorId ?? null,
      worldId: input.worldId ?? null,
      commentId: input.commentId ?? null,
    });
  } catch (err) {
    console.error("[notify] insert failed (best-effort):", err);
    // Swallow — locked: notification failure must NEVER break the parent action
  }
}

/**
 * Bulk variant for fan-out (e.g., new-world-from-followee → notify N followers).
 * Filters out self-actor entries before inserting.
 * Never throws — DB errors are caught, logged, and swallowed.
 */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  const filtered = inputs.filter(
    (i) => !(i.actorId && i.userId === i.actorId)
  );
  if (filtered.length === 0) return;
  try {
    await db.insert(notifications).values(
      filtered.map((i) => ({
        userId: i.userId,
        type: i.type,
        actorId: i.actorId ?? null,
        worldId: i.worldId ?? null,
        commentId: i.commentId ?? null,
      }))
    );
  } catch (err) {
    console.error("[notifyMany] bulk insert failed:", err);
    // Swallow — same contract as notify()
  }
}
