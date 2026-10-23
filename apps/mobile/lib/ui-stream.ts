import { fetch as expoFetch } from "expo/fetch";
import { apiBaseUrl } from "../chatConfig";
import { ApiError } from "./api";
import { supabase } from "./supabase";

/**
 * Reader for the AI SDK UI message stream (SSE of JSON parts) that the
 * panel bots emit — the task assistant and "Ask the numbers". Web consumes
 * the same stream with `useChat`; on the phone a 60-line reader keeps the
 * bundle free of the AI SDK. Only the parts the panels render are tracked:
 * text deltas, reasoning, and tool state.
 */
export type UiToolPart = {
  toolCallId: string;
  toolName: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type UiAssistantMessage = {
  id: string;
  role: "assistant";
  text: string;
  reasoning: string;
  tools: UiToolPart[];
  error: string | null;
};

export type UiUserMessage = { id: string; role: "user"; text: string };
export type UiPanelMessage = UiUserMessage | UiAssistantMessage;

/** Body shape the routes accept (legacy turns — lib/ai/ui-messages.ts). */
export function toLegacyTurns(messages: UiPanelMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.text }));
}

export async function streamPanelBot(
  path: string,
  body: Record<string, unknown>,
  onUpdate: (message: UiAssistantMessage) => void,
  signal?: AbortSignal,
): Promise<UiAssistantMessage> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new ApiError(401, "No Supabase session");

  const res = await expoFetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  const message: UiAssistantMessage = {
    id: `a-${Date.now()}`,
    role: "assistant",
    text: "",
    reasoning: "",
    tools: [],
    error: null,
  };
  if (!res.ok || !res.body) {
    let detail = `Request failed (${res.status})`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { error?: string };
      detail = parsed.error ?? text ?? detail;
    } catch {
      // keep status message
    }
    throw new ApiError(res.status, detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emit = () => onUpdate({ ...message, tools: [...message.tools] });
  const tool = (id: string) => message.tools.find((t) => t.toolCallId === id);

  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let part: Record<string, unknown>;
      try {
        part = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      switch (part.type) {
        case "text-delta":
          message.text += String(part.delta ?? "");
          break;
        case "reasoning-delta":
          message.reasoning += String(part.delta ?? "");
          break;
        case "tool-input-start":
          message.tools.push({
            toolCallId: String(part.toolCallId),
            toolName: String(part.toolName ?? "tool"),
            state: "input-streaming",
          });
          break;
        case "tool-input-available": {
          const existing = tool(String(part.toolCallId));
          if (existing) {
            existing.state = "input-available";
            existing.input = part.input;
          } else {
            message.tools.push({
              toolCallId: String(part.toolCallId),
              toolName: String(part.toolName ?? "tool"),
              state: "input-available",
              input: part.input,
            });
          }
          break;
        }
        case "tool-output-available": {
          const existing = tool(String(part.toolCallId));
          if (existing) {
            existing.state = "output-available";
            existing.output = part.output;
          }
          break;
        }
        case "tool-output-error": {
          const existing = tool(String(part.toolCallId));
          if (existing) {
            existing.state = "output-error";
            existing.errorText = String(part.errorText ?? "error");
          }
          break;
        }
        case "error":
          message.error = String(part.errorText ?? "The assistant hit an error.");
          break;
        default:
          break;
      }
      emit();
    }
  }
  emit();
  return message;
}
