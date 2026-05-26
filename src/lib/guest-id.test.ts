/**
 * guest-id.test.ts — unit tests for generateGuestId, guestName, getOrCreateGuestId
 *
 * getOrCreateGuestId() uses sessionStorage, which is not available in the
 * Vitest node environment. The function wraps sessionStorage access in a
 * try/catch, so:
 *   - Tests that need the sessionStorage path: stub globalThis.sessionStorage
 *     with a Map-backed fake in beforeEach, remove it in afterEach.
 *   - Tests that need the fallback path: delete globalThis.sessionStorage
 *     (simulating private-browsing ReferenceError).
 *
 * No other mocks needed — all three exports are pure / side-effects only
 * on sessionStorage.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateGuestId, guestName, getOrCreateGuestId } from "./guest-id";

// ---------------------------------------------------------------------------
// sessionStorage stub helpers
// ---------------------------------------------------------------------------

function installFakeSessionStorage(): Map<string, string> {
  const store = new Map<string, string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
  return store;
}

function removeFakeSessionStorage() {
  // @ts-expect-error — intentionally removing polyfill from globalThis
  delete globalThis.sessionStorage;
}

// ---------------------------------------------------------------------------
// generateGuestId
// ---------------------------------------------------------------------------

describe("generateGuestId", () => {
  it("produces a 4-character uppercase alphanumeric string", () => {
    const id = generateGuestId();
    expect(id).toMatch(/^[A-Z0-9]{4}$/);
  });

  it("produces different values across repeated calls (probabilistically unique)", () => {
    const ids = new Set(Array.from({ length: 10 }, () => generateGuestId()));
    // 36^4 ≈ 1.68M combinations — 10 calls should yield ≥ 8 distinct values
    // with overwhelming probability.
    expect(ids.size).toBeGreaterThanOrEqual(8);
  });
});

// ---------------------------------------------------------------------------
// guestName
// ---------------------------------------------------------------------------

describe("guestName", () => {
  it("returns Guest_<id> for the given id", () => {
    expect(guestName("K3F9")).toBe("Guest_K3F9");
  });

  it("preserves the exact id casing in the returned name", () => {
    expect(guestName("A0B1")).toBe("Guest_A0B1");
  });
});

// ---------------------------------------------------------------------------
// getOrCreateGuestId — sessionStorage path
// ---------------------------------------------------------------------------

describe("getOrCreateGuestId — with sessionStorage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installFakeSessionStorage();
  });

  afterEach(() => {
    removeFakeSessionStorage();
  });

  it("returns an existing id that was already in sessionStorage", () => {
    store.set("forge_guest_id", "AAAA");
    const id = getOrCreateGuestId();
    expect(id).toBe("AAAA");
  });

  it("generates a new id and writes it to sessionStorage when absent", () => {
    // store is empty — no pre-seeded id
    const id = getOrCreateGuestId();
    expect(id).toMatch(/^[A-Z0-9]{4}$/);
    // The generated id must have been persisted
    expect(store.get("forge_guest_id")).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// getOrCreateGuestId — fallback path (no sessionStorage)
// ---------------------------------------------------------------------------

describe("getOrCreateGuestId — fallback when sessionStorage is unavailable", () => {
  beforeEach(() => {
    // Ensure no sessionStorage polyfill is present (simulates private browsing
    // where sessionStorage access throws a ReferenceError / SecurityError).
    removeFakeSessionStorage();
  });

  it("still returns a valid 4-char id even without sessionStorage", () => {
    const id = getOrCreateGuestId();
    expect(id).toMatch(/^[A-Z0-9]{4}$/);
  });
});
