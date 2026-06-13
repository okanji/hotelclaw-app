import "server-only";
/**
 * In-channel deployment: a custom chatbot installed into a staff Stream
 * channel. The channel-bot pipeline (lib/stream/ai-reply.ts) stays the
 * owner of triggers/locks/coalescing — when a deployment exists for the
 * channel, it swaps in this persona and merges these tools. No deployment
 * → null → the default channel bot is completely untouched.
 */
import type { ToolSet } from "ai";
import { createServiceClient } from "@/lib/supabase/server";
import { buildChannelDeploymentTools } from "@/lib/ai/guest-bot/tools/registry";
import { parseChatbotConfig } from "@/lib/chatbots/schema";

export type ChannelDeployment = {
  chatbotId: string;
  chatbotName: string;
  persona: string;
  tools: ToolSet;
};

export async function resolveChannelDeployment(
  streamChannelId: string,
): Promise<ChannelDeployment | null> {
  try {
    const supabase = createServiceClient();
    const { data: deployment } = await supabase
      .from("chatbot_channel_deployments")
      .select("chatbot_id")
      .eq("stream_channel_id", streamChannelId)
      .maybeSingle();
    if (!deployment) return null;

    const [{ data: bot }, { data: customActions }] = await Promise.all([
      supabase
        .from("chatbots")
        .select("id, name, config, archived_at")
        .eq("id", deployment.chatbot_id)
        .maybeSingle(),
      supabase
        .from("chatbot_custom_actions")
        .select("*")
        .eq("chatbot_id", deployment.chatbot_id)
        .eq("enabled", true),
    ]);
    if (!bot || bot.archived_at) return null;

    const config = parseChatbotConfig(bot.config);
    const persona = [
      config.instructions || `You are "${bot.name}", a specialist assistant.`,
      "",
      `# Where you are right now`,
      `You are deployed in a STAFF team channel (Slack-style chat), talking to staff members of this property — not guests. Help the team using your knowledge base and integrations; speak collegially, not in your guest-facing voice. You also have the workspace tools every channel assistant gets (tasks, docs, calendar).`,
    ].join("\n");

    return {
      chatbotId: bot.id,
      chatbotName: bot.name,
      persona,
      tools: buildChannelDeploymentTools(bot.id, bot.name, customActions ?? []),
    };
  } catch (err) {
    // Fail-soft: a broken deployment must never silence the channel bot.
    console.error("[channel-deployment] resolve failed", err);
    return null;
  }
}
