import { NextResponse, type NextRequest, after } from "next/server";
import { getStreamVideoServer } from "@/lib/stream/video-server";
import { createServiceClient } from "@/lib/supabase/server";
import { processTranscriptReady } from "@/lib/meetings/summarize";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";

/**
 * Stream Video webhook → meeting lifecycle.
 *
 * Subscribed events (set via the Stream dashboard or `client.video.updateApp`):
 *   • call.session_started      — mark meeting active (best-effort)
 *   • call.session_ended        — stamp ended_at if not already set
 *   • call.transcription_ready  — fetch JSONL, persist transcript row,
 *                                 trigger summarization
 *
 * Verification: Stream Video signs with the same HMAC scheme as Chat but
 * the Node SDK exposes the helper as `verifyAndParseWebhook` (throws on
 * mismatch, returns parsed body). Equivalent to the chat webhook's
 * `verifyWebhook` boolean check — just with parse bundled in.
 */

type CallTranscriptionReady = {
  type: "call.transcription_ready";
  call_cid: string; // `<call_type>:<call_id>`
  created_at: string;
  egress_id?: string;
  call_transcription: {
    filename: string;
    url: string; // signed JSONL URL — short-lived, we mirror inline
    start_time?: string;
    end_time?: string;
    session_id?: string;
  };
};

type CallSessionEnded = {
  type: "call.session_ended";
  call_cid: string;
  created_at: string;
};

type WebhookBody =
  | CallTranscriptionReady
  | CallSessionEnded
  | { type: string; call_cid?: string };

function extractCallId(cid: string | undefined): string | null {
  if (!cid) return null;
  const idx = cid.indexOf(":");
  return idx >= 0 ? cid.slice(idx + 1) : cid;
}

export async function POST(request: NextRequest) {
  const stream = getStreamVideoServer();

  // Stream signs the raw request body. Read as a string before any parsing.
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing signature" }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = stream.verifyAndParseWebhook(rawBody, signature) as WebhookBody;
  } catch (err) {
    console.error("[stream-webhook-call] verifyAndParseWebhook failed", err);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // Always 200 on unrelated event types so Stream doesn't retry.
  if (
    body.type !== "call.transcription_ready" &&
    body.type !== "call.session_ended"
  ) {
    return NextResponse.json({ ok: true, skipped: body.type });
  }

  const callId = extractCallId(body.call_cid);
  if (!callId) {
    return NextResponse.json({ ok: true, skipped: "no-call-id" });
  }

  const service = createServiceClient();
  const { data: meeting } = await service
    .from("meetings")
    .select("id, property_id, channel_id, host_id, ended_at, title")
    .eq("stream_call_id", callId)
    .maybeSingle();

  if (!meeting) {
    // The webhook fires for every call on the app, including non-meeting
    // huddles. Acknowledge and drop.
    return NextResponse.json({ ok: true, skipped: "not-a-meeting" });
  }

  if (body.type === "call.session_ended") {
    if (!meeting.ended_at) {
      await service
        .from("meetings")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", meeting.id)
        .is("ended_at", null);
    }
    after(async () => {
      await emitWorkflowEvent({
        propertyId: meeting.property_id,
        source: "stream.call",
        eventType: "meeting.ended",
        entityId: meeting.id,
        entityKind: "meeting",
        payload: { meeting: { id: meeting.id, title: meeting.title, channel_id: meeting.channel_id } },
      });
    });
    return NextResponse.json({ ok: true, type: body.type });
  }

  // call.transcription_ready
  const ready = body as CallTranscriptionReady;
  try {
    await processTranscriptReady({
      meeting: {
        id: meeting.id,
        propertyId: meeting.property_id,
        channelId: meeting.channel_id,
        hostId: meeting.host_id,
        title: meeting.title,
        streamCallId: callId,
      },
      transcript: {
        url: ready.call_transcription.url,
        filename: ready.call_transcription.filename,
        startTime: ready.call_transcription.start_time,
        endTime: ready.call_transcription.end_time,
        sessionId: ready.call_transcription.session_id,
      },
    });
  } catch (e) {
    console.error("processTranscriptReady failed", e);
    // 500 so Stream retries — transcript URLs are short-lived, but retries
    // happen quickly enough to usually succeed before expiry.
    return NextResponse.json(
      { error: "processing failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, type: body.type });
}
