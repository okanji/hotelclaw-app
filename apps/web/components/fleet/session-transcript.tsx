"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { ChatMarkdown } from "@/components/chatbots/chat-markdown";
import { ToolTrace } from "@/components/ai/tool-trace";
import {
  createTranscriptReducer,
  type TranscriptItem,
} from "@/lib/fleet/transcript";
import type { FleetSessionRow } from "@/lib/query/fleet-queries";
import { SESSION_STATUS_UI } from "@/lib/fleet/status-colors";

/**
 * Read-only session transcript. Consumes the tenancy-gated proxy route
 * (never /eve/v1 directly) — the eve stream replays from index 0, so the
 * whole history renders from the event log; reading stops once the replay
 * goes quiet (deadline-raced reads; the stream itself never closes).
 *
 * Tool calls render through the shared ToolTrace (mono variant — same as
 * agent-chat) so every transcript surface reads identically. input.requested
 * events (approval parks) are recorded against their position in the item
 * list and rendered as quiet amber marker rows.
 */
export function SessionTranscriptSheet({
  propertyId,
  session,
  onClose,
}: {
  propertyId: string;
  session: FleetSessionRow | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  // Item-list lengths at the moment each approval park replayed — a park
  // recorded at length L happened right after items[L - 1].
  const [parks, setParks] = useState<number[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const abortRef = useRef<AbortController | null>(null);

  const eveSessionId = session?.eve_session_id ?? null;

  useEffect(() => {
    if (!eveSessionId) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setItems([]);
    setParks([]);
    setState("loading");

    (async () => {
      const response = await fetch(
        `/api/properties/${propertyId}/fleet/sessions/${encodeURIComponent(eveSessionId)}/stream`,
        { signal: controller.signal },
      ).catch(() => null);
      if (!response?.ok || !response.body) {
        if (!controller.signal.aborted) setState("error");
        return;
      }
      const parkMarks: number[] = [];
      const reducer = createTranscriptReducer({
        onInputRequested: () => {
          parkMarks.push(reducer.items.length);
        },
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Replay ends when the stream goes quiet — race each read against a
      // short idle window instead of blocking forever on the open stream.
      try {
        for (;;) {
          const chunk = await Promise.race([
            reader.read(),
            new Promise<{ done: true; value?: undefined }>((resolve) =>
              setTimeout(() => resolve({ done: true }), 2500),
            ),
          ]);
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              reducer.handle(JSON.parse(line));
            } catch {
              // Partial line.
            }
          }
          setItems([...reducer.items]);
          setParks([...parkMarks]);
          setState("ready");
        }
      } catch {
        // Abort on close — keep whatever rendered.
      } finally {
        reader.cancel().catch(() => {});
        setState((prev) => (prev === "loading" ? "ready" : prev));
      }
    })();

    return () => controller.abort();
  }, [propertyId, eveSessionId]);

  const status = session ? SESSION_STATUS_UI[session.status] : null;
  const isWorkflow = session?.channel_id.startsWith("workflow:") ?? false;

  return (
    <Sheet open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <span className="truncate">
              {session?.bot?.display_name ?? "Session"}
            </span>
            {status && session?.status !== "idle" ? (
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            ) : null}
          </SheetTitle>
          <SheetDescription className="truncate font-mono text-xs">
            {isWorkflow ? session?.eve_session_id : session?.channel_id}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {state === "error" ? (
            <p className="rounded-card bg-destructive/10 p-3 text-sm text-destructive">
              Couldn&apos;t read this session&apos;s event log — the agent
              runtime may be unreachable.
            </p>
          ) : items.length === 0 ? (
            <p className="animate-pulse py-4 text-sm text-muted-foreground">
              {state === "loading" ? "Reading the event log…" : "No events recorded."}
            </p>
          ) : (
            <ul role="list" className="flex flex-col gap-4">
              {parks.includes(0) ? (
                <li>
                  <ParkMarker />
                </li>
              ) : null}
              {items.map((item, index) => (
                <Fragment key={index}>
                  <li>
                    {item.kind === "user" ? (
                      <div className="ml-8 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                        {item.text}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <ToolTrace calls={item.toolCalls} mono />
                        {item.text ? (
                          <div className="text-sm">
                            <ChatMarkdown>{item.text}</ChatMarkdown>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </li>
                  {parks.includes(index + 1) ? (
                    <li>
                      <ParkMarker />
                    </li>
                  ) : null}
                </Fragment>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Quiet amber row marking where the session parked on input.requested —
 * an approval boundary in the event log, past or still pending. */
function ParkMarker() {
  return (
    <div className="flex items-center gap-2 rounded-md bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
      <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
      Parked for approval here
    </div>
  );
}
