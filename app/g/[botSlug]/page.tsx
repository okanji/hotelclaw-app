import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { parseChatbotConfig } from "@/lib/chatbots/schema";
import { GuestChatPage } from "@/components/guest-chat/guest-chat-page";

/**
 * Public guest chat page — /g/<slug>, allowlisted in the auth middleware.
 * Server component: the bot is resolved by its unguessable slug with the
 * service client; only guest-visible fields cross to the client (no
 * property_id, no instructions, no action config). Drafts and unknown
 * slugs 404; paused bots render an "unavailable" state.
 */
export default async function GuestChat({
  params,
  searchParams,
}: {
  params: Promise<{ botSlug: string }>;
  searchParams: Promise<{ room?: string; embed?: string }>;
}) {
  const { botSlug } = await params;
  const { room, embed } = await searchParams;
  if (!/^[a-f0-9]{16,64}$/.test(botSlug)) notFound();

  const supabase = createServiceClient();
  const { data: bot } = await supabase
    .from("chatbots")
    .select("id, property_id, status, config")
    .eq("public_slug", botSlug)
    .is("archived_at", null)
    .maybeSingle();
  if (!bot || bot.status === "draft") notFound();

  const config = parseChatbotConfig(bot.config);
  const { data: property } = await supabase
    .from("properties")
    .select("name")
    .eq("id", bot.property_id)
    .maybeSingle();

  return (
    <GuestChatPage
      slug={botSlug}
      room={room ?? null}
      paused={bot.status === "paused"}
      embed={embed === "1"}
      meta={{
        displayName: config.appearance.displayName,
        avatarEmoji: config.appearance.avatarEmoji,
        brandColor: config.appearance.brandColor ?? null,
        greeting: config.greeting,
        suggestedQuestions: config.suggestedQuestions.filter((q) => q.trim()),
        propertyName: property?.name ?? "this property",
      }}
    />
  );
}
