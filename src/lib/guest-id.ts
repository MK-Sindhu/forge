const STORAGE_KEY = "forge_guest_id";

/**
 * Generate a random guest id like "K3F9". 4 alphanumeric chars (uppercase) →
 * 36^4 = ~1.68M combinations. Collision within one world is extremely
 * unlikely in early days. Document the upper bound; if a user reports a
 * conflict it's anecdotal.
 */
export function generateGuestId(): string {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function guestName(guestId: string): string {
  return `Guest_${guestId}`;
}

/**
 * Read/init the guest id from sessionStorage. Stable per browser tab; cleared
 * on tab close. Defensive — wrapped in try/catch in case sessionStorage is
 * unavailable (private browsing edge case).
 */
export function getOrCreateGuestId(): string {
  try {
    const existing = sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const fresh = generateGuestId();
    sessionStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Fall back to a non-persistent id — better than throwing
    return generateGuestId();
  }
}
