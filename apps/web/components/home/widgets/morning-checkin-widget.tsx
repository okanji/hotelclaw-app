"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Check, Loader2, Mic, MicOff, Sunrise } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { createClient } from "@/lib/supabase/client";
import type { WidgetProps } from "../dashboard-registry";

/**
 * Morning check-in (C1 phase 1) — the daily ritual widget. Three quick
 * questions (typed or dictated), AI tidies the answers into a brief, the
 * author reviews/edits and shares it to a channel under their own name.
 * Replaces hand-writing the daily entry in the management-briefing channel.
 *
 * Voice input is progressive enhancement over the browser's
 * SpeechRecognition (Chrome/Safari); no backend audio path yet.
 */

type Step = 0 | 1 | 2 | 3; // three questions, then review

const QUESTIONS: { key: "priorities" | "blockers" | "notes"; prompt: string; hint: string }[] = [
  {
    key: "priorities",
    prompt: "What are your top priorities today?",
    hint: "A few bullets or a rambling sentence — both fine.",
  },
  {
    key: "blockers",
    prompt: "Anything blocked, or where you need help?",
    hint: "Leave empty if nothing.",
  },
  {
    key: "notes",
    prompt: "Anything else the team should know?",
    hint: "Visits, deliveries, reminders…",
  },
];

function channelsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["chat-channels-lite", propertyId] as const,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("chat_channels")
        .select("id, name")
        .eq("property_id", propertyId)
        .is("archived_at", null)
        .order("name");
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

/** Pending bot approvals (fleet) — surfaced in the morning ritual so "please
 *  do your approvals" is part of starting the day. 0 rows (or a non-pod
 *  property, where the table simply has none) renders nothing. */
function pendingApprovalsQueryOptions(propertyId: string) {
  return queryOptions({
    queryKey: ["pending-approvals-count", propertyId] as const,
    queryFn: async (): Promise<number> => {
      const supabase = createClient();
      const { count } = await supabase
        .from("bot_chat_sessions")
        .select("id", { count: "exact", head: true })
        .eq("property_id", propertyId)
        .eq("status", "awaiting_approval");
      return count ?? 0;
    },
    staleTime: 60_000,
  });
}

const LAST_CHANNEL_KEY = "morning-checkin:channel";
const DONE_KEY_PREFIX = "morning-checkin:done:";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function MorningCheckinWidget({ propertyId }: WidgetProps) {
  const [step, setStep] = useState<Step | "idle" | "done">("idle");
  const [answers, setAnswers] = useState({ priorities: "", blockers: "", notes: "" });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [channelId, setChannelId] = useState<string>("");
  const { data: channels = [] } = useQuery(channelsQueryOptions(propertyId));
  const { data: approvalsCount = 0 } = useQuery(
    pendingApprovalsQueryOptions(propertyId),
  );

  // Restore the last-used channel + whether today's brief is already shared.
  // Hydration-safe localStorage restore (same pattern as home-view's saved
  // view): client-only values must land via an effect.
  useEffect(() => {
    const saved = window.localStorage.getItem(LAST_CHANNEL_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setChannelId(saved);
    if (window.localStorage.getItem(DONE_KEY_PREFIX + todayKey())) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep("done");
    }
  }, []);
  useEffect(() => {
    if (!channelId && channels.length > 0) {
      const briefing =
        channels.find((c) => /brief|management|leadership/i.test(c.name)) ??
        channels[0];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChannelId(briefing.id);
    }
  }, [channels, channelId]);

  async function makeDraft() {
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "draft", answers }),
      });
      const data = (await res.json()) as { bodyMd?: string; error?: string };
      if (!res.ok || !data.bodyMd) throw new Error(data.error ?? "Draft failed");
      setDraft(data.bodyMd);
      setStep(3);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Draft failed");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!channelId || !draft.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          bodyMd: draft.trim(),
          channelId,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Publish failed");
      window.localStorage.setItem(LAST_CHANNEL_KEY, channelId);
      window.localStorage.setItem(DONE_KEY_PREFIX + todayKey(), "1");
      toast.success("Morning brief shared");
      setStep("done");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  if (step === "idle" || step === "done") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-md bg-card p-4 shadow-ring">
        <div className="flex items-center gap-2.5">
          <Sunrise className="size-5 text-warning" strokeWidth={1.5} />
          <p className="text-sm font-medium text-foreground">
            {step === "done"
              ? "Morning brief shared — see you tomorrow."
              : "Three quick questions, and your morning brief posts itself."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant={step === "done" ? "outline" : "default"}
            onClick={() => {
              setAnswers({ priorities: "", blockers: "", notes: "" });
              setDraft("");
              setStep(0);
            }}
          >
            {step === "done" ? "Run it again" : "Start your check-in"}
            <ArrowRight className="size-4" />
          </Button>
          {approvalsCount > 0 ? (
            <Link
              href={`/p/${propertyId}/agents/fleet/approvals`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-warning underline-offset-2 hover:underline"
            >
              <BadgeCheck className="size-3.5" />
              {approvalsCount} approval{approvalsCount === 1 ? "" : "s"} waiting
              for you
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="flex flex-col gap-3 rounded-md bg-card p-4 shadow-ring">
        <p className="text-sm font-medium text-foreground">
          Here&rsquo;s your brief — edit anything, then share it.
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          disabled={busy}
          className="text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            disabled={busy}
            aria-label="Channel"
            wrapperClassName="w-auto"
          >
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                #{c.name}
              </option>
            ))}
          </NativeSelect>
          <Button type="button" size="sm" onClick={() => void publish()} disabled={busy || !channelId}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Share brief
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setStep(0)}>
            Start over
          </Button>
        </div>
      </div>
    );
  }

  const q = QUESTIONS[step];
  return (
    <QuestionCard
      key={q.key}
      step={step}
      prompt={q.prompt}
      hint={q.hint}
      value={answers[q.key]}
      busy={busy}
      onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
      onNext={() => {
        if (step < 2) setStep((step + 1) as Step);
        else void makeDraft();
      }}
      isLast={step === 2}
    />
  );
}

/* ── One question at a time, with optional dictation ─────────────────────── */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function QuestionCard({
  step,
  prompt,
  hint,
  value,
  busy,
  onChange,
  onNext,
  isLast,
}: {
  step: number;
  prompt: string;
  hint: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const SR = getSpeechRecognition();

  useEffect(() => {
    return () => recRef.current?.stop();
  }, []);

  function toggleMic() {
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) text += r[0].transcript;
      }
      if (text) onChange(value ? `${value} ${text.trim()}` : text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-card p-4 shadow-ring">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{prompt}</p>
        <span className="shrink-0 text-xs tabular-nums text-faint-foreground">
          {step + 1} / 3
        </span>
      </div>
      <div className="relative">
        <Textarea
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onNext();
            }
          }}
          placeholder={hint}
          rows={3}
          disabled={busy}
          className={cn("resize-none text-sm", SR && "pr-10")}
        />
        {SR ? (
          <button
            type="button"
            onClick={toggleMic}
            aria-label={listening ? "Stop dictating" : "Dictate your answer"}
            className={cn(
              "absolute right-2 top-2 rounded-md p-1.5 transition-colors",
              listening
                ? "bg-destructive/10 text-destructive"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
          </button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={onNext} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Drafting…
            </>
          ) : isLast ? (
            "Draft my brief"
          ) : (
            "Next"
          )}
        </Button>
        {listening ? (
          <span className="text-xs text-destructive">Listening…</span>
        ) : null}
      </div>
    </div>
  );
}
