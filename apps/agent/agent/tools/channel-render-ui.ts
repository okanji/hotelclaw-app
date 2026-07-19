import { defineDynamic, defineTool } from "eve/tools";
import { z } from "zod";
import {
  CHAT_UI_LINK_TABLES,
  CHAT_UI_TOOL_DESCRIPTION,
  resolveChatUiLinkRefs,
  validateChatUiSpec,
  type RawChatUiElement,
} from "@hotelclaw/chat-ui";
import { CHANNEL_BOT_SLUG } from "../lib/agent-config";
import { tenantCallerOrNull } from "../lib/tenant";
import { serviceClient } from "../lib/supabase";

// `render_ui` for the eve channel bot — same catalog, validation, and
// deep-link discipline as the web tool (@hotelclaw/chat-ui is the single
// source of truth). Unlike the web tool there is no sink: the validated
// spec is RETURNED in the tool result, and the web glue
// (lib/stream/channel-bot-eve.ts) collects it from the session stream's
// action.result events and posts it as the `ai_ui` Stream attachment.
//
// eve constraint: execute INLINE (replay reconstruction).

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const caller = tenantCallerOrNull(
        ctx as unknown as Parameters<typeof tenantCallerOrNull>[0],
      );
      const botSlug = ctx.session.auth.current?.attributes?.botSlug;
      const agentId = ctx.session.auth.current?.attributes?.agentId;
      if (!caller || typeof agentId === "string" || botSlug !== CHANNEL_BOT_SLUG) {
        return null;
      }
      const propertyId = caller.propertyId;

      return {
        render_ui: defineTool({
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
          async execute({ spec }) {
            try {
              await resolveChatUiLinkRefs(
                spec.elements as Record<string, RawChatUiElement>,
                propertyId,
                async (kind, ids) => {
                  const { data, error } = await serviceClient()
                    .from(CHAT_UI_LINK_TABLES[kind])
                    .select("id")
                    .eq("property_id", propertyId)
                    .in("id", ids);
                  if (error) return new Set<string>();
                  return new Set(
                    ((data ?? []) as { id: string }[]).map((r) => r.id),
                  );
                },
              );
            } catch {
              // fail-soft: links drop, spec still renders
            }
            const result = validateChatUiSpec(spec);
            if (!result.ok) return { ok: false, error: result.error };
            return {
              ok: true,
              ai_ui_spec: result.spec,
              note: "UI attached — it renders beneath your reply. Keep your text to a one-line lead-in and do not repeat the data.",
            };
          },
        }),
      };
    },
  },
});
