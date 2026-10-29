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
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Badge } from "@/components/gr8r/ai-glyphs";
import { G8Empty } from "@/components/gr8r/members-shared";
import {
  fleetSessionsQueryOptions,
  type FleetSessionRow,
} from "@/lib/query/fleet-queries";
import { podBotEmoji, podToolInfo } from "@/lib/fleet/tool-catalog";
import { decideApproval } from "./actions";
import { PageHeader } from "@/components/shell/page-header";

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
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Agents", href: `/p/${propertyId}/agents`, icon: <Sparkles /> },
          { label: "Approvals" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 820 }}>
          <div className="ph">
            <div>
              <h1>Approvals</h1>
              <p>
                {pending.length
                  ? `${pending.length} gated action${pending.length === 1 ? "" : "s"} waiting on a human`
                  : "Gated actions the pod bots parked for a human decision."}
              </p>
            </div>
          </div>
          {!canDecide && pending.length > 0 ? (
            <div className="alert info" style={{ marginBottom: 14 }}>
              <Gi icon={Lock} size={15} />
              <div>Only owners and managers can decide approvals.</div>
            </div>
          ) : null}
          {pending.length === 0 ? (
            <div className="panel">
              <G8Empty
                icon={ShieldCheck}
                title="Nothing waiting on you"
                text="When a bot hits a gated action (refunds, rate overrides, comps), it parks the request and it shows up here."
              />
            </div>
          ) : (
            <ul role="list" className="stack" style={{ margin: 0, padding: 0, listStyle: "none" }}>
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

        </div>
      </div>
    </div>
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
    <div className="flex flex-col gap-2" style={{ border: "1px solid var(--g8-border)", borderRadius: "var(--g8-r)", padding: "10px 12px", background: "var(--g8-surface-2)" }}>
      <div className="flex flex-col gap-0.5">
        <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
          <b style={{ fontWeight: 600 }}>
            {info?.label ?? request.toolName ?? "Pending action"}
          </b>
          {info ? (
            <code className="mono faint" style={{ fontSize: "var(--g8-fs-xs)" }}>
              {request.toolName}
            </code>
          ) : null}
        </div>
        {info ? (
          <p className="muted" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>{info.description}</p>
        ) : null}
      </div>

      {scalar.length > 0 ? (
        <dl className="kv" style={{ alignItems: "baseline" }}>
          {scalar.map(([key, value]) => (
            <div key={key} style={{ display: "contents" }}>
              <dt className="mono trunc" style={{ height: "auto", minHeight: 22, fontSize: "var(--g8-fs-xs)" }}>
                {key}
              </dt>
              <dd style={{ minHeight: 22, wordBreak: "break-word" }}>{String(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {hasRaw ? (
        <details>
          <summary className="link" style={{ cursor: "pointer", fontSize: "var(--g8-fs-xs)" }}>
            Raw input
          </summary>
          <pre className="mono" style={{ marginTop: 6, maxHeight: 160, overflow: "auto", borderRadius: "var(--g8-r-sm)", background: "var(--g8-surface-3)", padding: 8, fontSize: "var(--g8-fs-xs)", lineHeight: 1.4 }}>
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
    <li className="panel" style={{ borderColor: "color-mix(in srgb, var(--g8-amber) 35%, var(--g8-border))" }}>
      <div className="panel-h">
        <span className="picon" style={{ "--g8-c": "var(--g8-amber)", fontSize: 14 } as React.CSSProperties}>
          {podBotEmoji(session.bot?.bot_id ?? "")}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="trunc">
            {session.bot?.display_name ?? "Bot"}
          </h2>
          <p className="mono faint trunc" style={{ margin: 0, fontSize: "var(--g8-fs-xs)" }}>
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
        <div className="acts">
          <G8Badge tone="warning">Awaiting approval</G8Badge>
        </div>
      </div>

      <div className="panel-b flex flex-col gap-3">
      {multi ? (
        <AnimatedHeight>
          <RequestDetail request={requests[active]} />
        </AnimatedHeight>
      ) : (
        <RequestDetail request={requests[0]} />
      )}

      {multi || canDecide ? (
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {multi ? (
            <div className="row muted" style={{ gap: 4 }}>
              <button
                type="button"
                aria-label="Previous request"
                disabled={active <= 0}
                onClick={() => setStep(active - 1)}
                className="ibtn ibtn-xs"
              >
                <Gi icon={ChevronLeft} size={13} />
              </button>
              <span className="px-0.5 text-xs font-medium tabular-nums">
                <RollingNumber value={active + 1} /> / {requests.length}
              </span>
              <button
                type="button"
                aria-label="Next request"
                disabled={last}
                onClick={() => setStep(active + 1)}
                className="ibtn ibtn-xs"
              >
                <Gi icon={ChevronRight} size={13} />
              </button>
            </div>
          ) : null}

          {canDecide ? (
            <div className="row" style={{ marginLeft: "auto", gap: 6 }}>
              {multi && !last ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setStep(active + 1)}
                >
                  Next
                  <Gi icon={ArrowRight} size={13} />
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => decide("deny")}
                disabled={busy !== null}
              >
                {busy === "deny" ? "Denying…" : multi ? "Deny all" : "Deny"}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => decide("approve")}
                disabled={busy !== null}
              >
                {busy === "approve"
                  ? "Approving…"
                  : multi
                    ? "Approve all"
                    : "Approve"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {canDecide ? (
        <p className="row faint" style={{ margin: 0, gap: 6, fontSize: "var(--g8-fs-xs)" }}>
          <Gi icon={Inbox} size={13} />
          {multi
            ? `One decision covers all ${requests.length} requests — parked until someone decides, restarts included.`
            : "Parked until decided — restarts included"}
        </p>
      ) : null}
      </div>
    </li>
  );
}
