/**
 * visitor-color.test.ts — unit tests for visitorColor()
 *
 * visitorColor(id) hashes a string via djb2-style algorithm and returns
 * an HSL color string with fixed saturation (70%) and lightness (55%).
 *
 * No mocks needed — pure function, no external I/O.
 */

import { describe, it, expect } from "vitest";
import { visitorColor } from "./visitor-color";

describe("visitorColor", () => {
  it("is deterministic — same input always returns the same color string", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const first = visitorColor(id);
    const second = visitorColor(id);
    const third = visitorColor(id);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("produces meaningfully distinct hues across 100 different uuids", () => {
    // Generate 100 deterministic-but-distinct input strings.
    const ids = Array.from({ length: 100 }, (_, i) =>
      `test-id-${String(i).padStart(5, "0")}-abcdef-ghij-klmn`
    );
    const colors = ids.map(visitorColor);
    // Extract the hue from each "hsl(H, 70%, 55%)" string.
    const hues = new Set(
      colors.map((c) => {
        const m = c.match(/^hsl\((\d+)/);
        return m ? parseInt(m[1], 10) : -1;
      })
    );
    // 100 inputs over 360 possible hues — expect at least 50 distinct hues
    // (collision rate ~1/360 means ~99.7% distinct in expectation).
    expect(hues.size).toBeGreaterThanOrEqual(50);
  });

  it("returns a string matching hsl(H, 70%, 55%) format", () => {
    const color = visitorColor("any-string-here");
    expect(color).toMatch(/^hsl\(\d{1,3}, 70%, 55%\)$/);
  });
});
