import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMeetingDetail } from "@/lib/meetings/queries";
import { PageHeader } from "@/components/shell/page-header";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  Clock,
  FileText,
  Hash,
  Sparkles,
  Square,
  User,
  Users,
  Video,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Badge } from "@/components/gr8r/badge-glyphs";
import { JoinMeetingButton } from "@/components/meetings/join-meeting-button";
import { RegenerateSummaryButton } from "@/components/meetings/regenerate-summary-button";
import { meetingState, stateBadge, type MeetingState } from "@/lib/meetings/status";

export const dynamic = "force-dynamic";

/**
 * One meeting's notes: summary up top, action items + decisions, then the
 * raw transcript expandable below. Linked to from the system summary
 * message in chat and from the inbox.
 */
export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ propertyId: string; meetingId: string }>;
}) {
  const { propertyId, meetingId } = await params;
  const supabase = await createClient();
  const detail = await getMeetingDetail(supabase, meetingId);
  if (!detail) notFound();

  // force-dynamic: a request-time clock is the point (stale states resolve).
  // eslint-disable-next-line react-hooks/purity -- server component, per request
  const now = Date.now();
  const state = meetingState(
    {
      ...detail,
      has_summary: detail.summary !== null,
      transcript: detail.transcript
        ? { status: detail.transcript.status, created_at: detail.transcript.created_at }
        : null,
    },
    now,
  );
  const badge = stateBadge(state);
  const joinable = state.phase === "live" && detail.stream_call_type === "default";

  // Regenerate re-runs the summary from the mirrored transcript, so it needs
  // one (`lib/meetings/summarize.ts:regenerateMeetingSummary`).
  const hasStoredTranscript = Boolean(detail.transcript?.raw_jsonl);
  const transcriptText = detail.transcript?.raw_jsonl
    ? renderTranscript(detail.transcript.raw_jsonl, detail.transcript.speakers)
    : null;

  const speakers = detail.transcript?.speakers ?? [];
  const actionItems = detail.summary?.action_items ?? [];
  const decisions = detail.summary?.decisions ?? [];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={detail.title}
        icon={<Video />}
        actions={
          <Link href={`/p/${propertyId}/meetings`} className="btn btn-ghost btn-sm">
            <Gi icon={ArrowLeft} size={13} />
            All meetings
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide" style={{ maxWidth: 1080 }}>
          <div className="ph">
            <div className="grow">
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <h1>{detail.title}</h1>
                <G8Badge tone={badge.tone} title={badge.hint}>
                  {badge.label}
                </G8Badge>
              </div>
              <p>
                {new Date(state.startAt).toLocaleString()}
                {detail.host_name ? ` · Started by ${detail.host_name}` : ""}
                {detail.transcript?.duration_seconds
                  ? ` · ${formatDuration(detail.transcript.duration_seconds)}`
                  : ""}
              </p>
            </div>
            {joinable ? (
              <div className="acts">
                <JoinMeetingButton
                  meetingId={detail.id}
                  callId={detail.stream_call_id}
                  callType={detail.stream_call_type}
                />
              </div>
            ) : null}
          </div>

          <div className="grid2">
            {/* Reading column — the summary, then the raw transcript. */}
            <div className="col" style={{ gap: 16, minWidth: 0 }}>
              {detail.summary ? (
                <SummarySection
                  summary={detail.summary}
                  propertyId={propertyId}
                  meetingId={detail.id}
                  canRegenerate={hasStoredTranscript}
                />
              ) : (
                <NoSummaryState
                  state={state}
                  hasTranscript={transcriptText !== null}
                  meetingId={detail.id}
                  canRegenerate={hasStoredTranscript}
                />
              )}

              {transcriptText ? (
                <div className="panel">
                  <details>
                    <summary className="panel-h" style={{ cursor: "pointer" }}>
                      <h2>Full transcript</h2>
                      <span className="acts faint" style={{ fontSize: 12 }}>
                        Show transcript
                      </span>
                    </summary>
                    <pre
                      className="panel-b"
                      style={{
                        maxHeight: "60vh",
                        overflowY: "auto",
                        whiteSpace: "pre-wrap",
                        fontSize: 12,
                        lineHeight: 1.6,
                        margin: 0,
                        fontFamily: "inherit",
                        color: "var(--g8-text-2)",
                      }}
                    >
                      {transcriptText}
                    </pre>
                  </details>
                </div>
              ) : null}
            </div>

            {/* Side column — details, action items, decisions. */}
            <div className="col" style={{ gap: 16, minWidth: 0 }}>
              <div className="panel">
                <div className="panel-h">
                  <h2>Details</h2>
                </div>
                <div className="panel-b">
                  <dl className="kv">
                    <dt>
                      <Gi icon={CalendarDays} size={14} />
                      When
                    </dt>
                    <dd>{new Date(state.startAt).toLocaleString()}</dd>
                    {detail.host_name ? (
                      <>
                        <dt>
                          <Gi icon={User} size={14} />
                          Host
                        </dt>
                        <dd>{detail.host_name}</dd>
                      </>
                    ) : null}
                    {detail.transcript?.duration_seconds ? (
                      <>
                        <dt>
                          <Gi icon={Clock} size={14} />
                          Duration
                        </dt>
                        <dd>{formatDuration(detail.transcript.duration_seconds)}</dd>
                      </>
                    ) : null}
                    {detail.channel_name ? (
                      <>
                        <dt>
                          <Gi icon={Hash} size={14} />
                          Channel
                        </dt>
                        <dd>
                          <Link href={`/p/${propertyId}/chat`} className="muted">
                            {detail.channel_name}
                          </Link>
                        </dd>
                      </>
                    ) : null}
                    {speakers.length > 0 ? (
                      <>
                        <dt>
                          <Gi icon={Users} size={14} />
                          Participants
                        </dt>
                        <dd>{speakers.map((s) => s.name).join(", ")}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              </div>

              {actionItems.length > 0 ? (
                <div className="panel">
                  <div className="panel-h">
                    <h2>Action items</h2>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {actionItems.length}
                    </span>
                  </div>
                  <div style={{ paddingBottom: 6 }}>
                    {actionItems.map((a, i) => (
                      <div key={i} className="row" style={{ alignItems: "flex-start", gap: 9, padding: "6px 14px", fontSize: 13 }}>
                        {/* Read-only summary — a presentational glyph, not a
                            disabled checkbox screen readers would announce. */}
                        <Gi icon={Square} size={14} className="faint" />
                        <span className="grow">
                          {a.text}
                          {a.owner ? (
                            <span className="faint" style={{ marginLeft: 6, fontSize: 12 }}>
                              — {a.owner}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {decisions.length > 0 ? (
                <div className="panel">
                  <div className="panel-h">
                    <h2>Decisions</h2>
                    <span className="faint" style={{ fontSize: 12 }}>
                      {decisions.length}
                    </span>
                  </div>
                  <div style={{ paddingBottom: 6 }}>
                    {decisions.map((d, i) => (
                      <div key={i} className="row" style={{ alignItems: "flex-start", gap: 9, padding: "6px 14px", fontSize: 13 }}>
                        <Gi icon={CircleCheck} size={14} className="faint" />
                        <span className="grow">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** gr8r `.empty-state` inside a panel. */
function G8Empty({
  icon,
  title,
  action,
  children,
}: {
  icon: typeof Video;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="empty-state">
        <div className="glyph">
          <Gi icon={icon} />
        </div>
        <h3 className="es-h">{title}</h3>
        <p>{children}</p>
        {action}
      </div>
    </div>
  );
}

/**
 * What to show instead of notes — per lifecycle state, never a perpetual
 * spinner. A failed summary offers "Regenerate summary" (re-runs it from the
 * stored transcript) and points at the transcript below.
 */
function NoSummaryState({
  state,
  hasTranscript,
  meetingId,
  canRegenerate,
}: {
  state: MeetingState;
  hasTranscript: boolean;
  meetingId: string;
  canRegenerate: boolean;
}) {
  if (state.phase === "upcoming") {
    return (
      <G8Empty icon={Video} title="Not started yet">
        Notes appear here after the meeting, once its transcript is processed.
      </G8Empty>
    );
  }
  if (state.phase === "live") {
    return (
      <G8Empty icon={Video} title="Meeting in progress">
        The summary appears here a few minutes after the call ends.
      </G8Empty>
    );
  }
  const { label, hint } = stateBadge(state);
  const title =
    state.outcome === "processing" || state.outcome === "summarizing"
      ? "Generating summary…"
      : state.outcome === "summary_failed"
        ? "The summary didn't generate"
        : state.outcome === "no_call"
          ? "No call for this event"
          : state.outcome === "transcript_failed"
            ? "The transcript couldn't be fetched"
            : "No recording or transcript was captured";
  const regenerate =
    state.outcome === "summary_failed" && canRegenerate ? (
      <RegenerateSummaryButton meetingId={meetingId} />
    ) : undefined;
  return (
    <G8Empty icon={FileText} title={title} action={regenerate}>
      {hint}
      {state.outcome === "summary_failed" && hasTranscript
        ? " Read the full transcript below."
        : state.outcome === "no_transcript"
          ? " To get notes, import a transcript from the Meetings page."
          : ""}
      <span className="sr-only"> ({label})</span>
    </G8Empty>
  );
}

function SummarySection({
  summary,
  propertyId,
  meetingId,
  canRegenerate,
}: {
  summary: NonNullable<
    Awaited<ReturnType<typeof getMeetingDetail>>
  >["summary"];
  propertyId: string;
  meetingId: string;
  canRegenerate: boolean;
}) {
  if (!summary) return null;
  return (
    <div className="panel">
      <div className="panel-h">
        <Gi icon={Sparkles} size={14} className="faint" />
        <h2>Summary</h2>
        {summary.document_id ? (
          <div className="acts">
            <Link
              href={`/p/${propertyId}/documents/${summary.document_id}`}
              className="btn btn-ghost btn-sm"
            >
              <Gi icon={FileText} size={13} />
              Open as document
            </Link>
          </div>
        ) : null}
      </div>
      <div className="panel-b">
        <div
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 13.5,
            lineHeight: 1.65,
            color: "var(--g8-text)",
          }}
        >
          {summary.summary_md}
        </div>
        <div
          className="row"
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: "1px solid var(--g8-divider)",
            justifyContent: "space-between",
          }}
        >
          <span className="hint">Generated by {summary.model}</span>
          {canRegenerate ? (
            <RegenerateSummaryButton
              meetingId={meetingId}
              label="Regenerate"
              variant="ghost"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function renderTranscript(
  rawJsonl: string,
  speakers: Array<{ id: string; name: string }>,
): string {
  const nameById = new Map(speakers.map((s) => [s.id, s.name]));
  const out: string[] = [];
  for (const line of rawJsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as {
        speaker_id?: string;
        text?: string;
      };
      if (!obj.text) continue;
      const name = obj.speaker_id
        ? nameById.get(obj.speaker_id) ?? obj.speaker_id
        : "Unknown";
      out.push(`${name}: ${obj.text}`);
    } catch {
      // skip bad lines
    }
  }
  return out.join("\n");
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
