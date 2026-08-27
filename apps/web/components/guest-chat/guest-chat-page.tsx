"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ThumbsDown, ThumbsUp, User } from "lucide-react";

/**
 * The guest-facing chat surface. Mobile-first (guests scan a QR in a room
 * or on a table), warm cream + serif look — deliberately distinct from the
 * staff app — with the bot's brand color as accent.
 *
 * Transport: hand-rolled fetch against /api/guest/chatbots/<slug>/* —
 *   bootstrap → POST session (token in localStorage; cookies are unreliable
 *   in QR-launched in-app browsers and future iframe embeds)
 *   send      → POST messages; text/plain = token stream into the last
 *               bubble, JSON = a state outcome (with staff / capped / paused)
 *   sync      → GET messages?after= after each turn, and on a 4s poll while
 *               a human owns the conversation (no Realtime for anon guests)
 */
import { ChatMarkdown } from "@/components/chatbots/chat-markdown";
import { ChatCards } from "@/components/chatbots/chat-cards";
import { StreamingText } from "@/components/guest-chat/streaming-text";

type GuestMeta = {
  displayName: string;
  avatarEmoji: string;
  brandColor: string | null;
  greeting: string;
  suggestedQuestions: string[];
  propertyName: string;
};

type Message = {
  id: string;
  role: "guest" | "bot" | "staff" | "system";
  content: string;
  created_at: string;
  feedback?: number | null;
  /** Structured render cards (services, slots, confirmations) — server-set. */
  attachments?: unknown;
  /** Client-only: a bot bubble still receiving stream chunks. */
  streaming?: boolean;
};

const ACCENT_FALLBACK = "#c96442";
const INK = "#1f1e1b";
const INK_SOFT = "#6f6a60";
const CANVAS = "#faf7f1";

function localId() {
  return `local-${Math.random().toString(36).slice(2)}`;
}

export function GuestChatPage({
  slug,
  room,
  paused,
  meta,
  embed = false,
}: {
  slug: string;
  room: string | null;
  paused: boolean;
  meta: GuestMeta;
  /** Rendered inside the embed widget's iframe — fill the frame, no outer
   *  framing. Standalone (false) frames the chat as a centered card on
   *  desktop so the public URL reads as a real destination. */
  embed?: boolean;
}) {
  const accent = meta.brandColor || ACCENT_FALLBACK;
  const storageKey = `hc-guest-${slug}`;

  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"bot" | "human" | "closed">("bot");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Paused bots never bootstrap a session — the page is ready immediately.
  const [ready, setReady] = useState(paused);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastSyncRef = useRef<string | null>(null);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    });
  }, []);

  // ---- bootstrap -----------------------------------------------------
  useEffect(() => {
    if (paused) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = localStorage.getItem(storageKey);
        const res = await fetch(`/api/guest/chatbots/${slug}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: stored, room }),
        });
        if (!res.ok) throw new Error(`session ${res.status}`);
        const data = (await res.json()) as {
          paused?: boolean;
          token?: string;
          conversationStatus?: "bot" | "human" | "closed";
          messages?: Message[];
        };
        if (cancelled) return;
        if (data.paused || !data.token) {
          setReady(true);
          return;
        }
        localStorage.setItem(storageKey, data.token);
        setToken(data.token);
        setStatus(data.conversationStatus ?? "bot");
        setMessages(data.messages ?? []);
        const last = (data.messages ?? []).at(-1);
        lastSyncRef.current = last?.created_at ?? null;
        setReady(true);
        scrollToBottom();
      } catch {
        if (!cancelled) {
          setNotice("Couldn't connect — pull to refresh or try again shortly.");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, room, paused, storageKey, scrollToBottom]);

  // ---- sync ------------------------------------------------------------
  // After a turn: FULL resync — replaces optimistic/streamed bubbles with
  // server truth (real ids, which the thumbs need). While escalated: cheap
  // incremental poll appends staff/system rows.
  const sync = useCallback(
    async (full = false) => {
      if (!token) return;
      try {
        const after = full ? null : lastSyncRef.current;
        const res = await fetch(
          `/api/guest/chatbots/${slug}/messages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: "bot" | "human" | "closed";
          messages: Message[];
        };
        setStatus(data.status);
        if (data.messages.length > 0) {
          lastSyncRef.current = data.messages.at(-1)!.created_at;
        }
        if (full) {
          setMessages(data.messages);
          scrollToBottom();
        } else if (data.messages.length > 0) {
          setMessages((prev) => {
            const known = new Set(prev.map((m) => m.id));
            const fresh = data.messages.filter(
              (m) => !known.has(m.id) && m.role !== "guest" && m.role !== "bot",
            );
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
          scrollToBottom();
        }
      } catch {
        // polling is best-effort
      }
    },
    [slug, token, scrollToBottom],
  );

  useEffect(() => {
    if (status !== "human") return;
    const interval = setInterval(() => void sync(), 4000);
    return () => clearInterval(interval);
  }, [status, sync]);

  // ---- send ----------------------------------------------------------
  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !token) return;
    setInput("");
    setBusy(true);
    setNotice(null);
    const guestMsg: Message = {
      id: localId(),
      role: "guest",
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, guestMsg]);
    scrollToBottom();

    try {
      const res = await fetch(`/api/guest/chatbots/${slug}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ text: trimmed }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { state?: string; reply?: string };
        if (data.state === "human") {
          setStatus("human");
          if (data.reply) {
            setMessages((m) => [
              ...m,
              { id: localId(), role: "system", content: data.reply!, created_at: new Date().toISOString() },
            ]);
          }
        } else if (data.reply) {
          setMessages((m) => [
            ...m,
            { id: localId(), role: "bot", content: data.reply!, created_at: new Date().toISOString() },
          ]);
        } else if (!res.ok) {
          throw new Error(data.state ?? `HTTP ${res.status}`);
        }
        scrollToBottom();
        return;
      }

      // Token stream → grow the last bot bubble chunk by chunk.
      const botId = localId();
      setMessages((m) => [
        ...m,
        { id: botId, role: "bot", content: "", created_at: new Date().toISOString(), streaming: true },
      ]);
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          setMessages((m) =>
            m.map((msg) =>
              msg.id === botId ? { ...msg, content: msg.content + chunk } : msg,
            ),
          );
          scrollToBottom();
        }
      }
      setMessages((m) =>
        m.map((msg) => (msg.id === botId ? { ...msg, streaming: false } : msg)),
      );
      // Full resync: swaps streamed bubbles for server rows (real ids for
      // feedback) and picks up any status flip / system rows from the turn.
      await sync(true);
    } catch {
      setMessages((m) => m.filter((msg) => msg.id !== guestMsg.id));
      setInput(trimmed);
      setNotice("That didn't go through — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function rate(messageId: string, value: 1 | -1) {
    if (!token) return;
    const current = messages.find((m) => m.id === messageId)?.feedback;
    const next = current === value ? null : value;
    setMessages((m) =>
      m.map((msg) => (msg.id === messageId ? { ...msg, feedback: next } : msg)),
    );
    await fetch(`/api/guest/chatbots/${slug}/messages`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messageId, feedback: next }),
    }).catch(() => null);
  }

  async function requestHuman() {
    if (!token || status === "human") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/guest/chatbots/${slug}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ handoff: true }),
      });
      const data = (await res.json()) as { reply?: string };
      setStatus("human");
      setMessages((m) => [
        ...m,
        {
          id: localId(),
          role: "system",
          content: data.reply ?? "Connecting you with the team…",
          created_at: new Date().toISOString(),
        },
      ]);
      scrollToBottom();
    } catch {
      setNotice("Couldn't reach the team — try again.");
    } finally {
      setBusy(false);
    }
  }

  const showSuggestions =
    ready && !paused && messages.filter((m) => m.role === "guest").length === 0;

  // After a completed bot reply, resurface up to 3 unused suggested
  // questions as quieter follow-up chips. Only while the conversation is
  // idle and still with the bot — never mid-stream or while escalated.
  const lastMessage = messages.at(-1);
  const askedQuestions = new Set(
    messages
      .filter((m) => m.role === "guest")
      .map((m) => m.content.trim().toLowerCase()),
  );
  const followUps =
    ready &&
    !paused &&
    !busy &&
    token &&
    status === "bot" &&
    askedQuestions.size > 0 &&
    lastMessage?.role === "bot" &&
    !lastMessage.streaming
      ? meta.suggestedQuestions
          .filter((q) => !askedQuestions.has(q.trim().toLowerCase()))
          .slice(0, 3)
      : [];

  // Embed + mobile: fill the viewport/iframe edge-to-edge. Standalone on
  // desktop: a soft branded backdrop with the chat centered in a capped,
  // rounded card so the public link reads as a destination, not a bare frame.
  const panel = (
    <div
      className={
        embed
          ? "flex h-dvh flex-col"
          : "flex h-dvh flex-col overflow-hidden sm:h-[min(760px,92dvh)] sm:w-full sm:max-w-lg sm:rounded-2xl sm:border sm:shadow-xl"
      }
      style={{
        backgroundColor: CANVAS,
        color: INK,
        ...(embed ? {} : { borderColor: "rgba(31,30,27,0.10)" }),
      }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: "rgba(31,30,27,0.08)" }}
      >
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-xl"
          style={{ backgroundColor: `${accent}1a` }}
          aria-hidden="true"
        >
          {meta.avatarEmoji}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-lg font-medium">
            {meta.displayName}
          </h1>
          <p className="truncate text-xs" style={{ color: INK_SOFT }}>
            {meta.propertyName}
            {status === "human" ? " · with the team" : ""}
          </p>
        </div>
        {!paused && status !== "human" ? (
          <button
            type="button"
            onClick={() => void requestHuman()}
            disabled={busy || !token}
            className="shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f1e1b]/40 disabled:opacity-40"
            style={{ borderColor: `${accent}66`, color: accent }}
          >
            Talk to a human
          </button>
        ) : null}
      </header>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-xl flex-col gap-2.5">
          {paused ? (
            <CenterNote>
              This assistant is taking a break — please contact the{" "}
              {meta.propertyName} team directly.
            </CenterNote>
          ) : (
            <>
              <Bubble role="bot" emoji={meta.avatarEmoji} accent={accent}>
                {meta.greeting}
              </Bubble>

              {messages.map((m) =>
                m.role === "system" ? (
                  <CenterNote key={m.id}>{m.content}</CenterNote>
                ) : (
                  <Bubble
                    key={m.id}
                    role={m.role}
                    emoji={meta.avatarEmoji}
                    accent={accent}
                    staffLabel={`${meta.propertyName} team`}
                    attachments={m.role === "bot" ? m.attachments : undefined}
                    streaming={m.role === "bot" && m.streaming}
                    onSend={busy || !token ? undefined : (t) => void send(t)}
                    footer={
                      m.role === "bot" && !m.streaming && !m.id.startsWith("local-") ? (
                        <FeedbackRow
                          feedback={m.feedback ?? null}
                          accent={accent}
                          onRate={(v) => void rate(m.id, v)}
                        />
                      ) : undefined
                    }
                  >
                    {m.content}
                  </Bubble>
                ),
              )}

              {showSuggestions && meta.suggestedQuestions.length > 0 ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  {meta.suggestedQuestions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      disabled={busy || !token}
                      className="rounded-full border bg-white/70 px-3.5 py-2 text-left text-sm transition-colors disabled:opacity-40"
                      style={{ borderColor: "rgba(31,30,27,0.12)", color: INK }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ) : null}

              {followUps.length > 0 ? (
                // Keyed to the reply that produced it so the row blur-fades
                // in fresh after each turn instead of persisting silently.
                <div
                  key={lastMessage?.id}
                  className="ai-blur-in flex flex-wrap gap-1.5 pt-1 pl-8"
                >
                  {followUps.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void send(q)}
                      disabled={busy || !token}
                      className="rounded-full border bg-white/60 px-3 py-1.5 text-left text-[13px] transition-colors disabled:opacity-40"
                      style={{ borderColor: "rgba(31,30,27,0.10)", color: INK_SOFT }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              ) : null}

              {busy && !messages.some((m) => m.streaming) ? (
                <TypingDots accent={accent} emoji={meta.avatarEmoji} />
              ) : null}
            </>
          )}

          {notice ? <CenterNote>{notice}</CenterNote> : null}
        </div>
      </div>

      {/* Composer */}
      {!paused ? (
        <div
          className="border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          style={{ borderColor: "rgba(31,30,27,0.08)" }}
        >
          <form
            className="mx-auto flex max-w-xl items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder={
                status === "human" ? "Message the team…" : "Type a message…"
              }
              rows={1}
              disabled={!ready || !token}
              // 16px font — anything smaller makes iOS zoom the page on focus.
              className="max-h-32 flex-1 resize-none rounded-2xl border bg-white px-4 py-2.5 text-base leading-snug outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f1e1b]/25"
              style={{ borderColor: "rgba(31,30,27,0.15)", color: INK }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || !token}
              aria-label="Send"
              className="flex size-11 shrink-0 items-center justify-center rounded-full text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f1e1b]/40 disabled:opacity-40"
              style={{ backgroundColor: accent }}
            >
              <ArrowRight className="size-5" />
            </button>
          </form>
          <p
            className="mx-auto mt-1.5 max-w-xl text-center text-xs"
            style={{ color: INK_SOFT }}
          >
            AI assistant — it can make mistakes. Tap &ldquo;Talk to a
            human&rdquo; anytime.
          </p>
        </div>
      ) : null}
    </div>
  );

  if (embed) return panel;

  // Standalone destination: center the panel over a branded backdrop. The
  // radial wash uses the bot's accent so the page feels owned, not generic.
  return (
    <div
      className="grid h-dvh place-items-center sm:p-6"
      style={{
        backgroundColor: CANVAS,
        backgroundImage: `radial-gradient(120% 90% at 50% 0%, ${accent}1f 0%, transparent 55%)`,
      }}
    >
      {panel}
    </div>
  );
}

function Bubble({
  role,
  emoji,
  accent,
  staffLabel,
  footer,
  attachments,
  streaming = false,
  onSend,
  children,
}: {
  role: "guest" | "bot" | "staff";
  emoji: string;
  accent: string;
  staffLabel?: string;
  footer?: React.ReactNode;
  /** Bot-only: structured cards rendered beneath the bubble. */
  attachments?: unknown;
  /** Bot-only: still receiving stream chunks — words blur in as they
   *  arrive; markdown waits until the reply settles. */
  streaming?: boolean;
  /** Bot-only: drives a Book affordance back into the chat. */
  onSend?: (text: string) => void;
  children: React.ReactNode;
}) {
  if (role === "guest") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap text-white"
          style={{ backgroundColor: accent }}
        >
          {children}
        </div>
      </div>
    );
  }
  // Bot replies render light markdown (lists, bold); staff text stays plain.
  const isBot = role === "bot";
  return (
    <div className="flex items-end gap-2">
      <span className="mb-1 shrink-0 text-lg" aria-hidden="true">
        {role === "staff" ? <User className="size-5" style={{ color: INK_SOFT }} /> : emoji}
      </span>
      <div className="max-w-[85%]">
        {role === "staff" && staffLabel ? (
          <p className="mb-0.5 ml-1 text-xs" style={{ color: INK_SOFT }}>
            {staffLabel}
          </p>
        ) : null}
        <div
          className={`rounded-2xl rounded-bl-md border bg-white px-4 py-2.5 text-base leading-relaxed ${isBot ? "" : "whitespace-pre-wrap"}`}
          style={{ borderColor: "rgba(31,30,27,0.1)", color: INK }}
        >
          {isBot && streaming ? (
            typeof children === "string" && children ? (
              <StreamingText text={children} />
            ) : (
              // Waiting on the first byte — dots inside the bubble instead
              // of a literal "…" string.
              <Dots accent={accent} className="py-1.5" />
            )
          ) : isBot && typeof children === "string" && children ? (
            <ChatMarkdown>{children}</ChatMarkdown>
          ) : (
            children
          )}
        </div>
        {isBot ? (
          <ChatCards attachments={attachments} accent={accent} onSend={onSend} />
        ) : null}
        {footer}
      </div>
    </div>
  );
}

function FeedbackRow({
  feedback,
  accent,
  onRate,
}: {
  feedback: number | null;
  accent: string;
  onRate: (value: 1 | -1) => void;
}) {
  return (
    <div className="mt-1 ml-1 flex gap-1">
      {([1, -1] as const).map((value) => {
        const active = feedback === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={value === 1 ? "Helpful" : "Not helpful"}
            aria-pressed={active}
            onClick={() => onRate(value)}
            className="rounded-full border px-1.5 py-0.5 text-xs transition-opacity"
            style={{
              borderColor: active ? accent : "rgba(31,30,27,0.12)",
              backgroundColor: active ? `${accent}1a` : "transparent",
              opacity: feedback === null || active ? 1 : 0.45,
            }}
          >
            {value === 1 ? <ThumbsUp className="size-3.5" /> : <ThumbsDown className="size-3.5" />}
          </button>
        );
      })}
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mx-auto max-w-[40ch] py-1 text-center text-xs text-pretty"
      style={{ color: INK_SOFT }}
    >
      {children}
    </p>
  );
}

function Dots({ accent, className }: { accent: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full"
          style={{ backgroundColor: accent, animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

function TypingDots({ accent, emoji }: { accent: string; emoji: string }) {
  return (
    <div className="flex items-end gap-2">
      <span className="mb-1 text-lg" aria-hidden="true">
        {emoji}
      </span>
      <div
        className="flex items-center rounded-2xl rounded-bl-md border bg-white px-4 py-3"
        style={{ borderColor: "rgba(31,30,27,0.1)" }}
      >
        <Dots accent={accent} />
      </div>
    </div>
  );
}
