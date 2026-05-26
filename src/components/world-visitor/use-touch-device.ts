"use client";

import { useEffect, useState } from "react";

/**
 * Returns true if the user is on a touch device. Detected via `ontouchstart in window`
 * + `navigator.maxTouchPoints > 0`. Hydration-safe (always returns false on first render
 * to match SSR; then re-renders on mount with the actual value).
 */
export function useTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);
  useEffect(() => {
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTouch(touch);
  }, []);
  return isTouch;
}
