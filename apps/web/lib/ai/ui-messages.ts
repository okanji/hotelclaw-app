import "server-only";
import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai";
import { z } from "zod";

/**
 * Request-body parsing for the streaming panel bots (task, insights).
 *
 * `useChat` posts AI SDK `UIMessage[]` (role + parts). The mobile app and
 * older callers post the legacy `{role, content}` turns. Both are accepted:
 * legacy turns are lifted into UI messages, and everything goes through
 * `convertToModelMessages` so tool parts from earlier assistant turns reach
 * the model as proper tool-call/result history rather than being dropped.
 */
const LegacyTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(8000),
});

const UiMessageLoose = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).max(200),
});

export const PanelChatBody = z.object({
  messages: z
    .array(z.union([UiMessageLoose, LegacyTurn]))
    .min(1)
    .max(40),
});

export async function panelMessagesToModel(
  messages: z.infer<typeof PanelChatBody>["messages"],
): Promise<ModelMessage[]> {
  const ui: UIMessage[] = messages
    .filter((m) => m.role !== "system")
    .map((m, index) =>
      "parts" in m
        ? ({ id: m.id ?? `m-${index}`, role: m.role, parts: m.parts } as UIMessage)
        : ({
            id: `m-${index}`,
            role: m.role,
            parts: [{ type: "text", text: m.content }],
          } as UIMessage),
    );
  // Unknown/incomplete tool parts from a client-side abort must not poison
  // the history — `ignoreIncompleteToolCalls` drops them instead of throwing.
  return convertToModelMessages(ui, { ignoreIncompleteToolCalls: true });
}
