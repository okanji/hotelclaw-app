/**
 * Pure NDJSON→transcript reducer for eve session streams. Shared by the
 * interactive Assistant and Agent chats (through `useEveSession`) and the
 * read-only Fleet session viewer, so every surface renders a session's event
 * log identically. Streams replay from index 0 on each attach — the reducer
 * rebuilds the whole transcript every time.
 *
 * eve 0.83 stream contract (docs/concepts/sessions-runs-and-streaming):
 *   - `message.appended` / `reasoning.appended` carry DELTAS
 *     (`messageDelta` / `reasoningDelta`, stream v25+). Older recorded
 *     sessions may still carry cumulative `messageSoFar`; both are handled.
 *   - `message.completed` can fire several times in a turn (narration before
 *     a tool call, then the final reply). Each completed block is KEPT, in
 *     order — last-wins silently dropped half of a two-part answer once.
 *   - a question/approval holds the turn open: `input.requested` →
 *     `turn.waiting {on:"input"}`; `input.resolved` ends it. `session.waiting`
 *     only when the turn truly ends.
 *   - subagent calls are tasks: `task.started` / `task.settled`.
 */

export type ToolCall = {
  callId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  done: boolean;
  /** Set when the tool returned an error result. */
  error?: string;
};

export type InputRequestOption = {
  id: string;
  label: string;
  description: string | null;
};

/** A question, approval, or session-limit prompt the turn is parked on. */
export type InputRequest = {
  requestId: string;
  kind: "question" | "tool-approval" | "session-limit" | "unknown";
  prompt: string;
  display: "confirmation" | "select" | "text" | null;
  allowFreeform: boolean;
  options: InputRequestOption[];
  /** For approvals: the gated tool and its arguments. */
  action: { toolName: string; input: unknown; callId: string | null } | null;
  /** Filled by `input.resolved`. */
  outcome: string | null;
  /** The option id or text the person answered with, when known. */
  answer: string | null;
};

export type TaskRun = {
  taskId: string;
  name: string;
  kind: "agent" | "tool";
  status: "working" | "completed" | "failed" | "cancelled";
  output?: unknown;
  error?: string;
};

export type AssistantItem = {
  kind: "assistant";
  /** Every completed (and the in-progress) assistant text block, in order. */
  blocks: string[];
  /** Convenience: the blocks joined — what callers rendered before. */
  text: string;
  reasoning: string[];
  toolCalls: ToolCall[];
  requests: InputRequest[];
  tasks: TaskRun[];
  /** Non-terminal turn failure attached to this turn, if any. */
  failure: { code: string; message: string } | null;
  /** Whether the model is still producing text for the current block. */
  streaming: boolean;
};

export type TranscriptItem =
  | { kind: "user"; text: string }
  | AssistantItem;

export type EveStreamEvent = {
  type: string;
  data: Record<string, unknown>;
};

export function createTranscriptReducer(callbacks: {
  /** session.waiting, or turn.waiting on human input — the park boundary. */
  onWaiting?: (continuationToken: string | null) => void;
  /** session.failed */
  onFailed?: () => void;
  /** input.requested — raw event data (requests[] with action payloads). */
  onInputRequested?: (data: Record<string, unknown>) => void;
  /** input.resolved — raw event data (resolutions[]). */
  onInputResolved?: (data: Record<string, unknown>) => void;
} = {}) {
  const items: TranscriptItem[] = [];
  let currentAssistant: AssistantItem | null = null;
  // The text/reasoning block currently being streamed into (null = none open).
  let openBlock = false;
  let openReasoning = false;

  const ensureAssistant = () => {
    if (!currentAssistant) {
      currentAssistant = {
        kind: "assistant",
        blocks: [],
        text: "",
        reasoning: [],
        toolCalls: [],
        requests: [],
        tasks: [],
        failure: null,
        streaming: false,
      };
      items.push(currentAssistant);
    }
    return currentAssistant;
  };

  const syncText = (entry: AssistantItem) => {
    entry.text = entry.blocks.filter((b) => b.trim()).join("\n\n");
  };

  const findCall = (callId: string): ToolCall | undefined => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.kind !== "assistant") continue;
      const call = item.toolCalls.find((c) => c.callId === callId);
      if (call) return call;
    }
    return undefined;
  };

  const findRequest = (requestId: string): InputRequest | undefined => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.kind !== "assistant") continue;
      const request = item.requests.find((r) => r.requestId === requestId);
      if (request) return request;
    }
    return undefined;
  };

  const handle = (event: EveStreamEvent) => {
    const data = event.data ?? {};
    switch (event.type) {
      case "message.received": {
        currentAssistant = null;
        openBlock = false;
        openReasoning = false;
        items.push({ kind: "user", text: String(data.message ?? "") });
        break;
      }
      case "message.appended": {
        const entry = ensureAssistant();
        if (typeof data.messageSoFar === "string") {
          // Legacy cumulative shape (stream < v25).
          if (!openBlock) {
            entry.blocks.push("");
            openBlock = true;
          }
          entry.blocks[entry.blocks.length - 1] = data.messageSoFar;
        } else {
          const delta =
            typeof data.messageDelta === "string"
              ? data.messageDelta
              : typeof data.message === "string"
                ? data.message
                : "";
          if (!openBlock) {
            entry.blocks.push("");
            openBlock = true;
          }
          entry.blocks[entry.blocks.length - 1] += delta;
        }
        entry.streaming = true;
        syncText(entry);
        break;
      }
      case "message.completed": {
        const entry = ensureAssistant();
        const text = typeof data.message === "string" ? data.message : "";
        if (openBlock) {
          // Authoritative value for the block the deltas were building.
          entry.blocks[entry.blocks.length - 1] = text;
        } else if (text.trim()) {
          entry.blocks.push(text);
        }
        openBlock = false;
        entry.streaming = false;
        syncText(entry);
        break;
      }
      case "reasoning.appended": {
        const entry = ensureAssistant();
        const delta =
          typeof data.reasoningDelta === "string"
            ? data.reasoningDelta
            : typeof data.reasoningSoFar === "string"
              ? data.reasoningSoFar
              : "";
        if (!openReasoning) {
          entry.reasoning.push("");
          openReasoning = true;
        }
        if (typeof data.reasoningSoFar === "string") {
          entry.reasoning[entry.reasoning.length - 1] = delta;
        } else {
          entry.reasoning[entry.reasoning.length - 1] += delta;
        }
        break;
      }
      case "reasoning.completed": {
        const entry = ensureAssistant();
        const text = typeof data.reasoning === "string" ? data.reasoning : "";
        if (openReasoning) entry.reasoning[entry.reasoning.length - 1] = text;
        else if (text.trim()) entry.reasoning.push(text);
        openReasoning = false;
        break;
      }
      case "actions.requested": {
        const entry = ensureAssistant();
        // A tool batch closes the text block the model wrote before it.
        openBlock = false;
        openReasoning = false;
        const actions = Array.isArray(data.actions) ? data.actions : [];
        for (const action of actions as {
          callId?: string;
          kind?: string;
          toolName?: string;
          input?: unknown;
          name?: string;
        }[]) {
          if (action.kind === "tool-call") {
            entry.toolCalls.push({
              callId: String(action.callId ?? Math.random()),
              toolName: String(action.toolName ?? "tool"),
              input: action.input,
              done: false,
            });
          } else if (action.kind === "load-skill") {
            entry.toolCalls.push({
              callId: String(action.callId ?? Math.random()),
              toolName: "load_skill",
              input: { skill: action.name ?? (action.input as { name?: string })?.name },
              done: false,
            });
          }
        }
        break;
      }
      case "action.result": {
        const result = data.result as
          | { callId?: string; output?: unknown; isError?: boolean; kind?: string; name?: string }
          | undefined;
        if (!result?.callId) break;
        const call = findCall(result.callId);
        if (call) {
          call.done = true;
          call.output = result.output;
          if (result.isError) {
            call.error =
              typeof result.output === "string"
                ? result.output
                : JSON.stringify(result.output ?? "error").slice(0, 400);
          }
        }
        break;
      }
      case "task.started": {
        const entry = ensureAssistant();
        const taskId = String(data.taskId ?? "");
        if (!taskId || entry.tasks.some((t) => t.taskId === taskId)) break;
        entry.tasks.push({
          taskId,
          name: String(data.name ?? "task"),
          kind: data.kind === "agent" ? "agent" : "tool",
          status: "working",
        });
        break;
      }
      case "task.settled": {
        const taskId = String(data.taskId ?? "");
        for (let i = items.length - 1; i >= 0; i -= 1) {
          const item = items[i];
          if (item.kind !== "assistant") continue;
          const task = item.tasks.find((t) => t.taskId === taskId);
          if (!task) continue;
          const status = String(data.status ?? "completed");
          task.status =
            status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : "completed";
          task.output = data.output;
          const err = (data.error as { message?: string } | undefined)?.message;
          if (err) task.error = err;
          break;
        }
        break;
      }
      case "input.requested": {
        const entry = ensureAssistant();
        openBlock = false;
        const requests = Array.isArray(data.requests) ? data.requests : [];
        for (const raw of requests as Record<string, unknown>[]) {
          const requestId = typeof raw.requestId === "string" ? raw.requestId : null;
          if (!requestId || entry.requests.some((r) => r.requestId === requestId)) continue;
          const action = (raw.action ?? null) as
            | { toolName?: string; input?: unknown; callId?: string }
            | null;
          const kindRaw = typeof raw.kind === "string" ? raw.kind : null;
          const display = typeof raw.display === "string" ? raw.display : null;
          const kind: InputRequest["kind"] =
            kindRaw === "question" || kindRaw === "tool-approval" || kindRaw === "session-limit"
              ? kindRaw
              : display === "confirmation" && action?.toolName
                ? "tool-approval"
                : "question";
          entry.requests.push({
            requestId,
            kind,
            prompt: typeof raw.prompt === "string" ? raw.prompt : "",
            display:
              display === "confirmation" || display === "select" || display === "text"
                ? display
                : null,
            allowFreeform: raw.allowFreeform === true,
            options: Array.isArray(raw.options)
              ? (raw.options as Record<string, unknown>[])
                  .map((o) => ({
                    id: typeof o.id === "string" ? o.id : "",
                    label: typeof o.label === "string" ? o.label : "",
                    description:
                      typeof o.description === "string" ? o.description : null,
                  }))
                  .filter((o) => o.id && o.label)
              : [],
            action: action?.toolName
              ? {
                  toolName: action.toolName,
                  input: action.input ?? null,
                  callId: typeof action.callId === "string" ? action.callId : null,
                }
              : null,
            outcome: null,
            answer: null,
          });
        }
        callbacks.onInputRequested?.(data);
        break;
      }
      case "input.resolved": {
        const resolutions = Array.isArray(data.resolutions) ? data.resolutions : [];
        for (const raw of resolutions as Record<string, unknown>[]) {
          const requestId = typeof raw.requestId === "string" ? raw.requestId : null;
          if (!requestId) continue;
          const request = findRequest(requestId);
          if (!request) continue;
          request.outcome = typeof raw.outcome === "string" ? raw.outcome : "resolved";
          const response = raw.response as { optionId?: string; text?: string } | undefined;
          request.answer = response?.optionId ?? response?.text ?? null;
        }
        callbacks.onInputResolved?.(data);
        break;
      }
      case "turn.failed": {
        const entry = ensureAssistant();
        entry.failure = {
          code: String(data.code ?? "turn_failed"),
          message: String(data.message ?? ""),
        };
        entry.streaming = false;
        break;
      }
      // eve ≥ 0.70: a question or approval holds the TURN open and emits
      // turn.waiting {on:"input"} instead of session.waiting — for the UI
      // that is the same "your move" boundary (the input request is already
      // in the transcript), so unblock the composer. `on:"tasks"` means the
      // turn is still working on subagents and is NOT a settle point.
      case "turn.waiting": {
        if (data.on === "input") {
          if (currentAssistant) currentAssistant.streaming = false;
          callbacks.onWaiting?.(null);
        }
        break;
      }
      case "turn.completed":
      case "turn.cancelled": {
        if (currentAssistant) currentAssistant.streaming = false;
        openBlock = false;
        openReasoning = false;
        break;
      }
      case "session.waiting": {
        if (currentAssistant) currentAssistant.streaming = false;
        callbacks.onWaiting?.(null);
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

/** Open (unanswered) requests across the whole transcript, newest turn first. */
export function pendingInputRequests(items: TranscriptItem[]): InputRequest[] {
  const open: InputRequest[] = [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.kind !== "assistant") continue;
    for (const r of item.requests) if (!r.outcome) open.push(r);
    if (open.length > 0) break;
  }
  return open;
}

/**
 * Two prefixes are plumbing, never something the person typed, and are
 * stripped before their own message is shown back to them: the `[Now: …]`
 * line the first message of a session carries so the model knows today's
 * date, and the `[turn <uuid>]` nonce the channel path uses for attribution.
 */
const USER_FRAMING_RX = /^(?:\[turn [0-9a-f-]+\]\s*\n+)?(?:\[Now: [^\]]*\]\s*\n+)?/;

export function displayUserText(text: string): string {
  return text.replace(USER_FRAMING_RX, "");
}

/** `render_ui` specs returned in tool results (`ai_ui_spec`) for a turn. */
export function renderedSpecs(calls: ToolCall[]): { callId: string; spec: unknown }[] {
  const found: { callId: string; spec: unknown }[] = [];
  for (const call of calls) {
    if (call.toolName !== "render_ui" || !call.done) continue;
    const output = call.output as { ai_ui_spec?: unknown } | null | undefined;
    if (output && typeof output === "object" && output.ai_ui_spec) {
      found.push({ callId: call.callId, spec: output.ai_ui_spec });
    }
  }
  return found;
}
