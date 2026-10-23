"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { EveConversation } from "@/components/ai/eve-conversation";
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
 * Rendering is the shared `EveConversation` in read-only mode (mono tool
 * labels — same as agent-chat), so every transcript surface reads
 * identically; approval / question parks render as settled request cards
 * straight from the reducer's `requests`.
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
  const eveSessionId = session?.eve_session_id ?? null;
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

        <div className="flex min-h-0 flex-1 flex-col pb-2">
          {eveSessionId ? (
            // Keyed on the session so switching rows remounts with fresh
            // state instead of resetting state inside an effect.
            <TranscriptBody key={eveSessionId} propertyId={propertyId} eveSessionId={eveSessionId} />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TranscriptBody({
  propertyId,
  eveSessionId,
}: {
  propertyId: string;
  eveSessionId: string;
}) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    (async () => {
      const response = await fetch(
        `/api/properties/${propertyId}/fleet/sessions/${encodeURIComponent(eveSessionId)}/stream`,
        { signal: controller.signal },
      ).catch(() => null);
      if (!response?.ok || !response.body) {
        if (!controller.signal.aborted) setState("error");
        return;
      }
      const reducer = createTranscriptReducer();
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

  if (state === "error") {
    return (
      <p className="mx-4 rounded-card bg-destructive/10 p-3 text-sm text-destructive">
        Couldn&apos;t read this session&apos;s event log — the agent runtime may be
        unreachable.
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="animate-pulse px-4 py-4 text-sm text-muted-foreground">
        {state === "loading" ? "Reading the event log…" : "No events recorded."}
      </p>
    );
  }
  return <EveConversation items={items} scale="compact" mono showReasoning={false} />;
}
