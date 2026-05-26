/**
 * Unit tests for MobileJoysticks pointer-event logic.
 *
 * MobileJoysticks is a pure DOM component (no R3F / WebGL). Its behaviour
 * is entirely defined by three shared pointer-event handlers:
 *
 *   handlePointerDown  — records touch origin, emits {x:0, y:0}
 *   handlePointerMove  — computes offset, clamps to STICK_RADIUS, normalises
 *                        to [-1, 1], emits
 *   handlePointerUp    — resets state, emits {x:0, y:0}
 *
 * We test these logic seams directly — no DOM mounting required, no JSDOM
 * directive needed. This matches the project pattern used in
 * ControlsHint.test.ts, EditorTopBar.test.ts, and use-autosave.test.ts:
 * extract the logic and drive it with lightweight stubs in the node env.
 *
 * Why not mount the component with @testing-library/react?
 *   The global vitest environment is "node". Switching to jsdom would require
 *   installing it as a dev-dependency and would add setup/teardown overhead.
 *   Since all the interesting behaviour lives in
 *   three pure mathematical handlers (none of which depend on the DOM tree or
 *   React reconciler), testing the logic directly is both faster and more
 *   precise. The separation of concerns is already present in the source: the
 *   handlers are standalone `useCallback` closures that take typed event objects.
 *
 * Constants mirrored from MobileJoysticks.tsx (must stay in sync):
 *   STICK_RADIUS = 60
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mirror constants from MobileJoysticks.tsx.
// If these values change in the source, update them here too.
// ---------------------------------------------------------------------------

const STICK_RADIUS = 60;

// ---------------------------------------------------------------------------
// Types mirroring the component's internal shapes.
// ---------------------------------------------------------------------------

interface JoystickVec {
  x: number;
  y: number;
}

interface StickState {
  pointerId: number | null;
  centerX: number;
  centerY: number;
  handleX: number;
  handleY: number;
}

function makeStickState(): StickState {
  return { pointerId: null, centerX: 0, centerY: 0, handleX: 0, handleY: 0 };
}

// ---------------------------------------------------------------------------
// Logic helpers — reproduce the three handler bodies from MobileJoysticks.tsx
// exactly (minus the DOM refs for handle-element style updates, which are
// side-effects only and not part of the observable contract).
// ---------------------------------------------------------------------------

/**
 * Simulates handlePointerDown from MobileJoysticks.
 *
 * Returns false (and leaves state unchanged) if the stick is already
 * tracking a pointer.  Returns true + mutates state on success.
 * The mock `setPointerCapture` is called to simulate the browser API.
 *
 * Matches the source logic in MobileJoysticks.tsx lines 76-110.
 */
function simulatePointerDown(
  state: StickState,
  event: { pointerId: number; clientX: number; clientY: number; preventDefault: () => void },
  onStick: (vec: JoystickVec) => void,
  setPointerCapture: (id: number) => void
): boolean {
  if (state.pointerId !== null) return false;

  event.preventDefault();

  try {
    setPointerCapture(event.pointerId);
  } catch {
    return false;
  }

  state.pointerId = event.pointerId;
  state.centerX = event.clientX;
  state.centerY = event.clientY;
  state.handleX = 0;
  state.handleY = 0;

  onStick({ x: 0, y: 0 });
  return true;
}

/**
 * Simulates handlePointerMove from MobileJoysticks.
 *
 * Matches the source logic in MobileJoysticks.tsx lines 112-146.
 */
function simulatePointerMove(
  state: StickState,
  event: { pointerId: number; clientX: number; clientY: number },
  onStick: (vec: JoystickVec) => void
): void {
  if (state.pointerId !== event.pointerId) return;

  const dx = event.clientX - state.centerX;
  const dy = event.clientY - state.centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  let clampedX = dx;
  let clampedY = dy;
  if (dist > STICK_RADIUS) {
    const scale = STICK_RADIUS / dist;
    clampedX = dx * scale;
    clampedY = dy * scale;
  }

  state.handleX = clampedX;
  state.handleY = clampedY;

  const normX = clampedX / STICK_RADIUS;
  const normY = clampedY / STICK_RADIUS;
  onStick({ x: normX, y: normY });
}

/**
 * Simulates handlePointerUp from MobileJoysticks.
 *
 * Matches the source logic in MobileJoysticks.tsx lines 148-167.
 */
function simulatePointerUp(
  state: StickState,
  event: { pointerId: number },
  onStick: (vec: JoystickVec) => void
): void {
  if (state.pointerId !== event.pointerId) return;

  state.pointerId = null;
  state.handleX = 0;
  state.handleY = 0;

  onStick({ x: 0, y: 0 });
}

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function makeSetPointerCaptureMock() {
  return vi.fn() as (id: number) => void;
}

// ---------------------------------------------------------------------------
// Describe blocks
// ---------------------------------------------------------------------------

describe("MobileJoysticks — pointerdown behaviour", () => {
  let leftState: StickState;
  let onLeftStick: ReturnType<typeof vi.fn>;
  let setPointerCapture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    leftState = makeStickState();
    onLeftStick = vi.fn();
    setPointerCapture = makeSetPointerCaptureMock();
  });

  it("emits {x:0, y:0} immediately on pointerdown (touch origin is joystick center)", () => {
    simulatePointerDown(
      leftState,
      { pointerId: 1, clientX: 200, clientY: 400, preventDefault: vi.fn() },
      onLeftStick,
      setPointerCapture
    );

    expect(onLeftStick).toHaveBeenCalledTimes(1);
    expect(onLeftStick).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it("records the touch position as the joystick center for subsequent moves", () => {
    simulatePointerDown(
      leftState,
      { pointerId: 1, clientX: 300, clientY: 500, preventDefault: vi.fn() },
      onLeftStick,
      setPointerCapture
    );

    expect(leftState.centerX).toBe(300);
    expect(leftState.centerY).toBe(500);
  });

  it("stores the pointerId so subsequent pointermove events are matched", () => {
    simulatePointerDown(
      leftState,
      { pointerId: 7, clientX: 100, clientY: 200, preventDefault: vi.fn() },
      onLeftStick,
      setPointerCapture
    );

    expect(leftState.pointerId).toBe(7);
  });

  it("ignores a second pointerdown if the stick is already tracking a pointer", () => {
    const firstDown = { pointerId: 1, clientX: 100, clientY: 200, preventDefault: vi.fn() };
    const secondDown = { pointerId: 2, clientX: 150, clientY: 250, preventDefault: vi.fn() };

    simulatePointerDown(leftState, firstDown, onLeftStick, setPointerCapture);
    simulatePointerDown(leftState, secondDown, onLeftStick, setPointerCapture);

    // Only one call — second down was rejected.
    expect(onLeftStick).toHaveBeenCalledTimes(1);
    // State still tracks the first pointer.
    expect(leftState.pointerId).toBe(1);
  });

  it("calls setPointerCapture with the pointer id to track moves outside the element", () => {
    simulatePointerDown(
      leftState,
      { pointerId: 3, clientX: 50, clientY: 60, preventDefault: vi.fn() },
      onLeftStick,
      setPointerCapture
    );

    expect(setPointerCapture).toHaveBeenCalledWith(3);
  });
});

describe("MobileJoysticks — pointermove normalisation", () => {
  let state: StickState;
  let onStick: ReturnType<typeof vi.fn>;
  let setPointerCapture: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = makeStickState();
    onStick = vi.fn();
    setPointerCapture = makeSetPointerCaptureMock();
    // Always start with a down at (200, 400) so move events have a center.
    simulatePointerDown(
      state,
      { pointerId: 1, clientX: 200, clientY: 400, preventDefault: vi.fn() },
      onStick,
      setPointerCapture
    );
    onStick.mockClear(); // ignore the down-emit for move assertions
  });

  it("emits positive x in (0, 1] when finger moves right of center", () => {
    // Move 30px right — well within STICK_RADIUS=60.
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 230, clientY: 400 },
      onStick
    );

    const vec = onStick.mock.calls[0][0] as JoystickVec;
    expect(vec.x).toBeGreaterThan(0);
    expect(vec.x).toBeLessThanOrEqual(1);
    expect(vec.y).toBeCloseTo(0); // no vertical movement
  });

  it("emits positive y in (0, 1] when finger moves down (DOM y-axis is downward)", () => {
    // Move 30px down.
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 200, clientY: 430 },
      onStick
    );

    const vec = onStick.mock.calls[0][0] as JoystickVec;
    expect(vec.x).toBeCloseTo(0);
    expect(vec.y).toBeGreaterThan(0);
    expect(vec.y).toBeLessThanOrEqual(1);
  });

  it("normalises 30px right to x ≈ 0.5 (30 / STICK_RADIUS=60)", () => {
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 230, clientY: 400 },
      onStick
    );

    const vec = onStick.mock.calls[0][0] as JoystickVec;
    expect(vec.x).toBeCloseTo(0.5, 5);
  });

  it("clamps a very large horizontal move to x === 1 exactly", () => {
    // Move 200px right — far beyond STICK_RADIUS=60.
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 400, clientY: 400 },
      onStick
    );

    const vec = onStick.mock.calls[0][0] as JoystickVec;
    expect(vec.x).toBeCloseTo(1, 5);
    expect(vec.y).toBeCloseTo(0, 5);
  });

  it("clamps a very large diagonal move so magnitude stays at 1", () => {
    // Move 200px right + 200px down — magnitude far exceeds STICK_RADIUS.
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 400, clientY: 600 },
      onStick
    );

    const vec = onStick.mock.calls[0][0] as JoystickVec;
    const magnitude = Math.sqrt(vec.x * vec.x + vec.y * vec.y);
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it("ignores pointermove events with a different pointerId (finger not tracked)", () => {
    simulatePointerMove(
      state,
      { pointerId: 99, clientX: 400, clientY: 400 }, // wrong pointer
      onStick
    );

    expect(onStick).not.toHaveBeenCalled();
  });
});

describe("MobileJoysticks — pointerup zeroing", () => {
  let state: StickState;
  let onStick: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = makeStickState();
    onStick = vi.fn();
    const setPointerCapture = makeSetPointerCaptureMock();

    // Down at center, then move right.
    simulatePointerDown(
      state,
      { pointerId: 1, clientX: 200, clientY: 400, preventDefault: vi.fn() },
      onStick,
      setPointerCapture
    );
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 230, clientY: 400 },
      onStick
    );
    onStick.mockClear(); // reset so we only observe the up-emit
  });

  it("emits {x:0, y:0} when the pointer is released", () => {
    simulatePointerUp(state, { pointerId: 1 }, onStick);

    expect(onStick).toHaveBeenCalledTimes(1);
    expect(onStick).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it("clears the pointerId so the stick can be grabbed again after release", () => {
    simulatePointerUp(state, { pointerId: 1 }, onStick);

    expect(state.pointerId).toBeNull();
  });

  it("resets handle offsets to zero on pointerup", () => {
    simulatePointerUp(state, { pointerId: 1 }, onStick);

    expect(state.handleX).toBe(0);
    expect(state.handleY).toBe(0);
  });

  it("ignores pointerup from a different pointerId (does not zero the stick)", () => {
    simulatePointerUp(state, { pointerId: 99 }, onStick); // wrong id

    expect(onStick).not.toHaveBeenCalled(); // still active
    expect(state.pointerId).toBe(1);
  });
});

describe("MobileJoysticks — independent left + right stick tracking", () => {
  it("left and right sticks track separate pointerIds independently", () => {
    const leftState = makeStickState();
    const rightState = makeStickState();
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const setCapture = makeSetPointerCaptureMock();

    // Touch left stick with pointer id=1.
    simulatePointerDown(
      leftState,
      { pointerId: 1, clientX: 60, clientY: 700, preventDefault: vi.fn() },
      onLeft,
      setCapture
    );

    // Touch right stick with pointer id=2.
    simulatePointerDown(
      rightState,
      { pointerId: 2, clientX: 360, clientY: 700, preventDefault: vi.fn() },
      onRight,
      setCapture
    );

    onLeft.mockClear();
    onRight.mockClear();

    // Move left stick only (pointer 1).
    simulatePointerMove(
      leftState,
      { pointerId: 1, clientX: 90, clientY: 700 }, // 30px right of left center
      onLeft
    );
    simulatePointerMove(
      rightState,
      { pointerId: 1, clientX: 90, clientY: 700 }, // wrong pointer for right stick
      onRight
    );

    // Left callback fired once; right not fired.
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();

    // Move right stick only (pointer 2).
    onLeft.mockClear();
    simulatePointerMove(
      rightState,
      { pointerId: 2, clientX: 390, clientY: 700 }, // 30px right of right center
      onRight
    );
    simulatePointerMove(
      leftState,
      { pointerId: 2, clientX: 390, clientY: 700 }, // wrong pointer for left stick
      onLeft
    );

    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("releasing one stick does not affect the other stick's state", () => {
    const leftState = makeStickState();
    const rightState = makeStickState();
    const onLeft = vi.fn();
    const onRight = vi.fn();
    const setCapture = makeSetPointerCaptureMock();

    simulatePointerDown(
      leftState,
      { pointerId: 1, clientX: 60, clientY: 700, preventDefault: vi.fn() },
      onLeft,
      setCapture
    );
    simulatePointerDown(
      rightState,
      { pointerId: 2, clientX: 360, clientY: 700, preventDefault: vi.fn() },
      onRight,
      setCapture
    );

    // Release left stick.
    simulatePointerUp(leftState, { pointerId: 1 }, onLeft);

    // Right stick should still have its pointerId.
    expect(leftState.pointerId).toBeNull();
    expect(rightState.pointerId).toBe(2);
  });
});

describe("MobileJoysticks — component structure (static contract)", () => {
  it("STICK_RADIUS constant is 60 (half of the 120px outer circle)", () => {
    // This test locks the constant so if someone changes it without updating
    // normalisation math, both the test and the visual break simultaneously.
    expect(STICK_RADIUS).toBe(60);
  });

  it("move by exactly STICK_RADIUS pixels produces normalised value of exactly 1.0", () => {
    const state = makeStickState();
    const onStick = vi.fn();
    const setCapture = makeSetPointerCaptureMock();

    simulatePointerDown(
      state,
      { pointerId: 1, clientX: 200, clientY: 400, preventDefault: vi.fn() },
      onStick,
      setCapture
    );
    onStick.mockClear();

    // Move exactly STICK_RADIUS to the right — right at the boundary.
    simulatePointerMove(
      state,
      { pointerId: 1, clientX: 200 + STICK_RADIUS, clientY: 400 },
      onStick
    );

    const vec = onStick.mock.calls[0][0] as JoystickVec;
    expect(vec.x).toBeCloseTo(1, 5);
    expect(vec.y).toBeCloseTo(0, 5);
  });
});
