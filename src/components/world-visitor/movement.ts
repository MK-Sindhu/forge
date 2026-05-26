import { Vector3 } from "three";

// ---------------------------------------------------------------------------
// MovementInput — describes raw directional input for one frame.
// ---------------------------------------------------------------------------

export interface MovementInput {
  /** Desktop WASD or touch joystick: forward/back component. -1 (back) to 1 (forward). */
  forward: number;
  /** Strafe: -1 (left) to 1 (right). */
  strafe: number;
  /**
   * Yaw-rotation rate in radians/sec for touch right-joystick.
   * 0 for desktop (mouse handles yaw via PointerLockControls).
   */
  yawRate?: number;
  /**
   * Pitch-rotation rate in radians/sec for touch right-joystick.
   * 0 for desktop.
   */
  pitchRate?: number;
}

// ---------------------------------------------------------------------------
// MovementResult — output of computeMovement for one frame.
// ---------------------------------------------------------------------------

export interface MovementResult {
  /**
   * XZ-plane delta to add to camera.position.
   * Y is always 0 — collision step handles vertical position.
   */
  positionDelta: Vector3;
  /** Yaw delta in radians to add to the camera yaw (for touch). 0 for desktop. */
  yawDelta: number;
  /** Pitch delta in radians. 0 for desktop. */
  pitchDelta: number;
}

// ---------------------------------------------------------------------------
// Speed constants
// ---------------------------------------------------------------------------

export const WALK_SPEED = 4; // units/sec
export const RUN_SPEED = 8; // units/sec when Shift held
export const TOUCH_YAW_SPEED = 2.5; // rad/sec at full right-stick deflection
export const TOUCH_PITCH_SPEED = 1.5; // rad/sec at full right-stick deflection

// ---------------------------------------------------------------------------
// computeMovement — pure movement math.
//
// Combines directional input + current camera yaw into a world-space
// position delta. Frame-rate independent (delta in seconds).
//
// Coordinate conventions (Three.js default camera orientation):
//   - Camera looks down -Z when yaw = 0.
//   - forward direction (yaw = 0): (0, 0, -1) → world -Z
//   - right/strafe direction (yaw = 0): (1, 0, 0) → world +X
//   - When yaw rotates positively (counter-clockwise from above):
//       forward = (-sin(yaw), 0, -cos(yaw))
//       strafe  = ( cos(yaw), 0, -sin(yaw))
//
// Touch yaw convention:
//   Right-stick X positive → look right → negative yaw delta (world space
//   uses left-hand Y-up, so rotating camera clockwise = negative rotation.y).
// ---------------------------------------------------------------------------

export function computeMovement(args: {
  input: MovementInput;
  yaw: number; // current camera yaw in radians (camera.rotation.y)
  running: boolean; // Shift held (desktop) — touch always uses WALK_SPEED
  delta: number; // frame delta in seconds
}): MovementResult {
  const { input, yaw, running, delta } = args;

  // 1. Zero delta-time → zero movement.
  if (delta === 0) {
    return {
      positionDelta: new Vector3(0, 0, 0),
      yawDelta: 0,
      pitchDelta: 0,
    };
  }

  // 2. Normalize (forward, strafe) so diagonal is not faster than cardinal.
  //    Clamp the combined length to 1.0, preserving direction.
  const rawLen = Math.sqrt(input.forward * input.forward + input.strafe * input.strafe);
  let normForward = input.forward;
  let normStrafe = input.strafe;
  if (rawLen > 1.0) {
    normForward = input.forward / rawLen;
    normStrafe = input.strafe / rawLen;
  }

  // 3. Determine speed. Touch always walks (Shift is a desktop modifier).
  const speed = running ? RUN_SPEED : WALK_SPEED;

  // 4. Compute world-space direction from yaw + normalized input.
  //    forward axis (camera -Z in world): (-sin(yaw), 0, -cos(yaw))
  //    strafe  axis (camera +X in world): ( cos(yaw), 0, -sin(yaw))
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  const worldX = normForward * (-sinYaw) + normStrafe * cosYaw;
  const worldZ = normForward * (-cosYaw) + normStrafe * (-sinYaw);

  // 5. Scale by speed and delta time.
  const positionDelta = new Vector3(worldX * speed * delta, 0, worldZ * speed * delta);

  // 6. Touch rotation deltas.
  //    yawRate > 0 (right-stick right) → look right → negative yaw delta.
  const yawDelta = -(input.yawRate ?? 0) * TOUCH_YAW_SPEED * delta;
  const pitchDelta = -(input.pitchRate ?? 0) * TOUCH_PITCH_SPEED * delta;

  return { positionDelta, yawDelta, pitchDelta };
}
