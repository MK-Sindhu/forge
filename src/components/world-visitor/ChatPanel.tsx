"use client";

/**
 * ChatPanel — ephemeral in-world chat overlay for walk mode.
 *
 * Layout: fixed bottom-right corner, semi-transparent dark background.
 * Messages are broadcast via Liveblocks useBroadcastEvent / useEventListener
 * and are ephemeral (not persisted to any DB — page refresh clears history).
 *
 * Self-broadcast note:
 *   Liveblocks useEventListener does NOT fire for the broadcaster's own events.
 *   We therefore append our own message to local state immediately after calling
 *   broadcast() — before any network round-trip — so the sender sees it instantly.
 *
 * Suspended-user behavior:
 *   The Liveblocks auth route returns 403 for suspended users, so their
 *   connection silently fails. broadcast() becomes a no-op and useEventListener
 *   never fires. The panel renders normally (shows "no messages yet" placeholder)
 *   and the rate-limit guard keeps it quiet. No special handling needed here.
 *
 * Keyboard shortcuts (defined here, NOT in WalkMode):
 *   T  — focus the chat input (when not already in a text field)
 *   ESC — blur the chat input (when focused) → returns control to walk mode
 *
 * The existing WalkMode keyboard handler already gates WASD on
 *   `target.tagName === "INPUT"`, so typing in the chat input will not
 *   trigger walk movement. That gate is in WalkMode.tsx's onKeyDown listener.
 *
 * z-index: 40 — above canvas (default 0) and below modal overlays (60+).
 * ControlsHint uses 60; MobileJoysticks uses 50. Chat at 40 stays below them.
 *
 * pointer-events: the panel uses pointer-events:auto so clicks/drags reach
 * the input. The canvas underneath gets pointer events in all areas OUTSIDE
 * the panel (CSS default: everything outside this element remains interactive).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useBroadcastEvent, useEventListener, useSelf } from "@liveblocks/react";
import type { VisitorUserInfo, RoomEvent } from "@/lib/liveblocks/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_MESSAGES = 30;
export const MAX_CHARS = 280;
export const RATE_LIMIT_MS = 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  /** Local identifier — crypto.randomUUID() or fallback. */
  id: string;
  fromName: string;
  fromColor: string;
  text: string;
  /** performance.now() at the time the message was added. Used for ordering. */
  timestamp: number;
  isSelf: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — extracted for testability (no React, no Liveblocks)
// ---------------------------------------------------------------------------

/**
 * Input descriptor for submitChat.
 * @param broadcastImpl  — the Liveblocks broadcast function (or a mock).
 * @param selfInfo       — the current user's VisitorUserInfo.
 * @param lastSentAt     — performance.now() of the last successful send.
 * @param now            — performance.now() snapshot for this attempt.
 */
export interface SubmitChatInput {
  inputValue: string;
  lastSentAt: number;
  now: number;
  broadcastImpl: (event: { type: "chat"; text: string }) => void;
  selfInfo: { name: string; color: string };
}

export type SubmitChatResult =
  | { kind: "ok"; message: ChatMessage }
  | { kind: "rate-limited" }
  | { kind: "empty" };

/**
 * submitChat — pure submit handler.
 *
 * Handles: empty/whitespace rejection, rate-limit, MAX_CHARS truncation,
 * broadcast call, and constructing the local ChatMessage for the sender.
 *
 * Does NOT mutate any state — returns a result and lets the caller decide
 * what to do with it.
 */
export function submitChat(input: SubmitChatInput): SubmitChatResult {
  const { inputValue, lastSentAt, now, broadcastImpl, selfInfo } = input;

  const trimmed = inputValue.trim();
  if (!trimmed) {
    return { kind: "empty" };
  }

  // lastSentAt === 0 means "never sent before" — always allow the first send.
  if (lastSentAt !== 0 && now - lastSentAt < RATE_LIMIT_MS) {
    return { kind: "rate-limited" };
  }

  // Truncate to MAX_CHARS (silent truncation; UI enforces maxLength so this
  // is a belt-and-suspenders guard).
  const text = trimmed.slice(0, MAX_CHARS);

  broadcastImpl({ type: "chat", text });

  const message: ChatMessage = {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : String(now),
    fromName: selfInfo.name,
    fromColor: selfInfo.color,
    text,
    timestamp: now,
    isSelf: true,
  };

  return { kind: "ok", message };
}

/**
 * appendIncoming — pure helper that appends an incoming event to the
 * messages array, enforcing the MAX_MESSAGES cap by dropping the oldest.
 *
 * Does not mutate `messages` — returns a new array.
 */
export function appendIncoming({
  event,
  userInfo,
  messages,
}: {
  event: { type: "chat"; text: string };
  userInfo: VisitorUserInfo;
  messages: ChatMessage[];
}): ChatMessage[] {
  const incoming: ChatMessage = {
    id: typeof crypto !== "undefined" ? crypto.randomUUID() : String(performance.now()),
    fromName: userInfo.name,
    fromColor: userInfo.color,
    text: event.text,
    timestamp: performance.now(),
    isSelf: false,
  };

  const next = [...messages, incoming];
  // Cap at MAX_MESSAGES by dropping oldest entries (beginning of array).
  if (next.length > MAX_MESSAGES) {
    return next.slice(next.length - MAX_MESSAGES);
  }
  return next;
}

// ---------------------------------------------------------------------------
// ChatPanel component
// ---------------------------------------------------------------------------

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [rateLimitError, setRateLimitError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef<number>(0);
  const rateLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Liveblocks hooks
  const broadcast = useBroadcastEvent();
  const self = useSelf();

  // ---------------------------------------------------------------------------
  // Receive incoming messages from other users.
  // Liveblocks does NOT fire this for our own broadcasts — self-send is
  // handled by appending locally after broadcast() (see handleSubmit).
  // ---------------------------------------------------------------------------
  useEventListener(({ event, user }) => {
    // Cast to our typed RoomEvent — the global Liveblocks augmentation
    // registers RoomEvent but the TypeScript generic resolves to Json at
    // this call site. The cast is safe because the augmentation guarantees
    // the shape at runtime.
    const typedEvent = event as RoomEvent | null | undefined;
    if (!typedEvent || typedEvent.type !== "chat") return;
    // user.info is VisitorUserInfo per the global augmentation. The `user`
    // value may be null when the event is server-broadcast (connectionId=-1).
    const userInfo = user?.info as VisitorUserInfo | undefined;
    if (!userInfo) return;

    setMessages((prev) =>
      appendIncoming({ event: typedEvent, userInfo, messages: prev })
    );
  });

  // ---------------------------------------------------------------------------
  // Auto-scroll to bottom on new messages. useLayoutEffect so scroll happens
  // before the browser paints (prevents a visible flash of the old scroll pos).
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Submit handler
  // ---------------------------------------------------------------------------
  const handleSubmit = useCallback(() => {
    const rawInfo = self?.info as VisitorUserInfo | undefined;
    const selfInfo = rawInfo
      ? { name: rawInfo.name, color: rawInfo.color }
      : { name: "You", color: "hsl(0, 0%, 60%)" };

    const result = submitChat({
      inputValue,
      lastSentAt: lastSentRef.current,
      now: performance.now(),
      broadcastImpl: broadcast,
      selfInfo,
    });

    if (result.kind === "rate-limited") {
      // Show a brief inline error, then clear it.
      setRateLimitError(true);
      if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
      rateLimitTimerRef.current = setTimeout(() => {
        setRateLimitError(false);
      }, 1500);
      return;
    }

    if (result.kind === "empty") {
      return;
    }

    // result.kind === "ok"
    lastSentRef.current = result.message.timestamp;
    setMessages((prev) => {
      const next = [...prev, result.message];
      if (next.length > MAX_MESSAGES) {
        return next.slice(next.length - MAX_MESSAGES);
      }
      return next;
    });
    setInputValue("");
  }, [inputValue, broadcast, self]);

  // ---------------------------------------------------------------------------
  // T key: focus the chat input (when not already in an input).
  // ESC key: blur the chat input (when focused, returns walk control).
  // Both listeners live HERE (not in WalkMode) to avoid editor/visitor conflict.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inTextInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.key === "t" || e.key === "T") && !inTextInput) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (e.key === "Escape" && inputFocused) {
        e.preventDefault();
        inputRef.current?.blur();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputFocused]);

  // ---------------------------------------------------------------------------
  // Cleanup rate-limit timer on unmount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (rateLimitTimerRef.current) clearTimeout(rateLimitTimerRef.current);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className={[
        "fixed bottom-4 right-4 z-40 flex flex-col rounded-lg",
        "bg-black/60 backdrop-blur-sm",
        "pointer-events-auto",
        "transition-opacity duration-200",
        inputFocused ? "opacity-100" : "opacity-80 hover:opacity-100",
      ].join(" ")}
      style={{ width: 320, height: 240 }}
      aria-label="World chat"
      role="region"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10">
        <span className="text-xs font-semibold text-white/80">Chat</span>
        <span
          className="text-xs text-white/40"
          aria-label={`${messages.length} of ${MAX_MESSAGES} messages`}
        >
          {messages.length}/{MAX_MESSAGES}
        </span>
      </div>

      {/* Messages list */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scroll-smooth"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 ? (
          <p className="text-xs text-white/30 italic text-center mt-4">
            No messages yet
          </p>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={[
                "text-xs leading-relaxed break-words",
                msg.isSelf ? "italic text-white/60" : "text-white/90",
              ].join(" ")}
            >
              <span
                className="font-semibold mr-1"
                style={{ color: msg.fromColor }}
                aria-hidden="true"
              >
                {msg.fromName}:
              </span>
              <span>{msg.text}</span>
            </div>
          ))
        )}
      </div>

      {/* Rate-limit error */}
      {rateLimitError && (
        <p
          className="px-3 text-xs text-amber-400"
          role="alert"
          aria-live="assertive"
        >
          Slow down
        </p>
      )}

      {/* Input row */}
      <div className="flex items-center gap-1 border-t border-white/10 px-2 py-1.5">
        <label htmlFor="chat-input" className="sr-only">
          Chat message
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder="Press T to chat"
          maxLength={MAX_CHARS}
          className={[
            "flex-1 bg-transparent text-xs text-white placeholder-white/30",
            "outline-none border border-white/20 rounded px-2 py-1",
            "focus:border-white/50 focus:ring-1 focus:ring-white/20",
          ].join(" ")}
          aria-label="Type a message and press Enter to send"
          aria-describedby={rateLimitError ? "chat-rate-limit-msg" : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          onClick={handleSubmit}
          aria-label="Send chat message"
          className={[
            "shrink-0 rounded px-2 py-1 text-xs font-medium",
            "bg-white/10 text-white/70 hover:bg-white/20 hover:text-white",
            "focus:outline-none focus:ring-2 focus:ring-white/40",
            "transition",
          ].join(" ")}
        >
          Send
        </button>
      </div>
    </div>
  );
}
