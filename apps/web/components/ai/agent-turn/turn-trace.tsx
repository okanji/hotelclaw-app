"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  FileTextIcon,
  GlobeIcon,
  LayoutPanelTopIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  PencilLineIcon,
  SearchIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from "lucide-react";
import {
  extractSources,
  isWebTool,
  pretty,
  settledLabel,
  stepDuration,
  stepGlyph,
  stepTitle,
  traceSummary,
  visibleSteps,
  HIDDEN_LABELS,
  type SourceLink,
  type StepGlyph,
  type SummaryStep,
  type TurnStep,
} from "@hotelclaw/chat-ui/turn";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { AiElapsed } from "@/components/ui/ai-loader";
import { cn } from "@/lib/utils";
import { useTurnSteps } from "./turn-activity";

/**
 * The steps behind an AI turn, on the shadcn/ui Trace primitive — the ONE
 * trace renderer for every surface (channel bot, Assistant, Agents, the
 * fleet viewer, the panel bots, the live thinking row). Input is always
 * `TurnStep[]` from `@hotelclaw/chat-ui/turn`; the labels, titles and
 * summary figures come from there too, so the phone's trace reads the same.
 *
 * Composition follows the shadcn/ui AI Elements patterns one for one
 * (ui.shadcn.com/docs/ai-elements/base/*):
 *  - Chain of Thought — the summary line ("Worked through 5 steps · 15s")
 *    that opens into the steps; open while running, the reader's toggle
 *    wins once they touch it; `keepMounted` so nested rows keep their state.
 *  - Tool — a plain line while a call runs, a collapsible once it has
 *    output, with the input and output in a small Code Block; status
 *    "running" / "error" / none, and the title in the matching tense.
 *  - Reasoning — "Thinking" while it streams, "Thought" after, text inside.
 *  - Subagent — "Running the X subagent" / "Ran …" with how it ended and
 *    the duration in a TraceDescription.
 *  - Sources — a nested trace of links when a web search returned pages.
 * Parked questions and approvals are steps of the turn too (eve holds the
 * turn open on them), so they appear as lines once answered; the live
 * controls for an OPEN park render outside the trace (park-controls.tsx),
 * as the Confirmation pattern prescribes.
 */

export type { SummaryStep };
export { settledLabel };

const GLYPHS: Record<StepGlyph, ReactNode> = {
  skill: <BookOpenIcon />,
  agent: <BotIcon />,
  question: <CircleHelpIcon />,
  approval: <ShieldCheckIcon />,
  web: <GlobeIcon />,
  memory: <BrainIcon />,
  search: <SearchIcon />,
  read: <FileTextIcon />,
  write: <PencilLineIcon />,
  view: <LayoutPanelTopIcon />,
  reasoning: <BrainIcon />,
  tool: <WrenchIcon />,
};

function StatusIcon({ status }: { status?: "running" | "error" | "cancelled" }) {
  if (status === "running") return <LoaderCircleIcon className="animate-spin" />;
  if (status === "error") return <CircleAlertIcon />;
  if (status === "cancelled") return <OctagonXIcon />;
  return <CircleCheckIcon />;
}

function SourceLines({ sources }: { sources: SourceLink[] }) {
  return (
    <Trace>
      {sources.map((source) => (
        <a key={source.url} href={source.url} target="_blank" rel="noreferrer">
          <TraceLine>
            <TraceIcon>
              <GlobeIcon />
            </TraceIcon>
            <TraceTitle>
              {source.title}
              <span className="sr-only"> (opens in a new tab)</span>
            </TraceTitle>
            <TraceIcon>
              <ArrowUpRightIcon />
            </TraceIcon>
          </TraceLine>
        </a>
      ))}
    </Trace>
  );
}

/** Reasoning pattern: "Thinking" → "Thought", the text inside. */
function ReasoningRow({ step, live }: { step: TurnStep; live: boolean }) {
  const [open, setOpen] = useState<boolean>();
  const running = live && step.status === "running";
  const text = step.detail ?? "";
  const line = (
    <TraceLine status={running ? "running" : undefined}>
      <TraceIcon>
        {running ? <LoaderCircleIcon className="animate-spin" /> : <CircleCheckIcon />}
      </TraceIcon>
      <TraceTitle>{stepTitle(step, live)}</TraceTitle>
    </TraceLine>
  );
  if (!text) return line;
  return (
    <TraceCollapsible open={open ?? running} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="whitespace-pre-wrap">{text}</TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** Subagent pattern: the run as the line, how it ended inside. */
function TaskRow({ step, live }: { step: TurnStep; live: boolean }) {
  const running = step.status === "running" && live;
  const stranded = step.status === "running" && !live;
  const failed = step.status === "failed" || stranded;
  const cancelled = step.status === "cancelled";
  const duration = stepDuration(step);
  const line = (
    <TraceLine status={running ? "running" : failed ? "error" : undefined}>
      <TraceIcon>
        <StatusIcon
          status={running ? "running" : failed ? "error" : cancelled ? "cancelled" : undefined}
        />
      </TraceIcon>
      <TraceTitle>{stepTitle(step, live)}</TraceTitle>
      {duration ? <TraceDescription>{duration}</TraceDescription> : null}
    </TraceLine>
  );
  const output = step.output !== null && step.output !== undefined ? pretty(step.output) : "";
  const body = step.detail || output;
  if (!body) return line;
  return (
    <TraceCollapsible defaultOpen={running}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent keepMounted className="flex flex-col gap-3">
        {step.detail ? <p>{step.detail}</p> : null}
        {output && output !== step.detail ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {output}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

/** A park that has since resolved reads as a line (Confirmation pattern:
 *  "once the person answers, the call becomes a Tool line"). */
function ParkRow({ step, live }: { step: TurnStep; live: boolean }) {
  const waiting = step.status === "running";
  return (
    <TraceLine status={waiting && live ? "running" : undefined}>
      <TraceIcon>{GLYPHS[stepGlyph(step)]}</TraceIcon>
      <TraceTitle>{stepTitle(step, live)}</TraceTitle>
    </TraceLine>
  );
}

/** Tool pattern: a line while it runs, a collapsible once it has output. */
function ToolRow({ step, live }: { step: TurnStep; live: boolean }) {
  const running = step.status === "running" && live;
  const stranded = step.status === "running" && !live;
  const failed = step.status === "failed" || stranded;
  const status = running ? "running" : failed ? "error" : undefined;
  const duration = running ? null : stepDuration(step);
  const line = (
    <TraceLine status={status}>
      <TraceIcon>{GLYPHS[stepGlyph(step)]}</TraceIcon>
      <TraceTitle>{stepTitle(step, live)}</TraceTitle>
      {duration ? <TraceDescription>{duration}</TraceDescription> : null}
    </TraceLine>
  );

  const hasInput = step.input !== null && step.input !== undefined && step.input !== "";
  const hasOutput = step.output !== null && step.output !== undefined && step.output !== "";
  const sources = useMemo(
    () => (isWebTool(step.toolName) ? extractSources(step.output) : []),
    [step.toolName, step.output],
  );
  if (!hasInput && !hasOutput && !step.detail) return line;

  return (
    <TraceCollapsible defaultOpen={failed && !running}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2">
        {failed && step.detail ? (
          <CodeBlock size="sm" variant="destructive">
            <CodeBlockContent wrap className="max-h-64">
              {step.detail}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
        {sources.length > 0 ? <SourceLines sources={sources} /> : null}
        {hasInput ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-48">
              {pretty(step.input)}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
        {hasOutput && sources.length === 0 ? (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-64">
              {pretty(step.output)}
            </CodeBlockContent>
          </CodeBlock>
        ) : null}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

export function StepRow({ step, live }: { step: TurnStep; live: boolean }) {
  switch (step.kind) {
    case "reasoning":
      return <ReasoningRow step={step} live={live} />;
    case "task":
      return <TaskRow step={step} live={live} />;
    case "question":
    case "approval":
      return <ParkRow step={step} live={live} />;
    case "tool":
    case "skill":
    case "subagent":
      return <ToolRow step={step} live={live} />;
    default: {
      // Legacy label-only rows and lifecycle notes ("Stopped").
      const cancelled = step.status === "cancelled";
      return (
        <TraceLine status={step.status === "running" && live ? "running" : undefined}>
          <TraceIcon>
            <StatusIcon status={cancelled ? "cancelled" : undefined} />
          </TraceIcon>
          <TraceTitle>{stepTitle(step, live)}</TraceTitle>
        </TraceLine>
      );
    }
  }
}

/**
 * The trace of one turn.
 *
 * `steps` are structured rows when the caller has them (eve transcripts,
 * panel bots, the live thinking row); `summary` is a channel message's
 * `eve_steps` (labels + times, always present on a delivered reply) and
 * `fetchKey` lets that trace load its rows when opened.
 */
export function TurnTrace({
  summary,
  steps: givenSteps,
  live = false,
  activity = null,
  fetchKey = null,
  defaultOpen,
  className,
}: {
  summary?: SummaryStep[] | null;
  steps?: TurnStep[] | null;
  live?: boolean;
  /** The live status line (what the agent is doing right now). */
  activity?: string | null;
  fetchKey?: { channelId: string; turnNonce: string } | null;
  /** Override the initial open state (default: open while live). */
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState<boolean>();
  const expanded = open ?? defaultOpen ?? live;
  const fetched = useTurnSteps({
    channelId: fetchKey?.channelId ?? null,
    turnNonce: fetchKey?.turnNonce ?? null,
    enabled: expanded && !givenSteps && !!fetchKey,
  });
  const rows = givenSteps ?? fetched.steps;
  const shown = useMemo(() => (rows ? visibleSteps(rows) : null), [rows]);
  const figures = useMemo(() => traceSummary(rows, summary, live), [rows, summary, live]);

  if (!live && figures.counted === 0 && !figures.reasoningOnly) return null;

  // Reasoning with no tool work needs no summary wrapper — the Reasoning
  // line IS the trace.
  if (!live && figures.reasoningOnly && shown) {
    return (
      <Trace className={className}>
        {shown.map((step) => (
          <StepRow key={step.id} step={step} live={false} />
        ))}
      </Trace>
    );
  }

  const status = live ? "running" : figures.failed > 0 ? "error" : undefined;
  const title = live ? (activity ?? "Thinking…").replace(/…$/, "") : figures.title;

  return (
    <Trace className={className}>
      <TraceCollapsible open={expanded} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={status}>
            <TraceIcon>
              <StatusIcon status={status} />
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
            {live ? (
              <TraceDescription>
                <AiElapsed className="text-[length:inherit] text-muted-foreground/70" />
              </TraceDescription>
            ) : figures.duration ? (
              <TraceDescription>{figures.duration}</TraceDescription>
            ) : null}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent keepMounted>
          {shown ? (
            shown.length > 0 ? (
              <Trace>
                {shown.map((step) => (
                  <StepRow key={step.id} step={step} live={live} />
                ))}
              </Trace>
            ) : (
              <span className={cn("text-sm", live && "shimmer")}>
                {live ? "Starting…" : "No steps recorded."}
              </span>
            )
          ) : fetched.loading ? (
            <span className="shimmer text-sm">Loading the steps…</span>
          ) : (
            // Rows unavailable (older turn, or the fetch failed): the
            // labels the message carries still tell the story.
            <Trace>
              {(summary ?? [])
                .filter((s) => !HIDDEN_LABELS.has(s.label))
                .map((s, i) => (
                  <TraceLine key={`${s.at}-${i}`}>
                    <TraceIcon>
                      <CircleCheckIcon />
                    </TraceIcon>
                    <TraceTitle>{settledLabel(s.label)}</TraceTitle>
                  </TraceLine>
                ))}
            </Trace>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
