/**
 * Unit tests for ChatPanel pure helpers.
 *
 * ChatPanel is a "use client" component that depends on Liveblocks hooks and
 * browser APIs (pointer-lock, performance.now, crypto). Rather than mounting
 * the full component (vitest env is "node", no DOM), we test the two pure
 * helper functions that contain the business logic:
 *
 *   submitChat — handles submit validation: empty, rate-limit, truncation,
 *                broadcast call, and local message construction.
 *   appendIncoming — pure function that appends an incoming message and
 *                    enforces the MAX_MESSAGES cap.
 *
 * This follows the same "extract logic, test it" technique used in:
 *   CollaboratorsSection.test.ts, MobileJoysticks.test.ts, EnterWorldOverlay.test.ts
 *
 * No mocks of @liveblocks/react or React itself are needed because neither
 * helper imports them — they operate on plain data.
 */

import { describe, it, expect, vi } from "vitest";
import {
  submitChat,
  appendIncoming,
  MAX_MESSAGES,
  MAX_CHARS,
  RATE_LIMIT_MS,
  type ChatMessage,
} from "./ChatPanel";

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const SELF_INFO = { name: "@alice", color: "hsl(214, 70%, 55%)" };

function makeBroadcast() {
  return vi.fn<[{ type: "chat"; text: string }], void>();
}

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `msg-${i}`,
    fromName: `@user${i}`,
    fromColor: "hsl(0, 70%, 55%)",
    text: `Hello ${i}`,
    timestamp: i * 100,
    isSelf: false,
  }));
}

// ---------------------------------------------------------------------------
// submitChat
// ---------------------------------------------------------------------------

describe("submitChat — happy path", () => {
  it("returns ok with a message + calls broadcast once", () => {
    const broadcast = makeBroadcast();

    const result = submitChat({
      inputValue: "hello world",
      lastSentAt: 0,
      now: RATE_LIMIT_MS + 1, // well past the rate limit
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return; // narrow for TS

    expect(result.message.text).toBe("hello world");
    expect(result.message.fromName).toBe(SELF_INFO.name);
    expect(result.message.fromColor).toBe(SELF_INFO.color);
    expect(result.message.isSelf).toBe(true);
    expect(typeof result.message.id).toBe("string");

    expect(broadcast).toHaveBeenCalledOnce();
    expect(broadcast).toHaveBeenCalledWith({ type: "chat", text: "hello world" });
  });

  it("trims leading/trailing whitespace before sending", () => {
    const broadcast = makeBroadcast();

    const result = submitChat({
      inputValue: "  hi there  ",
      lastSentAt: 0,
      now: RATE_LIMIT_MS + 1,
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.message.text).toBe("hi there");
    expect(broadcast).toHaveBeenCalledWith({ type: "chat", text: "hi there" });
  });
});

// ---------------------------------------------------------------------------
// submitChat — empty / whitespace
// ---------------------------------------------------------------------------

describe("submitChat — empty/whitespace input", () => {
  it("returns empty for an empty string", () => {
    const broadcast = makeBroadcast();

    const result = submitChat({
      inputValue: "",
      lastSentAt: 0,
      now: RATE_LIMIT_MS + 1,
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("empty");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("returns empty for a whitespace-only string", () => {
    const broadcast = makeBroadcast();

    const result = submitChat({
      inputValue: "   ",
      lastSentAt: 0,
      now: RATE_LIMIT_MS + 1,
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("empty");
    expect(broadcast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// submitChat — rate limit
// ---------------------------------------------------------------------------

describe("submitChat — rate limit", () => {
  it("returns rate-limited when interval is too short, does not broadcast", () => {
    const broadcast = makeBroadcast();

    // First send at t=100
    const first = submitChat({
      inputValue: "first message",
      lastSentAt: 100,
      now: 100 + RATE_LIMIT_MS - 1, // one ms before the window expires
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(first.kind).toBe("rate-limited");
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("allows a send when exactly RATE_LIMIT_MS has elapsed", () => {
    const broadcast = makeBroadcast();

    const result = submitChat({
      inputValue: "second message",
      lastSentAt: 100,
      now: 100 + RATE_LIMIT_MS, // exactly at the boundary
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    // The check is `now - lastSentAt < RATE_LIMIT_MS`, so equal is allowed.
    expect(result.kind).toBe("ok");
    expect(broadcast).toHaveBeenCalledOnce();
  });

  it("allows rapid sends from a cold start (lastSentAt === 0)", () => {
    const broadcast = makeBroadcast();

    // now=0, lastSentAt=0 → now - lastSentAt = 0, which is NOT < RATE_LIMIT_MS
    // So the very first send (0 - 0 = 0 < 1500 is FALSE) is allowed.
    const result = submitChat({
      inputValue: "first ever message",
      lastSentAt: 0,
      now: 0,
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("ok");
    expect(broadcast).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// submitChat — length cap
// ---------------------------------------------------------------------------

describe("submitChat — length cap", () => {
  it("truncates input longer than MAX_CHARS before broadcasting", () => {
    const broadcast = makeBroadcast();
    const longText = "A".repeat(MAX_CHARS + 20);

    const result = submitChat({
      inputValue: longText,
      lastSentAt: 0,
      now: RATE_LIMIT_MS + 1,
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.message.text.length).toBe(MAX_CHARS);
    expect(broadcast).toHaveBeenCalledWith({
      type: "chat",
      text: "A".repeat(MAX_CHARS),
    });
  });

  it("sends a message that is exactly MAX_CHARS without truncation", () => {
    const broadcast = makeBroadcast();
    const exactText = "B".repeat(MAX_CHARS);

    const result = submitChat({
      inputValue: exactText,
      lastSentAt: 0,
      now: RATE_LIMIT_MS + 1,
      broadcastImpl: broadcast,
      selfInfo: SELF_INFO,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.message.text.length).toBe(MAX_CHARS);
  });
});

// ---------------------------------------------------------------------------
// appendIncoming
// ---------------------------------------------------------------------------

describe("appendIncoming — happy path", () => {
  it("appends an incoming message with isSelf: false", () => {
    const messages: ChatMessage[] = [];
    const userInfo = {
      name: "@bob",
      color: "hsl(120, 70%, 55%)",
      avatarUrl: null,
      isGuest: false,
    };

    const result = appendIncoming({
      event: { type: "chat", text: "hey there!" },
      userInfo,
      messages,
    });

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hey there!");
    expect(result[0].fromName).toBe("@bob");
    expect(result[0].fromColor).toBe("hsl(120, 70%, 55%)");
    expect(result[0].isSelf).toBe(false);
    expect(typeof result[0].id).toBe("string");
  });

  it("does not mutate the original messages array", () => {
    const original: ChatMessage[] = makeMessages(3);
    const snapshot = [...original];

    appendIncoming({
      event: { type: "chat", text: "new message" },
      userInfo: {
        name: "@carol",
        color: "hsl(60, 70%, 55%)",
        avatarUrl: null,
        isGuest: false,
      },
      messages: original,
    });

    expect(original).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// appendIncoming — MAX_MESSAGES overflow
// ---------------------------------------------------------------------------

describe("appendIncoming — message overflow drops oldest", () => {
  it("keeps exactly MAX_MESSAGES messages when overflow occurs", () => {
    const messages = makeMessages(MAX_MESSAGES); // already at cap
    const userInfo = {
      name: "@dave",
      color: "hsl(200, 70%, 55%)",
      avatarUrl: null,
      isGuest: false,
    };

    const result = appendIncoming({
      event: { type: "chat", text: "overflow message" },
      userInfo,
      messages,
    });

    expect(result).toHaveLength(MAX_MESSAGES);
    // The newest message should be at the end.
    expect(result[result.length - 1].text).toBe("overflow message");
    // The oldest message (index 0 from the original) should be gone.
    expect(result.find((m) => m.id === "msg-0")).toBeUndefined();
  });

  it("drops multiple oldest entries when multiple overflow at once", () => {
    // Create MAX_MESSAGES messages, then try to add two more in sequence.
    const messages = makeMessages(MAX_MESSAGES - 1); // one below cap

    const info = {
      name: "@eve",
      color: "hsl(30, 70%, 55%)",
      avatarUrl: null,
      isGuest: false,
    };

    const afterFirst = appendIncoming({
      event: { type: "chat", text: "message A" },
      userInfo: info,
      messages,
    });
    expect(afterFirst).toHaveLength(MAX_MESSAGES); // exactly at cap now

    const afterSecond = appendIncoming({
      event: { type: "chat", text: "message B" },
      userInfo: info,
      messages: afterFirst,
    });
    expect(afterSecond).toHaveLength(MAX_MESSAGES); // still capped
    expect(afterSecond[afterSecond.length - 1].text).toBe("message B");
  });
});
