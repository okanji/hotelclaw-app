import "server-only";
/**
 * `render_ui` — lets a chat-surface bot attach rich UI (tables, cards,
 * stats) to its reply instead of emitting markdown tables that Stream
 * can't render.
 *
 * The tool doesn't post anything itself: it validates the spec against
 * the chat-UI catalog and hands it to the caller through `sink`. The
 * caller (channel bot's `generateAndPostReply`) attaches the collected
 * spec to the final Stream message as `{ type: "ai_ui", spec }`, which
 * `SlackAttachment` renders client-side.
 *
 * Catalog + deep-link resolution live in `@hotelclaw/chat-ui` (shared
 * with the eve channel bot's render_ui — apps/agent
 * agent/tools/channel-render-ui.ts); this file supplies the web-side DB
 * lookup and the AI-SDK tool wrapper.
 *
 * Invalid specs return `{ ok: false, error }` so the model can repair
 * and retry within its tool-step budget.
 */
import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CHAT_UI_LINK_TABLES,
  CHAT_UI_TOOL_DESCRIPTION,
  resolveChatUiLinkRefs,
  validateChatUiSpec,
  type ChatUiLinkKind,
  type ChatUiSpec,
  type RawChatUiElement,
} from "@hotelclaw/chat-ui";

export type RenderUiSink = { spec: ChatUiSpec | null };

async function lookupPropertyIds(
  propertyId: string,
  kind: ChatUiLinkKind,
  ids: string[],
): Promise<Set<string>> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from(CHAT_UI_LINK_TABLES[kind])
    .select("id")
    .eq("property_id", propertyId)
    .in("id", ids);
  if (error) {
    console.error("[render-ui] link validation query failed", {
      kind,
      error: error.message,
    });
    return new Set();
  }
  // Dynamic table name defeats supabase's generated row types.
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

export function buildRenderUiTool(propertyId: string, sink: RenderUiSink) {
  return {
    render_ui: tool({
      description: CHAT_UI_TOOL_DESCRIPTION,
      inputSchema: z.object({
        spec: z.object({
          root: z.string().describe("Key of the root element."),
          elements: z.record(
            z.string(),
            z.object({
              type: z.string(),
              props: z.record(z.string(), z.unknown()).optional(),
              children: z.array(z.string()).optional(),
            }),
          ),
        }),
      }),
      execute: async ({ spec }) => {
        try {
          await resolveChatUiLinkRefs(
            spec.elements as Record<string, RawChatUiElement>,
            propertyId,
            (kind, ids) => lookupPropertyIds(propertyId, kind, ids),
          );
        } catch (err) {
          console.error("[render-ui] link resolution failed", err);
        }
        const result = validateChatUiSpec(spec);
        if (!result.ok) return { ok: false, error: result.error };
        sink.spec = result.spec;
        return {
          ok: true,
          note: "UI attached — it renders beneath your reply. Keep your text to a one-line lead-in and do not repeat the data.",
        };
      },
    }),
  };
}
