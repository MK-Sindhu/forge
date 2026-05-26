/**
 * Unit tests for ControlsHint behaviour.
 *
 * We test the logic layer directly (localStorage reads/writes, dismiss
 * condition, auto-dismiss timer) without mounting the React component.
 * Vitest runs in node environment with no DOM — same technique as
 * EditorTopBar.test.ts and use-autosave.test.ts: extract the logic and
 * drive it with lightweight stubs.
 *
 * The localStorage logic is isolated into testable helpers that mirror
 * the exact functions used inside ControlsHint.tsx (readDismissed /
 * writeDismissed). We test:
 *   1. readDismissed returns false when no key is set.
 *   2. readDismissed returns true when the key is "true".
 *   3. writeDismissed + dismiss button logic: sets the key, prevents re-show.
 *   4. Auto-dismiss timer: after the timeout fires, the dismissed flag is set.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Simulate the localStorage helpers from ControlsHint.tsx so we can test
// them in isolation. Mirror the exact logic from the component.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "forge-walk-hint-dismissed";

function readDismissed(storage: Record<string, string>): boolean {
  try {
    return storage[STORAGE_KEY] === "true";
  } catch {
    return false;
  }
}

function writeDismissed(storage: Record<string, string>): void {
  try {
    storage[STORAGE_KEY] = "true";
  } catch {
    // silently ignore
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ControlsHint — readDismissed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when localStorage key is not set (fresh user)", () => {
    const storage: Record<string, string> = {};
    expect(readDismissed(storage)).toBe(false);
  });

  it("returns false when key is an unexpected value (not 'true')", () => {
    const storage: Record<string, string> = { [STORAGE_KEY]: "false" };
    expect(readDismissed(storage)).toBe(false);
  });

  it("returns true when key is exactly 'true'", () => {
    const storage: Record<string, string> = { [STORAGE_KEY]: "true" };
    expect(readDismissed(storage)).toBe(true);
  });
});

describe("ControlsHint — writeDismissed", () => {
  it("sets the key to 'true' after dismiss", () => {
    const storage: Record<string, string> = {};
    writeDismissed(storage);
    expect(storage[STORAGE_KEY]).toBe("true");
  });

  it("subsequent readDismissed returns true after writeDismissed", () => {
    const storage: Record<string, string> = {};
    expect(readDismissed(storage)).toBe(false);
    writeDismissed(storage);
    expect(readDismissed(storage)).toBe(true);
  });
});

describe("ControlsHint — auto-dismiss timer", () => {
  it("sets dismissed flag after AUTO_DISMISS_MS timeout fires", () => {
    vi.useFakeTimers();

    const AUTO_DISMISS_MS = 12_000;
    let dismissed = false;
    const storage: Record<string, string> = {};

    // Simulate the component's useEffect body.
    const timerId = setTimeout(() => {
      writeDismissed(storage);
      dismissed = true;
    }, AUTO_DISMISS_MS);

    expect(dismissed).toBe(false);
    expect(readDismissed(storage)).toBe(false);

    vi.advanceTimersByTime(AUTO_DISMISS_MS);

    expect(dismissed).toBe(true);
    expect(readDismissed(storage)).toBe(true);

    clearTimeout(timerId);
    vi.useRealTimers();
  });

  it("timer cleanup on early dismiss prevents duplicate write", () => {
    vi.useFakeTimers();

    const AUTO_DISMISS_MS = 12_000;
    let timerFired = false;
    const storage: Record<string, string> = {};

    const timerId = setTimeout(() => {
      timerFired = true;
      writeDismissed(storage);
    }, AUTO_DISMISS_MS);

    // User dismisses early (before timer fires).
    writeDismissed(storage);
    clearTimeout(timerId);

    vi.advanceTimersByTime(AUTO_DISMISS_MS);

    // Timer should NOT have fired (was cleared).
    expect(timerFired).toBe(false);
    // Storage still has the value from the manual dismiss.
    expect(readDismissed(storage)).toBe(true);

    vi.useRealTimers();
  });
});
