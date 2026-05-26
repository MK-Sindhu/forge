/**
 * save-client.ts — Pure async fetch wrappers for the save/publish flow.
 *
 * No React, no store references. Each function takes explicit args and returns
 * a typed discriminated-union result. This separation makes the callers
 * (use-autosave, EditorTopBar handlers) easy to test and keeps side-effects
 * out of the store.
 */

import type { SceneGraphOp } from "@/lib/scene-graph/operations";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

// ---------------------------------------------------------------------------
// saveOps
// ---------------------------------------------------------------------------

export type SaveOpsResult =
  | { ok: true; versionId: string; versionNumber: number; sceneGraph: SceneGraphV1 }
  | {
      ok: false;
      kind: "conflict";
      currentVersion: {
        versionId: string;
        versionNumber: number;
        sceneGraph: SceneGraphV1;
        status: "draft" | "published";
      };
    }
  | { ok: false; kind: "operation-error"; message: string; opIndex: number }
  | { ok: false; kind: "other"; message: string };

export async function saveOps(args: {
  worldId: string;
  ops: SceneGraphOp[];
  baseVersionId: string;
  label?: string | null;
}): Promise<SaveOpsResult> {
  const res = await fetch(`/api/worlds/${args.worldId}/scene-graph/ops`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ops: args.ops,
      baseVersionId: args.baseVersionId,
      label: args.label ?? null,
    }),
  });

  if (res.status === 200) {
    const data = await res.json();
    return {
      ok: true,
      versionId: data.versionId,
      versionNumber: data.versionNumber,
      sceneGraph: data.sceneGraph,
    };
  }

  if (res.status === 409) {
    const data = await res.json();
    return {
      ok: false,
      kind: "conflict",
      currentVersion: data.currentVersion,
    };
  }

  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    if (typeof data.opIndex === "number") {
      return {
        ok: false,
        kind: "operation-error",
        message: data.error ?? "Invalid op",
        opIndex: data.opIndex,
      };
    }
    return {
      ok: false,
      kind: "other",
      message: data.error ?? "HTTP 400",
    };
  }

  return { ok: false, kind: "other", message: `HTTP ${res.status}` };
}

// ---------------------------------------------------------------------------
// publishVersion
// ---------------------------------------------------------------------------

export type PublishResult =
  | { ok: true; versionId: string; versionNumber: number }
  | { ok: false; message: string };

export async function publishVersion(args: {
  worldId: string;
  versionId: string;
}): Promise<PublishResult> {
  const res = await fetch(
    `/api/worlds/${args.worldId}/versions/${args.versionId}/publish`,
    { method: "POST" }
  );
  if (res.status === 200) {
    const data = await res.json();
    return { ok: true, versionId: data.versionId, versionNumber: data.versionNumber };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: false, message: data.error ?? `HTTP ${res.status}` };
}
