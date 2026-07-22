import "server-only";
import { generateObject } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { getStreamServer } from "@/lib/stream/server";
import { getModel, type ModelKey } from "@/lib/ai/providers";
import { createNotifications } from "@/lib/notifications/server";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";

/**
 * Webhook → transcript → summary pipeline.
 *
 * The Stream `call.transcription_ready` webhook hands us a short-lived signed
 * URL pointing at a JSONL file. We:
 *
 *   1. Fetch the JSONL (idempotent — repeated webhook deliveries are OK).
 *   2. Mirror it into `meeting_transcripts.raw_jsonl` so we don't depend on
 *      the URL after expiry.
 *   3. Resolve `speaker_id`s to display names via the `profiles` table.
 *      Stream's transcript uses our Supabase user-id as speaker_id (the
 *      same id we pass in the video token).
 *   4. Run Claude on a rendered "Name: text" transcript with `generateObject`
 *      to get a structured summary.
 *   5. Persist the summary, post a system message to the originating channel,
 *      and drop a doc under the property so the transcript surfaces in the
 *      docs tree.
 *
 * Everything is best-effort beyond step (2): a failure in summarization
 * leaves the transcript persisted so a manual retry (or a follow-up
 * "Regenerate summary" button) can pick it up later.
 */

const SUMMARY_MODEL: ModelKey = "xai:grok-4-fast-non-reasoning-latest";

type JsonlLine = {
  type?: string;
  start_time?: string;
  stop_time?: string;
  speaker_id?: string;
  text?: string;
};

type Speaker = { id: string; name: string };

type MeetingMeta = {
  id: string;
  propertyId: string;
  channelId: string | null;
  hostId: string | null;
  title: string;
  streamCallId: string;
};

type TranscriptMeta = {
  url: string;
  filename: string;
  startTime?: string;
  endTime?: string;
  sessionId?: string;
};

const SummarySchema = z.object({
  summary_md: z
    .string()
    .describe(
      "A concise markdown summary of the meeting (3-5 paragraphs). Lead with a one-sentence TL;DR.",
    ),
  action_items: z
    .array(
      z.object({
        text: z.string(),
        owner: z
          .string()
          .nullable()
          .describe("Speaker display name responsible, or null if unassigned."),
      }),
    )
    .describe("Concrete follow-ups committed to during the meeting."),
  decisions: z
    .array(z.string())
    .describe("Decisions explicitly made during the meeting."),
});

/**
 * H1 — import an EXTERNAL transcript (a recorder device, another tool's
 * export) through the same pipeline as native Stream meetings: meeting row +
 * mirrored transcript + AI summary + transcript document + optional channel
 * post + meeting_summaries row. Plain text in ("Name: line" or freeform);
 * speaker names are best-effort parsed from leading "Name:" patterns.
 */
export async function processImportedTranscript(args: {
  propertyId: string;
  hostId: string;
  title: string;
  rawText: string;
  channelId?: string | null;
}): Promise<{ meetingId: string } | { error: string }> {
  const service = createServiceClient();
  const text = args.rawText.trim().slice(0, 400_000);
  if (text.length < 40) return { error: "That transcript looks empty" };

  // Best-effort speakers: distinct leading "Name:" tokens (≤ 12).
  const speakerNames = new Set<string>();
  for (const line of text.split("\n")) {
    const m = /^([A-Za-zÀ-ž][\w .'-]{1,40}):\s/.exec(line.trim());
    if (m) speakerNames.add(m[1].trim());
    if (speakerNames.size >= 12) break;
  }
  const speakers: Speaker[] = [...speakerNames].map((name) => ({
    id: name,
    name,
  }));

  const { data: meetingRow, error: meetingErr } = await service
    .from("meetings")
    .insert({
      property_id: args.propertyId,
      channel_id: args.channelId ?? null,
      stream_call_id: `import-${crypto.randomUUID()}`,
      title: args.title,
      host_id: args.hostId,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (meetingErr || !meetingRow) {
    return { error: meetingErr?.message ?? "meeting insert failed" };
  }

  const meeting: MeetingMeta = {
    id: meetingRow.id,
    propertyId: args.propertyId,
    channelId: args.channelId ?? null,
    hostId: args.hostId,
    title: args.title,
    streamCallId: `import-${meetingRow.id}`,
  };

  const { data: transcriptRow, error: insertErr } = await service
    .from("meeting_transcripts")
    .insert({
      meeting_id: meeting.id,
      source_url: "imported://transcript",
      raw_jsonl: text,
      speakers,
      duration_seconds: null,
      status: "fetched",
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertErr || !transcriptRow) {
    return { error: insertErr?.message ?? "transcript insert failed" };
  }

  const rendered = text.slice(0, 120_000);
  let summary: z.infer<typeof SummarySchema>;
  try {
    const result = await generateObject({
      model: getModel(SUMMARY_MODEL),
      schema: SummarySchema,
      system:
        "You summarize meeting transcripts for a hotel-operations team. " +
        "Be specific: name people involved, capture deadlines, distinguish " +
        "decisions from open questions. If the transcript is too short or " +
        "garbled to summarize, return summary_md = 'Meeting too short to summarize.' " +
        "with empty arrays.",
      prompt: `Meeting title: ${meeting.title}\n\nTranscript:\n${rendered}`,
    });
    summary = result.object;
  } catch (e) {
    console.error("imported-transcript summarization failed", e);
    // Transcript is saved; the meeting shows without a summary.
    return { meetingId: meeting.id };
  }

  const documentId = await createTranscriptDocument({
    service,
    meeting,
    summary,
    rendered,
    speakers,
  });
  const chatMessageId = await postSummaryToChannel({
    meeting,
    summary,
    speakers,
    durationSeconds: null,
  });
  await service.from("meeting_summaries").insert({
    meeting_id: meeting.id,
    transcript_id: transcriptRow.id,
    model: SUMMARY_MODEL,
    summary_md: summary.summary_md,
    action_items: summary.action_items,
    decisions: summary.decisions,
    document_id: documentId,
    chat_message_id: chatMessageId,
  });

  return { meetingId: meeting.id };
}

export async function processTranscriptReady(args: {
  meeting: MeetingMeta;
  transcript: TranscriptMeta;
}): Promise<void> {
  const service = createServiceClient();

  // ---------------------------------------------------------------------
  // 1 & 2: Fetch + mirror.
  // ---------------------------------------------------------------------
  const res = await fetch(args.transcript.url);
  if (!res.ok) {
    throw new Error(
      `Stream transcript fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const rawJsonl = await res.text();
  const lines = parseJsonl(rawJsonl);
  const speakerIds = uniqueSpeakerIds(lines);
  const speakers = await resolveSpeakers(service, speakerIds);
  const durationSeconds = computeDurationSeconds(lines);

  const { data: transcriptRow, error: insertErr } = await service
    .from("meeting_transcripts")
    .insert({
      meeting_id: args.meeting.id,
      source_url: args.transcript.url,
      raw_jsonl: rawJsonl,
      speakers: speakers,
      duration_seconds: durationSeconds,
      status: "fetched",
      fetched_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertErr || !transcriptRow) {
    throw new Error(
      `meeting_transcripts insert failed: ${insertErr?.message ?? "no row"}`,
    );
  }

  // ---------------------------------------------------------------------
  // 3 & 4: Render + summarize.
  // ---------------------------------------------------------------------
  const rendered = renderTranscriptForLLM(lines, speakers);
  let summary: z.infer<typeof SummarySchema>;
  try {
    const result = await generateObject({
      model: getModel(SUMMARY_MODEL),
      schema: SummarySchema,
      system:
        "You summarize meeting transcripts for a hotel-operations team. " +
        "Be specific: name people involved, capture deadlines, distinguish " +
        "decisions from open questions. If the transcript is too short or " +
        "garbled to summarize, return summary_md = 'Meeting too short to summarize.' " +
        "with empty arrays.",
      prompt: `Meeting title: ${args.meeting.title}\n\nTranscript:\n${rendered}`,
    });
    summary = result.object;
  } catch (e) {
    console.error("Grok summarization failed", e);
    // Persist what we have — the transcript is safe and the UI can offer
    // a "Retry summary" affordance. We do NOT throw; the webhook reply
    // would 500 and Stream would retry, but the transcript is already
    // saved so a retry would create duplicate rows.
    return;
  }

  // ---------------------------------------------------------------------
  // 5: Persist + propagate.
  // ---------------------------------------------------------------------
  const documentId = await createTranscriptDocument({
    service,
    meeting: args.meeting,
    summary,
    rendered,
    speakers,
  });

  const chatMessageId = await postSummaryToChannel({
    meeting: args.meeting,
    summary,
    speakers,
    durationSeconds,
  });

  await service.from("meeting_summaries").insert({
    meeting_id: args.meeting.id,
    transcript_id: transcriptRow.id,
    model: SUMMARY_MODEL,
    summary_md: summary.summary_md,
    action_items: summary.action_items,
    decisions: summary.decisions,
    document_id: documentId,
    chat_message_id: chatMessageId,
  });

  await emitWorkflowEvent({
    propertyId: args.meeting.propertyId,
    source: "stream.call",
    eventType: "meeting.summary_ready",
    entityId: args.meeting.id,
    entityKind: "meeting",
    payload: {
      meeting: { id: args.meeting.id, title: args.meeting.title, channel_id: args.meeting.channelId },
      summary: { summary_md: summary.summary_md, decisions: summary.decisions },
      action_items: summary.action_items,
    },
  });

  await notifyParticipants({
    meeting: args.meeting,
    speakers,
    summaryPreview: summary.summary_md,
  });

  // Durable evidence into the property's shared brain (fail-soft): the
  // decisions + action items are exactly the "what did we agree and why"
  // institutional memory other bots should find later. The full summary
  // stays in the app doc — the brain gets the durable takeaways.
  try {
    const { resolvePropertyBrain, captureToBrain } = await import(
      "@/lib/brain/client"
    );
    const binding = await resolvePropertyBrain(args.meeting.propertyId);
    if (binding && (summary.decisions.length || summary.action_items.length)) {
      const detail = [
        summary.decisions.length
          ? `Decisions:\n${summary.decisions.map((d) => `- ${d}`).join("\n")}`
          : "",
        summary.action_items.length
          ? `Action items:\n${summary.action_items
              .map((a) => `- ${typeof a === "string" ? a : JSON.stringify(a)}`)
              .join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const captured = await captureToBrain(binding, {
        slug: "operations/meetings",
        pageTitle: "Meeting outcomes",
        summary: `${args.meeting.title || "Meeting"}: ${summary.decisions[0] ?? summary.summary_md.split("\n")[0].slice(0, 200)}`,
        detail,
        source: `meeting ${args.meeting.id}, ${new Date().toISOString().slice(0, 10)}`,
      });
      if (!captured.ok) {
        const { logBrainEvent } = await import("@/lib/brain/telemetry");
        logBrainEvent("capture_failed", {
          surface: "meeting-outcomes",
          propertyId: args.meeting.propertyId,
          meetingId: args.meeting.id,
          reason: captured.reason,
        });
      }
    }
  } catch (err) {
    const { logBrainEvent } = await import("@/lib/brain/telemetry");
    logBrainEvent("capture_failed", {
      surface: "meeting-outcomes",
      propertyId: args.meeting.propertyId,
      meetingId: args.meeting.id,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

async function notifyParticipants(args: {
  meeting: MeetingMeta;
  speakers: Speaker[];
  summaryPreview: string;
}): Promise<void> {
  // Notify everyone who spoke in the meeting. The host gets a row even if
  // they didn't speak so they can find the notes from the inbox.
  const recipients = new Set<string>(args.speakers.map((s) => s.id));
  if (args.meeting.hostId) recipients.add(args.meeting.hostId);
  if (recipients.size === 0) return;

  const preview = args.summaryPreview.slice(0, 200);
  await createNotifications(
    [...recipients].map((userId) => ({
      userId,
      propertyId: args.meeting.propertyId,
      type: "meeting_summary",
      payload: {
        meetingId: args.meeting.id,
        title: args.meeting.title,
        channelId: args.meeting.channelId,
        preview,
      },
    })),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonl(raw: string): JsonlLine[] {
  const out: JsonlLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as JsonlLine);
    } catch {
      // Stream's JSONL is well-formed in practice; skip the odd bad line
      // rather than failing the whole pipeline.
    }
  }
  return out;
}

function uniqueSpeakerIds(lines: JsonlLine[]): string[] {
  const seen = new Set<string>();
  for (const l of lines) {
    if (l.speaker_id) seen.add(l.speaker_id);
  }
  return [...seen];
}

async function resolveSpeakers(
  service: ReturnType<typeof createServiceClient>,
  ids: string[],
): Promise<Speaker[]> {
  if (ids.length === 0) return [];
  const { data } = await service
    .from("profiles")
    .select("id, full_name")
    .in("id", ids);
  const byId = new Map((data ?? []).map((p) => [p.id, p.full_name ?? p.id]));
  return ids.map((id) => ({ id, name: byId.get(id) ?? id }));
}

function computeDurationSeconds(lines: JsonlLine[]): number | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const l of lines) {
    if (l.start_time) {
      const t = Date.parse(l.start_time);
      if (!Number.isNaN(t) && t < first) first = t;
    }
    if (l.stop_time) {
      const t = Date.parse(l.stop_time);
      if (!Number.isNaN(t) && t > last) last = t;
    }
  }
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) {
    return null;
  }
  return Math.round((last - first) / 1000);
}

function renderTranscriptForLLM(
  lines: JsonlLine[],
  speakers: Speaker[],
): string {
  const nameById = new Map(speakers.map((s) => [s.id, s.name]));
  const out: string[] = [];
  for (const l of lines) {
    if (!l.text) continue;
    const name = l.speaker_id ? nameById.get(l.speaker_id) ?? l.speaker_id : "Unknown";
    out.push(`${name}: ${l.text}`);
  }
  return out.join("\n");
}

async function createTranscriptDocument(args: {
  service: ReturnType<typeof createServiceClient>;
  meeting: MeetingMeta;
  summary: z.infer<typeof SummarySchema>;
  rendered: string;
  speakers: Speaker[];
}): Promise<string | null> {
  const { service, meeting, summary, speakers } = args;
  const speakerLine =
    speakers.length > 0
      ? `**Participants:** ${speakers.map((s) => s.name).join(", ")}\n\n`
      : "";
  const actionBlock =
    summary.action_items.length > 0
      ? `## Action items\n${summary.action_items
          .map(
            (a) =>
              `- [ ] ${a.text}${a.owner ? ` _(${a.owner})_` : ""}`,
          )
          .join("\n")}\n\n`
      : "";
  const decisionsBlock =
    summary.decisions.length > 0
      ? `## Decisions\n${summary.decisions.map((d) => `- ${d}`).join("\n")}\n\n`
      : "";

  const body =
    `${speakerLine}${summary.summary_md}\n\n${actionBlock}${decisionsBlock}` +
    `## Full transcript\n\n\`\`\`\n${args.rendered}\n\`\`\``;

  // The Liveblocks Yjs doc is created on first connect; we don't pre-seed it
  // from here (would need `liveblocks.sendYjsBinaryUpdate` with a constructed
  // ProseMirror state — overkill for what's mostly a transcript pointer).
  // Instead we write the full summary + transcript into `body_text` so it
  // shows on docs-home cards and is searchable via `body_fts`. When someone
  // opens the doc, the editor starts a fresh Yjs room — they can paste from
  // the snippet if they want the formatted version in-document.
  const { data: doc, error } = await service
    .from("documents")
    .insert({
      property_id: meeting.propertyId,
      title: meeting.title,
      created_by: meeting.hostId,
      last_edited_by: meeting.hostId,
      body_text: body,
    })
    .select("id")
    .single();

  if (error || !doc) {
    console.error("createTranscriptDocument insert failed", error);
    return null;
  }
  return doc.id as string;
}

async function postSummaryToChannel(args: {
  meeting: MeetingMeta;
  summary: z.infer<typeof SummarySchema>;
  speakers: Speaker[];
  durationSeconds: number | null;
}): Promise<string | null> {
  if (!args.meeting.channelId) return null;

  const service = createServiceClient();
  const { data: channel } = await service
    .from("chat_channels")
    .select("stream_channel_id, stream_channel_type")
    .eq("id", args.meeting.channelId)
    .maybeSingle();

  if (!channel) return null;

  const stream = getStreamServer();
  const chan = stream.channel(
    channel.stream_channel_type ?? "team",
    channel.stream_channel_id,
  );

  const duration = args.durationSeconds
    ? ` (${formatDuration(args.durationSeconds)})`
    : "";

  const actionBlock =
    args.summary.action_items.length > 0
      ? `\n\n**Action items**\n${args.summary.action_items
          .map(
            (a) =>
              `- ${a.text}${a.owner ? ` — ${a.owner}` : ""}`,
          )
          .join("\n")}`
      : "";

  // Deep link back to the meeting detail page. Stream's default markdown
  // renderer turns `[label](path)` into an anchor; a relative path stays on
  // the same origin so it works in dev and prod without an APP_URL env var.
  const notesLink = `\n\n[📑 Open full notes](/p/${args.meeting.propertyId}/meetings/${args.meeting.id})`;

  const text =
    `📝 **Meeting summary: ${args.meeting.title}**${duration}\n\n` +
    args.summary.summary_md +
    actionBlock +
    notesLink;

  try {
    const sent = await chan.sendMessage(
      {
        text,
        // Custom fields so the chat UI can render a "Meeting summary" card.
        meeting_id: args.meeting.id,
        meeting_call_id: args.meeting.streamCallId,
        is_meeting_summary: true,
      } as Record<string, unknown>,
      // Skip push notifications — these are background-generated and
      // shouldn't ring everyone's phone.
      { skip_push: true },
    );
    return sent.message?.id ?? null;
  } catch (e) {
    console.error("postSummaryToChannel sendMessage failed", e);
    return null;
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
