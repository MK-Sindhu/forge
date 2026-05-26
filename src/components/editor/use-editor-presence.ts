"use client";

/**
 * use-editor-presence — broadcasts the local editor's cursor position +
 * selection + gizmo mode to Liveblocks ~10x/sec.
 *
 * Must be called inside the R3F <Canvas> tree (uses useFrame + useThree).
 *
 * Architecture
 * -----------
 * The hook is kept intentionally thin. Heavy logic lives in the extracted
 * pure helper `computeEditorPresence()` so it can be unit-tested without
 * WebGL or a real Canvas environment.
 *
 * Throttle strategy (matches WalkMode.tsx):
 *   Client-side 100ms guard via `lastPushedAtRef` + performance.now().
 *   Liveblocks's own ~100ms coalesce is a second layer.
 *   Even at 60 Hz useFrame this means ~10 presence pushes/sec max.
 *
 * Dedup:
 *   `lastSerializedRef` caches a lightweight string representation of the
 *   last-pushed presence. Identical consecutive frames are skipped so idle
 *   editors don't spam presence updates.
 *
 * Collidable filter:
 *   Raycasts skip meshes tagged `userData.collidable === false` (gizmo helpers,
 *   other editors' cursor spheres, VisitorAvatars, the deselect plane, etc.).
 *   Same convention used by walk-mode collision (collision.ts).
 */

import { useEffect, useRef } from "react";
import { useUpdateMyPresence } from "@liveblocks/react";
import { useFrame, useThree } from "@react-three/fiber";
import { Raycaster, Vector2 } from "three";
import type { Camera, Scene, Object3D } from "three";
import { useEditorStore } from "./editor-store";
import type { GizmoMode } from "./editor-store";
import type { EditorPresence } from "@/lib/liveblocks/types";

// ---------------------------------------------------------------------------
// Pure helper — testable without WebGL
// ---------------------------------------------------------------------------

export interface ComputeEditorPresenceArgs {
  pointer: { x: number; y: number };
  camera: Camera;
  scene: Scene;
  raycaster: Raycaster;
  selectedObjectId: string | null;
  gizmoMode: GizmoMode;
}

/**
 * Pure function: given raw R3F + store inputs, computes the next
 * EditorPresence object to broadcast.
 *
 * Performs a raycast from the NDC pointer into the scene, filtering out
 * meshes tagged `userData.collidable === false`. Returns `cursorWorldPos:
 * null` when no usable hit is found (pointer outside canvas, only
 * non-collidable meshes under cursor, etc.).
 *
 * Extracted for testability: test files can create mock Camera/Scene/
 * Raycaster values and call this directly without R3F hooks.
 */
export function computeEditorPresence(
  args: ComputeEditorPresenceArgs
): EditorPresence {
  const { pointer, camera, scene, raycaster, selectedObjectId, gizmoMode } =
    args;

  // setFromCamera takes a Vector2 in NDC (x, y) in [-1, 1].
  // R3F's useThree().pointer is already in that space — no conversion needed.
  raycaster.setFromCamera(pointer as Vector2, camera);

  const hits = raycaster.intersectObjects(scene.children, true);

  // Filter out non-collidable objects (gizmo helpers, cursor spheres,
  // the invisible deselect plane, VisitorAvatars, etc.).
  const usableHit = hits.find((h: { object: Object3D }) => {
    return h.object.userData?.collidable !== false;
  });

  const cursorWorldPos: [number, number, number] | null = usableHit
    ? [usableHit.point.x, usableHit.point.y, usableHit.point.z]
    : null;

  return {
    mode: "editor",
    cursorWorldPos,
    selectedObjectId,
    gizmoMode,
  };
}

// ---------------------------------------------------------------------------
// Thin wrapper component — instantiate with <EditorPresenceWiring />
// ---------------------------------------------------------------------------

const PRESENCE_THROTTLE_MS = 100;

/**
 * Zero-render hook that runs inside the Canvas tree (requires useFrame +
 * useThree). Wire into the scene by rendering <EditorPresenceWiring /> as a
 * child of Viewport's Canvas.
 *
 * On mount: stamps `mode: "editor"` onto presence (belt + suspenders — the
 * provider already supplies INITIAL_EDITOR_PRESENCE, but this ensures the
 * flag is correct even if the provider ever changes its default).
 *
 * Per frame: throttled + deduped presence push via `computeEditorPresence`.
 */
export function useEditorPresence() {
  const updateMyPresence = useUpdateMyPresence();
  const { camera, scene, pointer } = useThree();
  const raycasterRef = useRef(new Raycaster());
  const lastPushedAtRef = useRef(0);
  const lastSerializedRef = useRef("");

  // On mount: announce editor mode explicitly.
  // updateMyPresence is stable for the lifetime of the RoomProvider —
  // including it would trigger an extra effect if the reference ever changed
  // (it shouldn't), but we suppress the warning to keep the mount-once
  // semantics intentional.
  useEffect(() => {
    updateMyPresence({ mode: "editor" });
    // No cleanup needed — Liveblocks auto-releases presence when the
    // connection closes (component unmounts = room participant leaves).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(() => {
    const now = performance.now();
    if (now - lastPushedAtRef.current < PRESENCE_THROTTLE_MS) return;

    // Read store state imperatively — avoids re-renders on every frame.
    const state = useEditorStore.getState();
    const selectedObjectId = state.selectedObjectId;
    const gizmoMode = state.gizmoMode as GizmoMode;

    const presence = computeEditorPresence({
      pointer,
      camera,
      scene,
      raycaster: raycasterRef.current,
      selectedObjectId,
      gizmoMode,
    });

    // Cheap dedup: skip push if nothing changed since last tick.
    const serialized = `${presence.cursorWorldPos?.join(",") ?? "null"}|${presence.selectedObjectId ?? "null"}|${presence.gizmoMode}`;
    if (serialized === lastSerializedRef.current) return;
    lastSerializedRef.current = serialized;
    lastPushedAtRef.current = now;

    // Cast needed because Liveblocks's JSON constraint system doesn't recognise
    // tuple types (`[number, number, number]`) as valid JsonObject values.
    // Safe: we always write exactly EditorPresence-shaped data, which the
    // receiving side casts back with `as unknown as UserPresence`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMyPresence(presence as any);
  });
}
