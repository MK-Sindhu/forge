import { describe, it, expect } from "vitest";
import {
  computeMovement,
  WALK_SPEED,
  RUN_SPEED,
  TOUCH_YAW_SPEED,
  TOUCH_PITCH_SPEED,
} from "./movement";

// No mocks — computeMovement is a pure function with no external I/O.

describe("computeMovement — zero input", () => {
  it("returns zero positionDelta, yawDelta, and pitchDelta when input is all zeros", () => {
    const result = computeMovement({
      input: { forward: 0, strafe: 0 },
      yaw: 0,
      running: false,
      delta: 0.016,
    });
    expect(result.positionDelta.x).toBeCloseTo(0);
    expect(result.positionDelta.y).toBeCloseTo(0);
    expect(result.positionDelta.z).toBeCloseTo(0);
    // Use toBeCloseTo — negative-zero (-0) is a valid IEEE 754 result from
    // -(0) * constant and toBe(0) would fail (Object.is(-0, 0) === false).
    expect(result.yawDelta).toBeCloseTo(0);
    expect(result.pitchDelta).toBeCloseTo(0);
  });
});

describe("computeMovement — forward at yaw=0", () => {
  it("moves along -Z (camera looks down -Z at yaw=0)", () => {
    const result = computeMovement({
      input: { forward: 1, strafe: 0 },
      yaw: 0,
      running: false,
      delta: 1,
    });
    // forward axis at yaw=0: (-sin(0), 0, -cos(0)) = (0, 0, -1)
    // worldX = 1 * (-sin(0)) = 0; worldZ = 1 * (-cos(0)) = -1
    // positionDelta = (0 * WALK_SPEED, 0, -1 * WALK_SPEED) at delta=1
    expect(result.positionDelta.z).toBeCloseTo(-WALK_SPEED);
    expect(result.positionDelta.x).toBeCloseTo(0);
    expect(result.positionDelta.y).toBe(0);
  });
});

describe("computeMovement — yaw-relative direction", () => {
  it("moves along -X when yaw=PI/2 (camera now faces -X direction)", () => {
    const result = computeMovement({
      input: { forward: 1, strafe: 0 },
      yaw: Math.PI / 2,
      running: false,
      delta: 1,
    });
    // forward axis at yaw=PI/2: (-sin(PI/2), 0, -cos(PI/2)) = (-1, 0, 0)
    // worldX = 1 * (-sin(PI/2)) = -1; worldZ = 1 * (-cos(PI/2)) = 0
    // positionDelta = (-WALK_SPEED, 0, 0)
    expect(result.positionDelta.x).toBeCloseTo(-WALK_SPEED);
    expect(result.positionDelta.z).toBeCloseTo(0);
    expect(result.positionDelta.y).toBe(0);
  });
});

describe("computeMovement — run speed", () => {
  it("doubles the speed when running=true compared to walking", () => {
    const walk = computeMovement({
      input: { forward: 1, strafe: 0 },
      yaw: 0,
      running: false,
      delta: 1,
    });
    const run = computeMovement({
      input: { forward: 1, strafe: 0 },
      yaw: 0,
      running: true,
      delta: 1,
    });
    // Walk: positionDelta.z = -WALK_SPEED; Run: positionDelta.z = -RUN_SPEED
    expect(run.positionDelta.z).toBeCloseTo(-RUN_SPEED);
    expect(walk.positionDelta.z).toBeCloseTo(-WALK_SPEED);
    expect(RUN_SPEED).toBe(WALK_SPEED * 2);
  });
});

describe("computeMovement — diagonal normalization", () => {
  it("diagonal input produces speed equal to cardinal (not sqrt(2) faster)", () => {
    const result = computeMovement({
      input: { forward: 1, strafe: 1 },
      yaw: 0,
      running: false,
      delta: 1,
    });
    // Raw vector length = sqrt(2) > 1 → normalised to (1/sqrt2, 1/sqrt2)
    // positionDelta length should equal WALK_SPEED, not WALK_SPEED * sqrt(2)
    const length = result.positionDelta.length();
    expect(length).toBeCloseTo(WALK_SPEED);
  });
});

describe("computeMovement — frame-rate independence", () => {
  it("half delta produces half the position delta (linear scaling)", () => {
    const full = computeMovement({
      input: { forward: 1, strafe: 0 },
      yaw: 0,
      running: false,
      delta: 1,
    });
    const half = computeMovement({
      input: { forward: 1, strafe: 0 },
      yaw: 0,
      running: false,
      delta: 0.5,
    });
    expect(half.positionDelta.z).toBeCloseTo(full.positionDelta.z / 2);
    expect(half.positionDelta.x).toBeCloseTo(full.positionDelta.x / 2);
  });
});

describe("computeMovement — touch yawRate", () => {
  it("positive yawRate produces negative yawDelta (look-right = clockwise rotation)", () => {
    const result = computeMovement({
      input: { forward: 0, strafe: 0, yawRate: 1 },
      yaw: 0,
      running: false,
      delta: 1,
    });
    // yawDelta = -(yawRate) * TOUCH_YAW_SPEED * delta = -1 * 2.5 * 1 = -2.5
    expect(result.yawDelta).toBeCloseTo(-TOUCH_YAW_SPEED);
  });

  it("positive pitchRate produces negative pitchDelta", () => {
    const result = computeMovement({
      input: { forward: 0, strafe: 0, pitchRate: 1 },
      yaw: 0,
      running: false,
      delta: 1,
    });
    // pitchDelta = -(pitchRate) * TOUCH_PITCH_SPEED * delta = -1.5
    expect(result.pitchDelta).toBeCloseTo(-TOUCH_PITCH_SPEED);
  });
});
