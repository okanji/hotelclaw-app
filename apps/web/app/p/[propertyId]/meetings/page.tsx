import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMeetings } from "@/lib/meetings/queries";
import { PageHeader } from "@/components/shell/page-header";
import { Video } from "lucide-react";
import { ImportTranscriptDialog } from "@/components/chat/meeting/import-transcript-dialog";

export const dynamic = "force-dynamic";

/**
 * Meeting notes index — every meeting in the property with its summary
 * status. Lives outside the persistent-surface pattern (chat/tasks/docs)
 * because meetings are visited via deep links from chat messages and the
 * inbox; they don't get rail real estate.
 */
export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const supabase = await createClient();

  // RLS will return zero rows for non-members — surface as 404 instead of an
  // empty page that hints the property exists.
  const { data: property } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .is("archived_at", null)
    .maybeSingle();
  if (!property) notFound();

  const meetings = await getMeetings(supabase, propertyId);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <PageHeader
        title="Meetings"
        icon={<Video />}
        actions={
          <div className="flex items-center gap-3">
            <p className="hidden text-xs text-muted-foreground sm:block">
              Recorded meetings, transcripts, and AI-generated notes
            </p>
            <ImportTranscriptDialog propertyId={propertyId} />
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        {meetings.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Video className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">No meetings yet</p>
            <p className="text-xs text-muted-foreground">
              Click <strong>Meet</strong> in any channel header to start one.
            </p>
          </div>
        ) : (
          <ul className="mx-auto max-w-6xl space-y-2">
            {meetings.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/p/${propertyId}/meetings/${m.id}`}
                  className="block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">
                        {m.title}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatRelative(m.started_at)}
                        {m.channel_name ? ` · #${m.channel_name}` : ""}
                        {m.host_name ? ` · started by ${m.host_name}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-xs">
                      {m.duration_seconds ? (
                        <span className="text-muted-foreground">
                          {formatDuration(m.duration_seconds)}
                        </span>
                      ) : null}
                      <StatusPill
                        ended={!!m.ended_at}
                        hasSummary={m.has_summary}
                      />
                    </div>
                  </div>
                  {m.speakers.length > 0 ? (
                    <p className="mt-2 truncate text-xs text-muted-foreground">
                      {m.speakers.map((s) => s.name).join(", ")}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({
  ended,
  hasSummary,
}: {
  ended: boolean;
  hasSummary: boolean;
}) {
  if (!ended) {
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 font-medium text-success">
        Live
      </span>
    );
  }
  if (hasSummary) {
    return (
      <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 font-medium text-indigo-700 dark:text-indigo-300">
        Summary ready
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground">
      Processing…
    </span>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
