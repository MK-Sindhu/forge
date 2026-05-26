/**
 * Hash a string to an HSL hue 0-359 (saturation + lightness fixed).
 * Used to give each visitor a consistent color across sessions.
 *
 * Algorithm: simple djb2-style hash, mod 360. Collision rate is ~1/360
 * which is acceptable for v1 (users with the same color in the same room
 * is rare + recoverable via the name tag).
 */
export function visitorColor(id: string): string {
  let hash = 5381;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) + hash) + id.charCodeAt(i);
    hash |= 0; // force 32-bit
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}
