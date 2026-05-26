"use client";

/**
 * MobileJoysticks — dual virtual joystick overlay for touch-device walk mode.
 *
 * Renders two 120px joystick circles anchored to the bottom corners of the screen.
 * Each joystick produces a normalized (x, y) vector in [-1, 1] via pointer events.
 *
 * Coordinate convention (raw DOM Y-axis, not inverted):
 *   x: rightward (positive = right)
 *   y: downward  (positive = down — standard browser DOM)
 *
 * The caller (WalkMode in Chunk 5) is responsible for mapping these to 3D controls:
 *   - Left stick: invert Y → forward/back (y positive = move backward)
 *   - Right stick: invert Y → pitch up/down, x → yaw left/right
 *
 * Pointer event strategy:
 *   - Each joystick tracks ONE touch via pointerId.
 *   - setPointerCapture() ensures pointermove fires even if the finger slides off
 *     the element. Browser support: all modern browsers (Chrome 55+, Firefox 59+,
 *     Safari 13+). setPointerCapture() can throw if the pointer is no longer
 *     active — we catch and ignore that.
 *
 * touch-action: none on each stick element — prevents browser pan/zoom from
 * interfering when the user touches the joystick area.
 *
 * iOS safe-area: bottom margin uses `env(safe-area-inset-bottom)` via inline style
 * (Tailwind doesn't include this token by default).
 *
 * z-index: 50 (above the canvas, below modal overlays which typically use 60+).
 */

import { useRef, useCallback } from "react";

const STICK_RADIUS = 60; // half of 120px outer circle
const HANDLE_RADIUS = 25; // half of 50px inner handle

interface JoystickVec {
  x: number;
  y: number;
}

interface Props {
  /** Called whenever the left stick moves. (0,0) when not touching. */
  onLeftStick: (vec: JoystickVec) => void;
  /** Called whenever the right stick moves. (0,0) when not touching. */
  onRightStick: (vec: JoystickVec) => void;
}

interface StickState {
  pointerId: number | null;
  /** Center of the joystick in client coordinates — set on pointerdown. */
  centerX: number;
  centerY: number;
  /** Current handle offset (clamped to radius). */
  handleX: number;
  handleY: number;
}

function makeStickState(): StickState {
  return { pointerId: null, centerX: 0, centerY: 0, handleX: 0, handleY: 0 };
}

export function MobileJoysticks({ onLeftStick, onRightStick }: Props) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const leftHandleRef = useRef<HTMLDivElement>(null);
  const rightHandleRef = useRef<HTMLDivElement>(null);
  const leftState = useRef<StickState>(makeStickState());
  const rightState = useRef<StickState>(makeStickState());

  // ------------------------------------------------------------------
  // Shared pointer-event logic — used by both sticks.
  // ------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      state: React.MutableRefObject<StickState>,
      elem: HTMLDivElement,
      handleElem: HTMLDivElement | null,
      onStick: (vec: JoystickVec) => void
    ) => {
      // Only track one finger per stick. Ignore if already tracking.
      if (state.current.pointerId !== null) return;

      e.preventDefault();

      // Capture so pointermove fires even if finger drifts outside the element.
      try {
        elem.setPointerCapture(e.pointerId);
      } catch {
        // setPointerCapture can throw if the pointer is already gone.
        return;
      }

      // Use the touch position as the joystick center (natural feel on touch).
      state.current.pointerId = e.pointerId;
      state.current.centerX = e.clientX;
      state.current.centerY = e.clientY;
      state.current.handleX = 0;
      state.current.handleY = 0;

      if (handleElem) {
        handleElem.style.transform = "translate(0px, 0px)";
      }
      onStick({ x: 0, y: 0 });
    },
    []
  );

  const handlePointerMove = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      state: React.MutableRefObject<StickState>,
      handleElem: HTMLDivElement | null,
      onStick: (vec: JoystickVec) => void
    ) => {
      if (state.current.pointerId !== e.pointerId) return;

      const dx = e.clientX - state.current.centerX;
      const dy = e.clientY - state.current.centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let clampedX = dx;
      let clampedY = dy;
      if (dist > STICK_RADIUS) {
        const scale = STICK_RADIUS / dist;
        clampedX = dx * scale;
        clampedY = dy * scale;
      }

      state.current.handleX = clampedX;
      state.current.handleY = clampedY;

      if (handleElem) {
        handleElem.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
      }

      // Normalize to [-1, 1].
      const normX = clampedX / STICK_RADIUS;
      const normY = clampedY / STICK_RADIUS;
      onStick({ x: normX, y: normY });
    },
    []
  );

  const handlePointerUp = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      state: React.MutableRefObject<StickState>,
      handleElem: HTMLDivElement | null,
      onStick: (vec: JoystickVec) => void
    ) => {
      if (state.current.pointerId !== e.pointerId) return;

      state.current.pointerId = null;
      state.current.handleX = 0;
      state.current.handleY = 0;

      if (handleElem) {
        handleElem.style.transform = "translate(0px, 0px)";
      }
      onStick({ x: 0, y: 0 });
    },
    []
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  // The outer container covers the full screen but pointer-events: none
  // so the canvas underneath remains interactive everywhere except the
  // actual joystick circles.
  return (
    <div
      className="fixed inset-0 z-50 pointer-events-none"
      aria-hidden="true"
    >
      {/* Left joystick — bottom-left */}
      <div
        className="absolute bottom-6 left-6 pointer-events-auto"
        style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        <div
          ref={leftRef}
          className="relative flex items-center justify-center rounded-full select-none"
          style={{
            width: STICK_RADIUS * 2,
            height: STICK_RADIUS * 2,
            border: "2px solid rgba(255,255,255,0.3)",
            background: "rgba(255,255,255,0.05)",
            touchAction: "none",
            cursor: "none",
          }}
          onPointerDown={(e) =>
            handlePointerDown(
              e,
              leftState,
              leftRef.current!,
              leftHandleRef.current,
              onLeftStick
            )
          }
          onPointerMove={(e) =>
            handlePointerMove(e, leftState, leftHandleRef.current, onLeftStick)
          }
          onPointerUp={(e) =>
            handlePointerUp(e, leftState, leftHandleRef.current, onLeftStick)
          }
          onPointerCancel={(e) =>
            handlePointerUp(e, leftState, leftHandleRef.current, onLeftStick)
          }
        >
          {/* Inner handle */}
          <div
            ref={leftHandleRef}
            className="absolute rounded-full"
            style={{
              width: HANDLE_RADIUS * 2,
              height: HANDLE_RADIUS * 2,
              background: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(255,255,255,0.6)",
              pointerEvents: "none",
              willChange: "transform",
            }}
          />
        </div>
      </div>

      {/* Right joystick — bottom-right */}
      <div
        className="absolute bottom-6 right-6 pointer-events-auto"
        style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        <div
          ref={rightRef}
          className="relative flex items-center justify-center rounded-full select-none"
          style={{
            width: STICK_RADIUS * 2,
            height: STICK_RADIUS * 2,
            border: "2px solid rgba(255,255,255,0.3)",
            background: "rgba(255,255,255,0.05)",
            touchAction: "none",
            cursor: "none",
          }}
          onPointerDown={(e) =>
            handlePointerDown(
              e,
              rightState,
              rightRef.current!,
              rightHandleRef.current,
              onRightStick
            )
          }
          onPointerMove={(e) =>
            handlePointerMove(e, rightState, rightHandleRef.current, onRightStick)
          }
          onPointerUp={(e) =>
            handlePointerUp(e, rightState, rightHandleRef.current, onRightStick)
          }
          onPointerCancel={(e) =>
            handlePointerUp(e, rightState, rightHandleRef.current, onRightStick)
          }
        >
          {/* Inner handle */}
          <div
            ref={rightHandleRef}
            className="absolute rounded-full"
            style={{
              width: HANDLE_RADIUS * 2,
              height: HANDLE_RADIUS * 2,
              background: "rgba(255,255,255,0.4)",
              border: "1px solid rgba(255,255,255,0.6)",
              pointerEvents: "none",
              willChange: "transform",
            }}
          />
        </div>
      </div>
    </div>
  );
}
