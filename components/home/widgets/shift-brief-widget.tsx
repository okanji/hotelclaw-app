"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRightLeft,
  Check,
  CheckCheck,
  Plus,
  Sparkles,
  Square,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createTask } from "@/components/tasks/actions";
import { HandoverDialog } from "@/components/home/handover-dialog";
import { AttentionList } from "@/components/insights/pulse-view";
import { WidgetEmpty } from "../editorial-section";
import { shiftBriefQueryOptions } from "@/lib/query/insights-queries";
import type {
  ShiftBriefActionItem,
  ShiftBriefPayload,
} from "@/lib/insights/shift-brief";

/**
 * Shift brief — "since your last shift" for the signed-in person. The
 * payload is gathered deterministically server-side (so every task link and
 * one-tap action is correct by construction); the AI contributes only the
 * orientation paragraph on top. "Mark caught up" advances the per-user
 * cursor, so the next brief starts where this one ended.
 */
export function ShiftBriefWidget({ propertyId }: { propertyId: string }) {
  const queryClient = useQueryClient();
  const { data } = useQuery(shiftBriefQueryOptions(propertyId));
  const [marking, setMarking] = useState(false);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  // Stop any in-flight narration when the widget unmounts.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, []);

  if (!data || data.pending || !data.brief) {
    return <WidgetEmpty>Reading your shift…</WidgetEmpty>;
  }

  const payload = data.brief.payload as ShiftBriefPayload;
  const summary = data.brief.summary_md;

  // Browser TTS over the brief — for the manager walking the floor. The
  // narration is built from the same deterministic payload the widget
  // renders, so spoken and shown never diverge.
  function toggleListen() {
    const synth = window.speechSynthesis;
    if (!synth) {
      toast.error("Speech isn't supported in this browser");
      return;
    }
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const parts: string[] = [];
    if (summary) parts.push(summary);
    if (payload.attention.length > 0) {
      parts.push(
        `${payload.attention.length} item${payload.attention.length === 1 ? "" : "s"} need you: ` +
          payload.attention
            .slice(0, 5)
            .map((a) => `${a.title}, ${a.kind.replaceAll("_", " ")}`)
            .join(". "),
      );
    }
    for (const d of payload.decisions.slice(0, 3)) {
      parts.push(`Decided in ${d.meetingTitle}: ${d.decision}`);
    }
    if (payload.unownedActionItems.length > 0) {
      parts.push(
        `${payload.unownedActionItems.length} meeting commitment${payload.unownedActionItems.length === 1 ? " has" : "s have"} no owner.`,
      );
    }
    const utterance = new SpeechSynthesisUtterance(parts.join(" — "));
    utterance.rate = 1.05;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(utterance);
    setSpeaking(true);
  }

  async function markCaughtUp() {
    setMarking(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/insights/shift-brief`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "seen" }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await queryClient.invalidateQueries({
        queryKey: ["insights", propertyId, "shift-brief"],
      });
      toast.success("Caught up — the next brief starts from now");
    } catch {
      toast.error("Couldn't update your catch-up point");
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {summary ? (
        <p className="flex max-w-[72ch] items-start gap-2.5 text-[0.8125rem] leading-relaxed text-pretty text-muted-foreground">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-foreground/50" />
          <span>{summary}</span>
        </p>
      ) : null}

      {payload.attention.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <SubHeading>Yours to move</SubHeading>
          <AttentionList
            propertyId={propertyId}
            items={payload.attention.slice(0, 6)}
          />
        </div>
      ) : null}

      {payload.decisions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <SubHeading>Decided while you were away</SubHeading>
          <ul className="flex flex-col gap-1">
            {payload.decisions.slice(0, 5).map((d, i) => (
              <li
                key={`${d.meetingId}-${i}`}
                className="text-[0.8125rem] leading-relaxed text-foreground"
              >
                {d.decision}{" "}
                <span className="text-muted-foreground">
                  — {d.meetingTitle}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {payload.unownedActionItems.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <SubHeading>Commitments with no owner</SubHeading>
          <ul className="flex flex-col divide-y divide-border/40">
            {payload.unownedActionItems.map((item, i) => (
              <UnownedActionRow
                key={`${item.meetingId}-${i}`}
                propertyId={propertyId}
                item={item}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {payload.spaceChanges.some(
        (s) => s.created + s.completed + s.blocked > 0,
      ) ? (
        <div className="flex flex-col gap-1.5">
          <SubHeading>Your teams</SubHeading>
          <ul className="flex flex-col gap-1">
            {payload.spaceChanges.map((s) => (
              <li
                key={s.spaceId}
                className="text-[0.8125rem] text-muted-foreground"
              >
                <span className="font-medium text-foreground">
                  {s.spaceName}
                </span>
                {" — "}
                {[
                  s.created > 0 ? `${s.created} created` : null,
                  s.completed > 0 ? `${s.completed} completed` : null,
                  s.blocked > 0 ? `${s.blocked} blocked` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={marking}
          onClick={() => void markCaughtUp()}
        >
          <CheckCheck className="size-4" />
          Mark caught up
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setHandoverOpen(true)}
        >
          <ArrowRightLeft className="size-4" />
          Draft my handover
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={toggleListen}
          title="Read the brief aloud"
        >
          {speaking ? (
            <Square className="size-4 fill-current" />
          ) : (
            <Volume2 className="size-4" />
          )}
          {speaking ? "Stop" : "Listen"}
        </Button>
        <Link
          href={`/p/${propertyId}/home/insights`}
          className="text-[0.75rem] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          Open Insights →
        </Link>
      </div>

      <HandoverDialog
        propertyId={propertyId}
        open={handoverOpen}
        onOpenChange={setHandoverOpen}
      />
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.625rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function UnownedActionRow({
  propertyId,
  item,
}: {
  propertyId: string;
  item: ShiftBriefActionItem;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  async function makeTask() {
    setState("busy");
    const result = await createTask({
      propertyId,
      title: item.text.slice(0, 200),
      description: `From meeting: ${item.meetingTitle}`,
    });
    if ("error" in result) {
      toast.error(result.error);
      setState("idle");
    } else {
      toast.success("Task created");
      setState("done");
    }
  }

  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground">
        {item.text}
        <span className="text-muted-foreground"> — {item.meetingTitle}</span>
      </span>
      <button
        type="button"
        disabled={state !== "idle"}
        onClick={() => void makeTask()}
        className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[0.6875rem] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        {state === "done" ? (
          <>
            <Check className="size-3" />
            Created
          </>
        ) : (
          <>
            <Plus className="size-3" />
            Create task
          </>
        )}
      </button>
    </li>
  );
}
