"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Inbox,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  fleetSessionsQueryOptions,
  type FleetSessionRow,
} from "@/lib/query/fleet-queries";
import { podBotEmoji, podToolInfo } from "@/lib/fleet/tool-catalog";
import { decideApproval } from "./actions";
import { PageShell } from "@/components/ui/page-shell";

/**
 * Approvals inbox. Rows come straight from bot_chat_sessions
 * (status='awaiting_approval' + the parked requests payload stamped by the
 * runtime); Realtime invalidation in AgentsSection keeps the list live, so
 * a decision made in chat removes the row here too.
 *
 * Multi-request parks present ONE request at a time (reference:
 * .references/beautiful-ui/ApprovalCard.tsx — height-animated stack + a
 * rolling step counter). The stepping is REVIEW-ONLY: the backend decides
 * the whole session in one call, so Approve/Deny always cover every
 * request — the labels say so.
 */
export function ApprovalsView({
  propertyId,
  canDecide,
}: {
  propertyId: string;
  canDecide: boolean;
}) {
  const qc = useQueryClient();
  const { data: sessions = [] } = useQuery(
    fleetSessionsQueryOptions(propertyId),
  );
  const pending = sessions.filter((s) => s.status === "awaiting_approval");

  return (
    <PageShell className="flex h-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        eyebrow="Fleet"
        eyebrowTone="brand"
        title="Approvals"
        description="Money-moving actions the bots have parked for a human decision. Nothing executes until someone approves — here, or by replying to the bot in its channel."
      />

      {/* Masthead and content separate by WHITESPACE. The full-width rule
          that used to sit here read as a seam under a 720px document
          column (notion-spec-v2 §1/§3). */}
      <div className="h-10" />

      {pending.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing waiting on you">
          When a bot hits a gated action (refunds, rate overrides, comps), it
          parks the request and it shows up here.
        </EmptyState>
      ) : (
        <ul role="list" className="flex flex-col gap-4">
          {pending.map((session) => (
            <ApprovalCard
              key={session.id}
              propertyId={propertyId}
              session={session}
              canDecide={canDecide}
              onDecided={() =>
                void qc.invalidateQueries({
                  queryKey: ["fleet-sessions", propertyId],
                })
              }
            />
          ))}
        </ul>
      )}

      {!canDecide && pending.length > 0 ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Only owners and managers can decide approvals.
        </p>
      ) : null}
    </PageShell>
  );
}

type ApprovalRequest = {
  toolName?: string;
  input?: unknown;
  callId?: string | null;
};

const ROLL_MS = 300;

/** Odometer-style single-number roll for the step counter. */
function RollingNumber({ value }: { value: number }) {
  const prevRef = useRef(value);
  const [anim, setAnim] = useState<{
    from: number;
    to: number;
    dir: "up" | "down";
    shifted: boolean;
  } | null>(null);

  useEffect(() => {
    const from = prevRef.current;
    if (from === value) return;
    prevRef.current = value;
    setAnim({ from, to: value, dir: value > from ? "up" : "down", shifted: false });
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() =>
        setAnim((current) => (current ? { ...current, shifted: true } : current)),
      );
    });
    const done = setTimeout(() => setAnim(null), ROLL_MS);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(done);
    };
  }, [value]);

  if (!anim) return <span>{value}</span>;
  const top = anim.dir === "up" ? anim.from : anim.to;
  const bottom = anim.dir === "up" ? anim.to : anim.from;
  const restY = anim.dir === "up" ? "-1em" : "0";
  const startY = anim.dir === "up" ? "0" : "-1em";
  return (
    <span
      className="inline-block overflow-hidden"
      style={{ height: "1em", lineHeight: "1em", verticalAlign: "-0.05em" }}
    >
      <span
        className="flex flex-col transition-transform duration-300 motion-reduce:transition-none"
        style={{ transform: `translateY(${anim.shifted ? restY : startY})` }}
      >
        <span style={{ height: "1em", lineHeight: "1em" }}>{top}</span>
        <span style={{ height: "1em", lineHeight: "1em" }}>{bottom}</span>
      </span>
    </span>
  );
}

/** Animates its own height to fit the current child — the card grows and
 * shrinks smoothly as the reviewer steps between requests (or opens the
 * raw-input disclosure). A ResizeObserver keeps the measured height honest
 * for any content change, so no per-step bookkeeping is needed. */
function AnimatedHeight({ children }: { children: ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    setHeight(el.offsetHeight);
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="overflow-hidden transition-[height] duration-300 ease-out motion-reduce:transition-none"
      style={{ height }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

/** One parked request: human tool label as the headline, readable
 * definition rows for the scalar input fields, raw JSON behind a
 * disclosure for anything nested. */
function RequestDetail({ request }: { request: ApprovalRequest }) {
  const info = request.toolName ? podToolInfo(request.toolName) : null;
  const input = request.input;
  const isPlainObject =
    typeof input === "object" && input !== null && !Array.isArray(input);
  const entries = isPlainObject
    ? Object.entries(input as Record<string, unknown>)
    : [];
  const scalar = entries.filter(
    ([, value]) =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean",
  );
  const hasRaw =
    (input != null && !isPlainObject) || entries.length > scalar.length;

  return (
    <div className="flex flex-col gap-2 rounded-md bg-background px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="text-sm font-medium">
            {info?.label ?? request.toolName ?? "Pending action"}
          </p>
          {info ? (
            <code className="font-mono text-xs text-faint-foreground">
              {request.toolName}
            </code>
          ) : null}
        </div>
        {info ? (
          <p className="text-xs text-muted-foreground">{info.description}</p>
        ) : null}
      </div>

      {scalar.length > 0 ? (
        <dl className="flex flex-col gap-1">
          {scalar.map(([key, value]) => (
            <div key={key} className="flex items-baseline gap-2">
              <dt className="w-28 shrink-0 truncate font-mono text-xs text-faint-foreground">
                {key}
              </dt>
              <dd className="min-w-0 text-sm break-words">{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hasRaw ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground">
            Raw input
          </summary>
          <pre className="mt-1.5 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-snug">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function ApprovalCard({
  propertyId,
  session,
  canDecide,
  onDecided,
}: {
  propertyId: string;
  session: FleetSessionRow;
  canDecide: boolean;
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [step, setStep] = useState(0);
  const requests: ApprovalRequest[] = session.pending_approval?.requests?.length
    ? session.pending_approval.requests
    : [{ input: null }];
  const requestedAt = session.pending_approval?.requestedAt;
  const isWorkflow = session.channel_id.startsWith("workflow:");
  const multi = requests.length > 1;
  // Clamp in case the payload shrinks under Realtime while a step is open.
  const active = Math.min(step, requests.length - 1);
  const last = active === requests.length - 1;

  async function decide(decision: "approve" | "deny") {
    setBusy(decision);
    try {
      const result = await decideApproval({
        propertyId,
        sessionRowId: session.id,
        decision,
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        toast.success(
          decision === "approve" ? "Approved — the bot is proceeding" : "Denied",
        );
      }
      onDecided();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card bg-warning/10 p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-sm">
          {podBotEmoji(session.bot?.bot_id ?? "")}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {session.bot?.display_name ?? "Bot"}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {isWorkflow ? "workflow run" : session.channel_id}
            {requestedAt
              ? ` · ${new Date(requestedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </p>
        </div>
      </div>

      {multi ? (
        <AnimatedHeight>
          <RequestDetail request={requests[active]} />
        </AnimatedHeight>
      ) : (
        <RequestDetail request={requests[0]} />
      )}

      {multi || canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          {multi ? (
            <div className="flex items-center gap-1 text-muted-foreground">
              <button
                type="button"
                aria-label="Previous request"
                disabled={active <= 0}
                onClick={() => setStep(active - 1)}
                className="flex size-5 items-center justify-center rounded-md transition-colors enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <span className="px-0.5 text-xs font-medium tabular-nums">
                <RollingNumber value={active + 1} /> / {requests.length}
              </span>
              <button
                type="button"
                aria-label="Next request"
                disabled={last}
                onClick={() => setStep(active + 1)}
                className="flex size-5 items-center justify-center rounded-md transition-colors enabled:hover:bg-accent enabled:hover:text-foreground disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          ) : null}

          {canDecide ? (
            <div className="ml-auto flex items-center gap-1.5">
              {multi && !last ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep(active + 1)}
                >
                  Next
                  <ArrowRight className="size-3.5" />
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => decide("deny")}
                disabled={busy !== null}
              >
                {busy === "deny" ? "Denying…" : multi ? "Deny all" : "Deny"}
              </Button>
              <Button
                size="sm"
                onClick={() => decide("approve")}
                disabled={busy !== null}
              >
                {busy === "approve"
                  ? "Approving…"
                  : multi
                    ? "Approve all"
                    : "Approve"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canDecide ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Inbox className="size-3.5 shrink-0" />
          {multi
            ? `One decision covers all ${requests.length} requests — parked until someone decides, restarts included.`
            : "Parked until decided — restarts included"}
        </p>
      ) : null}
    </li>
  );
}
