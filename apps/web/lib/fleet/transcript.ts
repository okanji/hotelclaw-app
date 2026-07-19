/**
 * Pure NDJSON→transcript reducer for eve session streams. Shared by the
 * interactive AgentChat (custom agents + pod-bot test chat) and the
 * read-only Fleet session viewer, so every surface renders a session's
 * event log identically. Streams replay from index 0 on each attach — the
 * reducer rebuilds the whole transcript every time.
 */

export type ToolCall = {
  callId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  done: boolean;
};

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; toolCalls: ToolCall[] };

export type EveStreamEvent = {
  type: string;
  data: Record<string, unknown>;
};

export function createTranscriptReducer(callbacks: {
  /** session.waiting — the park boundary; carries the live continuation token. */
  onWaiting?: (continuationToken: string | null) => void;
  /** session.failed */
  onFailed?: () => void;
  /** input.requested — an approval park (requests[].action payloads). */
  onInputRequested?: (data: Record<string, unknown>) => void;
} = {}) {
  const items: TranscriptItem[] = [];
  let currentAssistant: Extract<TranscriptItem, { kind: "assistant" }> | null =
    null;

  const ensureAssistant = () => {
    if (!currentAssistant) {
      currentAssistant = { kind: "assistant", text: "", toolCalls: [] };
      items.push(currentAssistant);
    }
    return currentAssistant;
  };

  const handle = (event: EveStreamEvent) => {
    const data = event.data ?? {};
    switch (event.type) {
      case "message.received": {
        currentAssistant = null;
        items.push({ kind: "user", text: String(data.message ?? "") });
        break;
      }
      case "message.appended":
      case "message.completed": {
        const entry = ensureAssistant();
        entry.text = String(data.messageSoFar ?? data.message ?? entry.text);
        // A completed pre-tool message stays; the next append after tool
        // results continues in the same bubble for a compact transcript.
        break;
      }
      case "actions.requested": {
        const entry = ensureAssistant();
        const actions = Array.isArray(data.actions) ? data.actions : [];
        for (const action of actions as {
          callId?: string;
          kind?: string;
          toolName?: string;
          input?: unknown;
        }[]) {
          if (action.kind === "tool-call") {
            entry.toolCalls.push({
              callId: String(action.callId ?? Math.random()),
              toolName: String(action.toolName ?? "tool"),
              input: action.input,
              done: false,
            });
          }
        }
        break;
      }
      case "action.result": {
        const result = data.result as
          | { callId?: string; output?: unknown }
          | undefined;
        if (!result?.callId) break;
        for (const item of items) {
          if (item.kind !== "assistant") continue;
          const call = item.toolCalls.find((c) => c.callId === result.callId);
          if (call) {
            call.done = true;
            call.output = result.output;
          }
        }
        break;
      }
      case "input.requested": {
        callbacks.onInputRequested?.(data);
        break;
      }
      case "session.waiting": {
        callbacks.onWaiting?.(
          typeof data.continuationToken === "string"
            ? data.continuationToken
            : null,
        );
        break;
      }
      case "session.failed": {
        callbacks.onFailed?.();
        break;
      }
    }
  };

  return { items, handle };
}
