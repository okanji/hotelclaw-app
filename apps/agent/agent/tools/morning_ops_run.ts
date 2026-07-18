import { defineTool } from "eve/tools";
import { z } from "zod";
import { StreamChat } from "stream-chat";
import { serviceClient } from "../lib/supabase";

/**
 * Deterministic morning-ops sweep (fleet spec M4.2), called once by the
 * agent/schedules/morning_ops.md task-mode session. The MODEL never
 * computes the numbers — this tool gathers per-property facts and posts
 * the brief; the schedule prompt just triggers it.
 *
 * Guarded to non-tenant callers: schedule sessions run as eve's app
 * principal (no propertyId attribute). A tenant chat session gets a
 * refusal — staff briefs on demand go through the bot's normal tools.
 */
export default defineTool({
  description:
    "Run the morning operations sweep for every active pod property and post each brief to the property's ops channel. Schedule-use only; runs the whole fleet in one call.",
  inputSchema: z.object({
    dry_run: z.boolean().default(false),
  }),
  async execute({ dry_run }, ctx) {
    const auth = ctx.session.auth.current;
    const isSchedule =
      auth?.authenticator === "app" &&
      auth?.principalId === "eve:app" &&
      auth?.principalType === "runtime";
    const isTenantless = !auth?.attributes?.propertyId;
    if (!isSchedule && !isTenantless) {
      return { error: "morning_ops_run is schedule-only." };
    }

    const supabase = serviceClient();
    const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
    const secret = process.env.STREAM_API_SECRET;
    if (!apiKey || !secret) return { error: "Stream not configured." };
    const server = StreamChat.getInstance(apiKey, secret, { timeout: 15000 });

    const { data: activeClients } = await supabase
      .from("clients").select("id").eq("status", "active");
    const clientIds = (activeClients ?? []).map((c) => c.id);
    if (clientIds.length === 0) return { posted: [], note: "no active clients" };

    const { data: properties } = await supabase
      .from("properties")
      .select("id, name, slug, timezone, client_id")
      .in("client_id", clientIds)
      .is("archived_at", null);

    const posted: Array<Record<string, unknown>> = [];
    for (const property of properties ?? []) {
      // "Today" in the PROPERTY's timezone — the brief must be
      // timezone-right (Africa/Nairobi default), not server-UTC.
      const now = new Date();
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: property.timezone || "Africa/Nairobi",
        year: "numeric", month: "2-digit", day: "2-digit",
      });
      const today = fmt.format(now);
      const dayStart = new Date(`${today}T00:00:00+03:00`).toISOString();
      const dayEnd = new Date(`${today}T23:59:59+03:00`).toISOString();

      const [{ data: arrivals }, { data: stale }, { data: critical }] =
        await Promise.all([
          supabase
            .from("bookings")
            .select("reference, guest_name, party_size, starts_at, status")
            .eq("property_id", property.id)
            .gte("starts_at", dayStart)
            .lte("starts_at", dayEnd)
            .not("status", "in", "(cancelled,no_show)")
            .order("starts_at"),
          supabase
            .from("tasks")
            .select("title, updated_at")
            .eq("property_id", property.id)
            .eq("status", "in_progress")
            .lt("updated_at", new Date(Date.now() - 3 * 86_400_000).toISOString())
            .limit(8),
          supabase
            .from("tasks")
            .select("title, status, priority")
            .eq("property_id", property.id)
            .neq("status", "done")
            .in("priority", ["high", "urgent"])
            .limit(10),
        ]);

      const lines = [
        `🌅 **Morning brief — ${property.name}** (${today})`,
        ``,
        `**Today's arrivals/bookings:** ${(arrivals ?? []).length === 0 ? "none" : ""}`,
        ...(arrivals ?? []).map(
          (b) =>
            `• ${b.starts_at.slice(11, 16)} ${b.guest_name ?? "Guest"} ×${b.party_size} (${b.reference}, ${b.status})`,
        ),
        ``,
        `**Stale in-progress tasks (3+ days):** ${(stale ?? []).length === 0 ? "none" : ""}`,
        ...(stale ?? []).map((t) => `• ${t.title}`),
        ``,
        `**Open high/urgent tasks:** ${(critical ?? []).length === 0 ? "none" : ""}`,
        ...(critical ?? []).map((t) => `• [${t.priority}] ${t.title} (${t.status})`),
      ].join("\n");

      // Ops channel: the property's channel whose name contains "ops",
      // else the property's first channel; skip when none exist.
      const { data: channels } = await supabase
        .from("chat_channels")
        .select("stream_channel_id, name")
        .eq("property_id", property.id)
        .is("archived_at", null)
        .limit(20);
      const target =
        (channels ?? []).find((c) => /ops|operations/i.test(c.name ?? "")) ??
        (channels ?? [])[0];
      if (!target) {
        posted.push({ property: property.slug, skipped: "no channels" });
        continue;
      }

      if (!dry_run) {
        await server.upsertUser({ id: "pod-ops", name: "Morning Ops" });
        await server
          .channel("team", target.stream_channel_id)
          .sendMessage({ text: lines, user_id: "pod-ops", ai_generated: true } as never);
      }
      posted.push({
        property: property.slug,
        channel: target.stream_channel_id,
        arrivals: (arrivals ?? []).length,
        stale: (stale ?? []).length,
        critical: (critical ?? []).length,
        dry_run,
      });
    }
    return { posted };
  },
});
