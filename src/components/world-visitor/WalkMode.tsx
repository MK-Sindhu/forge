"use client";

// WalkMode — first-person walk controls for both desktop and touch.
//
// Desktop path:
//   PointerLockControls + keyboard (WASD) + mouse-look.
//   Pointer-lock-on-mount pattern: WalkMode is mounted only after the user
//   clicks "Enter world" — which IS a user gesture. We bank on that gesture
//   being in-flight when `controlsRef.current.lock()` fires in the useEffect.
//   In Chromium and Firefox this works because the gesture window extends to the
//   next microtask boundary after a synthetic React event. If a browser tightens
//   this, the fallback is to hoist `lock()` into a callback prop called directly
//   from the Enter button's onClick (bypassing the React state-render cycle).
//   Currently using useEffect for simplicity — revisit if browsers start refusing.
//
// Touch path:
//   NO PointerLockControls. NO keyboard listeners. NO lock() call.
//   WalkMode reads joystick values from joystickInputRef (owned by WorldVisitor,
//   written by MobileJoysticks callbacks). Per-frame: maps left stick to
//   forward/strafe, right stick to yawRate/pitchRate, calls computeMovement,
//   applies yawDelta + pitchDelta manually to camera.rotation (YXZ order).
//   Pitch is clamped to ±(π/2 - 0.05) to avoid gimbal flips.

import { useEffect, useRef } from "react";
import { PointerLockControls } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import { Raycaster } from "three";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import { useUpdateMyPresence } from "@liveblocks/react";
import { computeMovement, type MovementInput } from "./movement";
import { applyCollision } from "./collision";
import type { SceneGraphV1 } from "@/lib/scene-graph/schema";

export const EYE_HEIGHT = 1.6;

// Maximum pitch angle (radians). Slightly under π/2 to avoid gimbal-lock.
const MAX_PITCH = Math.PI / 2 - 0.05;

export interface JoystickInput {
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}

interface Props {
  spawn: {
    position: [number, number, number];
    rotation: [number, number, number];
  };
  /** Retained for future use (e.g. per-scene speed multiplier). */
  sceneGraph: SceneGraphV1;
  onExit: () => void;
  /** True when running on a touch device. Controls which input path is active. */
  isTouchDevice: boolean;
  /**
   * Touch path only. Ref owned by WorldVisitor, written by MobileJoysticks
   * callbacks. WalkMode reads it every frame — no state, no re-renders.
   * Ignored when isTouchDevice is false.
   */
  joystickInputRef: React.RefObject<JoystickInput>;
}

export function WalkMode({
  spawn,
  sceneGraph: _sceneGraph,
  onExit,
  isTouchDevice,
  joystickInputRef,
}: Props) {
  const { camera, scene } = useThree();
  const inputRef = useRef<MovementInput>({ forward: 0, strafe: 0 });
  const runningRef = useRef(false);
  const raycasterRef = useRef(new Raycaster());
  const controlsRef = useRef<PointerLockControlsImpl>(null);

  // Liveblocks presence — push our own position to the room ~10x/sec.
  const updateMyPresence = useUpdateMyPresence();
  // Timestamp of the last presence push. Used to throttle to ~100ms intervals.
  const lastPushedAtRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Liveblocks: announce walk-mode entry/exit.
  // On mount: set inWalkMode: true so other users see us enter.
  // On unmount (ESC / Exit): set inWalkMode: false and clear position so our
  // avatar disappears from the PresenceLayer of other visitors.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    updateMyPresence({ inWalkMode: true });
    return () => updateMyPresence({ inWalkMode: false, position: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // On mount: place camera at spawn + eye height; apply spawn rotation for yaw.
  // PointerLockControls (and manual touch rotation) both expect YXZ order.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    camera.position.set(
      spawn.position[0],
      spawn.position[1] + EYE_HEIGHT,
      spawn.position[2]
    );
    camera.rotation.set(
      spawn.rotation[0],
      spawn.rotation[1],
      spawn.rotation[2],
      "YXZ"
    );
    camera.updateProjectionMatrix();

    if (!isTouchDevice) {
      // Desktop: immediately request pointer lock. The user gesture from the
      // Enter button is still in-flight at this point (React state flush is
      // synchronous on click). See file comment above for the fallback strategy.
      controlsRef.current?.lock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Desktop only: keyboard input — attached to window so focus on any element
  // still fires. Skipped entirely on touch.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isTouchDevice) return;

    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case "w":
        case "W":
        case "ArrowUp":
          inputRef.current.forward = 1;
          break;
        case "s":
        case "S":
        case "ArrowDown":
          inputRef.current.forward = -1;
          break;
        case "a":
        case "A":
        case "ArrowLeft":
          inputRef.current.strafe = -1;
          break;
        case "d":
        case "D":
        case "ArrowRight":
          inputRef.current.strafe = 1;
          break;
        case "Shift":
          runningRef.current = true;
          break;
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      switch (e.key) {
        case "w":
        case "W":
        case "ArrowUp":
        case "s":
        case "S":
        case "ArrowDown":
          inputRef.current.forward = 0;
          break;
        case "a":
        case "A":
        case "ArrowLeft":
        case "d":
        case "D":
        case "ArrowRight":
          inputRef.current.strafe = 0;
          break;
        case "Shift":
          runningRef.current = false;
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [isTouchDevice]);

  // ---------------------------------------------------------------------------
  // Desktop only: pointer lock release → exit walk mode.
  // When the user presses ESC, the browser releases pointer lock and fires
  // pointerlockchange. We use that to call onExit rather than relying on a
  // separate ESC keydown listener (the browser swallows ESC when locked).
  // Touch: no pointer lock is ever requested, so this listener is irrelevant.
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (isTouchDevice) return;

    function onChange() {
      if (document.pointerLockElement === null) {
        onExit();
      }
    }
    document.addEventListener("pointerlockchange", onChange);
    return () => document.removeEventListener("pointerlockchange", onChange);
  }, [isTouchDevice, onExit]);

  // ---------------------------------------------------------------------------
  // Per-frame movement: computeMovement → applyCollision → update camera.
  // Delta is clamped to 50 ms to prevent huge position jumps after a stutter
  // or browser tab becoming backgrounded.
  //
  // Desktop: PointerLockControls handles yaw/pitch via mouse; we only apply
  //   positionDelta to camera.position.
  //
  // Touch: read joystickInputRef → map to MovementInput (including yawRate +
  //   pitchRate) → computeMovement → apply positionDelta + manually apply
  //   yawDelta + pitchDelta to camera.rotation (YXZ). Clamp pitch.
  // ---------------------------------------------------------------------------

  useFrame((_, delta) => {
    const clampedDelta = Math.min(delta, 0.05);

    let movementInput: MovementInput;

    if (isTouchDevice) {
      const joy = joystickInputRef.current;
      // Left stick convention: forward = -leftY (DOM y-down → invert for forward)
      //                        strafe  = +leftX
      // Right stick convention: yawRate = rightX, pitchRate = -rightY (invert for "up = look up")
      movementInput = {
        forward: -(joy?.leftY ?? 0),
        strafe: joy?.leftX ?? 0,
        yawRate: joy?.rightX ?? 0,
        pitchRate: -(joy?.rightY ?? 0),
      };
    } else {
      movementInput = inputRef.current;
    }

    const { positionDelta, yawDelta, pitchDelta } = computeMovement({
      input: movementInput,
      yaw: camera.rotation.y,
      running: runningRef.current,
      delta: clampedDelta,
    });

    // Apply manual camera rotation for touch (desktop: PointerLockControls owns this).
    // Use camera.rotation.set() rather than direct property operators to satisfy
    // the react-hooks/immutability lint rule (method calls are allowed; += / = are not).
    if (isTouchDevice) {
      const newYaw = camera.rotation.y + yawDelta;
      const clampedPitch = Math.max(
        -MAX_PITCH,
        Math.min(MAX_PITCH, camera.rotation.x + pitchDelta)
      );
      camera.rotation.set(clampedPitch, newYaw, camera.rotation.z, "YXZ");
    }

    // Skip collision work entirely when there is no horizontal movement.
    if (positionDelta.lengthSq() === 0) return;

    const safe = applyCollision({
      scene,
      raycaster: raycasterRef.current,
      currentPos: camera.position.clone(),
      desiredDelta: positionDelta,
      eyeHeight: EYE_HEIGHT,
    });

    camera.position.copy(safe);

    // Throttle presence push to ~100ms (10 Hz).
    // Liveblocks coalesces calls at its own ~100ms default throttle, so this
    // client-side guard is primarily a CPU saving (avoids JSON-serializing
    // presence at 60 Hz). We only push after movement is confirmed (inside
    // the `positionDelta.lengthSq() !== 0` branch) to avoid spamming when idle.
    const now = performance.now();
    if (now - lastPushedAtRef.current >= 100) {
      lastPushedAtRef.current = now;
      updateMyPresence({
        position: [camera.position.x, camera.position.y, camera.position.z],
        yaw: camera.rotation.y,
        pitch: camera.rotation.x,
        inWalkMode: true,
      });
    }
  });

  // Desktop: PointerLockControls handles mouse-look automatically.
  // makeDefault ensures this control set takes precedence over any leaked
  // OrbitControls context (though OrbitControls is not mounted in walk mode).
  // Touch: no PointerLockControls — return null.
  if (isTouchDevice) return null;

  return (
    <PointerLockControls
      ref={controlsRef as React.RefObject<PointerLockControlsImpl>}
      makeDefault
    />
  );
}
