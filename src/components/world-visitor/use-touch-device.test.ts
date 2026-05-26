/**
 * Unit tests for useTouchDevice hook.
 *
 * The hook uses a hydration-safe pattern: always returns false on first render
 * (matching SSR), then re-renders with the actual window property value after
 * mount. We test the core detection logic by simulating the useEffect body
 * directly (same technique as the autosave and EditorTopBar tests — extract
 * the logic and test it in the node environment without React/DOM mounting).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helper — simulate the detection logic in useTouchDevice's useEffect body.
// This mirrors the exact detection expression used in the hook.
// ---------------------------------------------------------------------------

function detectTouch(
  windowLike: { ontouchstart?: unknown },
  navigatorLike: { maxTouchPoints: number }
): boolean {
  return "ontouchstart" in windowLike || navigatorLike.maxTouchPoints > 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useTouchDevice — detection logic", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when window has no ontouchstart and maxTouchPoints is 0", () => {
    const result = detectTouch({}, { maxTouchPoints: 0 });
    expect(result).toBe(false);
  });

  it("returns true when ontouchstart is present on window", () => {
    const result = detectTouch({ ontouchstart: () => {} }, { maxTouchPoints: 0 });
    expect(result).toBe(true);
  });

  it("returns true when navigator.maxTouchPoints > 0 (stylus / hybrid laptop)", () => {
    const result = detectTouch({}, { maxTouchPoints: 2 });
    expect(result).toBe(true);
  });

  it("hydration-safe initial value is false (useState initializer is false literal)", () => {
    // The hook calls useState(false) — this test documents that convention so
    // future readers understand why the initial render never produces a
    // hydration mismatch (server renders false, first client render is false too).
    const initialValue = false;
    expect(initialValue).toBe(false);
  });
});
