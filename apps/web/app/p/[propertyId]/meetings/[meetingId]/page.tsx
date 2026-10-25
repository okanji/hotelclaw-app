import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMeetingDetail } from "@/lib/meetings/queries";
import { PageHeader } from "@/components/shell/page-header";
import { ArrowLeft, FileText, Hash, Square, Video } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";
import { StatusBadge } from "@/components/ui/status-badge";
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title={detail.title}
        icon={<Video />}
        meta={<span title={badge.hint}><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></span>}
        actions={
          <div className="flex items-center gap-3">
          {joinable ? (
            <JoinMeetingButton
              meetingId={detail.id}
              callId={detail.stream_call_id}
              callType={detail.stream_call_type}
            />
          ) : null}
          <Link
            href={`/p/${propertyId}/meetings`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All meetings
          </Link>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto py-6">
        {/* A meeting's notes are a reading surface — the 720px prose column
            (`ui/page-shell`), one edge from the metadata header to the
            transcript. */}
        <PageShell width="prose">
        <article className="space-y-6">
          <header className="space-y-1 text-xs text-muted-foreground">
            <p>
              {new Date(state.startAt).toLocaleString()}
              {detail.host_name ? ` · Started by ${detail.host_name}` : ""}
              {detail.transcript?.duration_seconds
                ? ` · ${formatDuration(detail.transcript.duration_seconds)}`
                : ""}
            </p>
            {detail.channel_name ? (
              <p>
                <Link
                  href={`/p/${propertyId}/chat`}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <Hash className="size-3" />
                  {detail.channel_name}
                </Link>
              </p>
            ) : null}
            {detail.transcript?.speakers && detail.transcript.speakers.length > 0 ? (
              <p>
                Participants:{" "}
                {detail.transcript.speakers.map((s) => s.name).join(", ")}
              </p>
            ) : null}
          </header>

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
            <section>
              <h2 className="mb-2 text-sm font-semibold">Full transcript</h2>
              <details className="rounded-md bg-muted">
                <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
                  Show transcript
                </summary>
                <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap px-4 py-3 text-xs leading-relaxed">
                  {transcriptText}
                </pre>
              </details>
            </section>
          ) : null}
        </article>
        </PageShell>
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
      <EmptyState icon={Video} title="Not started yet">
        Notes appear here after the meeting, once its transcript is processed.
      </EmptyState>
    );
  }
  if (state.phase === "live") {
    return (
      <EmptyState icon={Video} title="Meeting in progress">
        The summary appears here a few minutes after the call ends.
      </EmptyState>
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
    <EmptyState icon={FileText} title={title} action={regenerate}>
      {hint}
      {state.outcome === "summary_failed" && hasTranscript
        ? " Read the full transcript below."
        : state.outcome === "no_transcript"
          ? " To get notes, import a transcript from the Meetings page."
          : ""}
      <span className="sr-only"> ({label})</span>
    </EmptyState>
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
    <section className="space-y-6">
      <div>
        <h2 className="mb-2 text-xs font-medium text-faint-foreground">
          Summary
        </h2>
        <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground dark:prose-invert">
          {summary.summary_md}
        </div>
      </div>

      {summary.action_items.length > 0 ? (
        <div>
          <h2 className="mb-2 text-xs font-medium text-faint-foreground">
            Action items
          </h2>
          <ul className="space-y-1">
            {summary.action_items.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {/* Read-only summary — use a presentational icon instead of
                    a disabled <input> so screen readers don't announce a
                    non-interactive "checkbox, disabled". */}
                <Square
                  aria-hidden
                  className="mt-1 size-3.5 text-muted-foreground"
                />
                <span>
                  {a.text}
                  {a.owner ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      — {a.owner}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.decisions.length > 0 ? (
        <div>
          <h2 className="mb-2 text-xs font-medium text-faint-foreground">
            Decisions
          </h2>
          <ul className="space-y-1">
            {summary.decisions.map((d, i) => (
              <li key={i} className="text-sm">
                {d}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.document_id ? (
        <Link
          href={`/p/${propertyId}/documents/${summary.document_id}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-3.5" />
          Open as document
        </Link>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-faint-foreground">
          Generated by {summary.model}
        </p>
        {canRegenerate ? (
          <RegenerateSummaryButton
            meetingId={meetingId}
            label="Regenerate"
            variant="ghost"
          />
        ) : null}
      </div>
    </section>
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
