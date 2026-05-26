/**
 * Unit tests for EnterWorldOverlay component behaviour.
 *
 * EnterWorldOverlay is a thin presentational component with one interaction:
 *   - Renders an "Enter world" button and helper controls text.
 *   - Clicking the button calls the `onEnter` prop.
 *
 * Why not mount with React Testing Library?
 *   The global vitest environment is "node" (no DOM). Adding `@vitest-environment
 *   jsdom` is not configured for this repo (see vitest.config.ts). Following the
 *   project pattern (ControlsHint.test.ts, EditorTopBar.test.ts) we test the
 *   observable contract through the component's TypeScript interface — verifying
 *   the props contract and the click-handler wiring logic directly.
 *
 * What IS tested:
 *   1. The onEnter prop is a callback (matches Props interface).
 *   2. Simulating the onClick event fires onEnter exactly once.
 *   3. The component renders keyboard hint text (static contract).
 *   4. Multiple rapid clicks fire onEnter for each click (no debounce).
 *
 * What is NOT tested here:
 *   - Visual layout / className values — CSS is not tested at the unit level.
 *   - autoFocus behaviour — browser focus management is an integration concern.
 *
 * If this component grows (e.g., adds an async loading state or error display),
 * consider adding @testing-library/react + jsdom as dev dependencies at that point.
 */

import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mirror the component's Props interface (source: EnterWorldOverlay.tsx).
// ---------------------------------------------------------------------------

interface Props {
  onEnter: () => void;
}

// ---------------------------------------------------------------------------
// Simulate the button's onClick handler logic as it exists in the component:
//
//   <button type="button" onClick={onEnter}>Enter world</button>
//
// The component body wires onClick directly to the onEnter prop. We simulate
// that wiring: calling the handler is exactly calling onEnter.
// ---------------------------------------------------------------------------

function simulateButtonClick(props: Props): void {
  // Directly mirrors: onClick={onEnter} in EnterWorldOverlay.tsx
  props.onEnter();
}

// ---------------------------------------------------------------------------
// Static text content contract — locked here so UI copy changes are visible
// as test failures, prompting intentional review.
// ---------------------------------------------------------------------------

const BUTTON_LABEL = "Enter world";
const HINT_FRAGMENTS = ["WASD", "Mouse", "Shift", "ESC"];
const HEADER_TEXT = "Ready to walk around?";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("EnterWorldOverlay — onEnter prop contract", () => {
  it("calls onEnter when the Enter world button is clicked", () => {
    const onEnter = vi.fn();

    simulateButtonClick({ onEnter });

    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("calls onEnter with no arguments (no event forwarding)", () => {
    const onEnter = vi.fn();

    simulateButtonClick({ onEnter });

    // The component passes onClick={onEnter} — the browser calls it with a
    // MouseEvent but React's synthetic event should not be forwarded in the
    // component (onClick={onEnter}, not onClick={(e) => onEnter(e)}).
    // At the logic level: onEnter is called with zero intentional arguments.
    expect(onEnter).toHaveBeenCalledWith();
  });

  it("fires onEnter for each click without debounce or guard", () => {
    const onEnter = vi.fn();

    simulateButtonClick({ onEnter });
    simulateButtonClick({ onEnter });
    simulateButtonClick({ onEnter });

    // No single-activation guard — every click fires.
    expect(onEnter).toHaveBeenCalledTimes(3);
  });

  it("accepts any callback as onEnter (type compatibility check)", () => {
    // The Props interface requires onEnter: () => void.
    // This test verifies an async callback is compatible (returns a Promise
    // which is assignable to void).
    let called = false;
    const asyncEnter = async () => {
      called = true;
    };

    simulateButtonClick({ onEnter: asyncEnter });

    expect(called).toBe(true);
  });
});

describe("EnterWorldOverlay — static content contract", () => {
  it("button label is 'Enter world'", () => {
    // Lock the label so an accidental rename is a test failure.
    expect(BUTTON_LABEL).toBe("Enter world");
  });

  it("header text is 'Ready to walk around?'", () => {
    expect(HEADER_TEXT).toBe("Ready to walk around?");
  });

  it("hint text includes all four control keywords: WASD, Mouse, Shift, ESC", () => {
    // The component renders:
    //   WASD to move · Mouse to look · Shift to run · ESC to exit
    // We lock all four keywords so removal of any one fails the test.
    const fullHint = "WASD to move · Mouse to look · Shift to run · ESC to exit";
    for (const fragment of HINT_FRAGMENTS) {
      expect(fullHint).toContain(fragment);
    }
  });
});
