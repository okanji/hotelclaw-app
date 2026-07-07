import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { verifyApiToken } from "@/lib/mcp/tokens";
import { createServiceClient } from "@/lib/supabase/server";
import {
  computeInsightsMetrics,
  computeOperationsMetrics,
} from "@/lib/insights/metrics";
import { parseScope, PROPERTY_SCOPE } from "@/lib/insights/scope";
import { scopeLabel } from "@/lib/ai/bots/insights-bot";

/**
 * MCP server over the deterministic insights layer — lets external AI
 * clients (Claude, ChatGPT, scripts) query a property's REAL numbers: the
 * same `computeInsightsMetrics` functions the dashboards chart and the
 * in-app bots narrate. Read-only by design; the client brings its own
 * model, we bring trustworthy data.
 *
 * Auth: `Authorization: Bearer hc_…` (property-scoped api_tokens, hashes
 * only at rest). The token→property binding is the tenant isolation — every
 * tool reads the propertyId off the verified token, never from the caller.
 *
 * Connect from Claude:  https://<app>/api/mcp/mcp  (streamable HTTP)
 */

const scopeParam = z
  .string()
  .optional()
  .describe(
    "Lens: 'property' (default), 'project:<id>', 'space:<id>', or 'person:<id>'. Resolve names to ids with list_lenses first.",
  );

function propertyIdOf(extra: { authInfo?: { extra?: Record<string, unknown> } }): string {
  const id = extra.authInfo?.extra?.propertyId;
  if (typeof id !== "string") throw new Error("unauthorized");
  return id;
}

async function resolveScope(propertyId: string, raw: string | undefined) {
  const scope = raw ? parseScope(raw) : PROPERTY_SCOPE;
  if (!scope) throw new Error(`invalid scope "${raw}"`);
  if (scope.kind === "project" || scope.kind === "space") {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from(scope.kind === "project" ? "projects" : "spaces")
      .select("id")
      .eq("id", scope.id)
      .eq("property_id", propertyId)
      .maybeSingle();
    if (!data) throw new Error(`${scope.kind} ${scope.id} not found in this property`);
  }
  return scope;
}

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_lenses",
      "The property's projects, teams (spaces), and people with ids — map names to scope ids before calling scoped tools.",
      {},
      async (_args, extra) => {
        const propertyId = propertyIdOf(extra);
        const supabase = createServiceClient();
        const [projects, spaces, members] = await Promise.all([
          supabase
            .from("projects")
            .select("id, name, status")
            .eq("property_id", propertyId)
            .is("archived_at", null),
          supabase
            .from("spaces")
            .select("id, name")
            .eq("property_id", propertyId)
            .is("archived_at", null),
          supabase
            .from("memberships")
            .select("user_id, role")
            .eq("property_id", propertyId),
        ]);
        const ids = (members.data ?? []).map((m) => m.user_id);
        const { data: profiles } = ids.length
          ? await supabase.from("profiles").select("id, full_name").in("id", ids)
          : { data: [] };
        const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
        return json({
          projects: projects.data ?? [],
          spaces: spaces.data ?? [],
          people: (members.data ?? []).map((m) => ({
            id: m.user_id,
            name: nameById.get(m.user_id) ?? null,
            role: m.role,
          })),
        });
      },
    );

    server.tool(
      "get_flow_metrics",
      "Open-work snapshot, 8-week created-vs-completed flow, median cycle time, and likely-to-slip summary for a lens. All numbers deterministic — the same the dashboards chart.",
      { scope: scopeParam },
      async ({ scope: raw }, extra) => {
        const propertyId = propertyIdOf(extra);
        const scope = await resolveScope(propertyId, raw);
        const m = await computeInsightsMetrics(propertyId, scope);
        return json({
          lens: await scopeLabel(propertyId, scope),
          snapshot: m.snapshot,
          flow: m.flow,
          cycleTime: m.cycleTime,
          slip: { count: m.slip.count, sample: m.slip.sample, p75ByCohort: m.slip.p75ByCohort },
        });
      },
    );

    server.tool(
      "get_attention",
      "The attention list for a lens: blocked (days stuck), overdue (days late), likely-to-slip (runway days), unassigned urgent — with assignee names and task ids.",
      { scope: scopeParam },
      async ({ scope: raw }, extra) => {
        const propertyId = propertyIdOf(extra);
        const scope = await resolveScope(propertyId, raw);
        const m = await computeInsightsMetrics(propertyId, scope);
        return json({
          lens: await scopeLabel(propertyId, scope),
          attention: m.attention.slice(0, 25),
        });
      },
    );

    server.tool(
      "get_portfolio",
      "Per-project rollups with deterministic pace flags (on_pace/behind/at_risk) and the reasons they were flagged.",
      {},
      async (_args, extra) => {
        const propertyId = propertyIdOf(extra);
        const m = await computeInsightsMetrics(propertyId);
        return json({ portfolio: m.portfolio });
      },
    );

    server.tool(
      "get_workload",
      "Per-person load: open/blocked/overdue/urgent counts, weekly completions, meeting load.",
      {},
      async (_args, extra) => {
        const propertyId = propertyIdOf(extra);
        const m = await computeInsightsMetrics(propertyId);
        return json({ workload: m.workload });
      },
    );

    server.tool(
      "get_operations",
      "Operations health, last 7-14 days: meetings/decisions/unowned action items, automation run outcomes, stale pinned SOPs.",
      {},
      async (_args, extra) => {
        const propertyId = propertyIdOf(extra);
        const m = await computeOperationsMetrics(propertyId);
        return json({
          meetings: m.meetings,
          automation: {
            succeeded: m.automation.succeeded,
            failed: m.automation.failed,
            topFailing: m.automation.topFailing,
          },
          staleSops: m.staleSops,
        });
      },
    );

    server.tool(
      "get_intelligence_brief",
      "The cached AI intelligence brief for a lens — ranked insight cards (with validated deep-link ids, provenance signals, and any chatter evidence) plus the metrics explainer paragraph. Returns what the Insights page shows; never triggers a generation.",
      { scope: scopeParam },
      async ({ scope: raw }, extra) => {
        const propertyId = propertyIdOf(extra);
        const scope = await resolveScope(propertyId, raw);
        const { getCachedBrief } = await import("@/lib/ai/bots/insights-bot");
        const brief = await getCachedBrief(propertyId, scope);
        return json(
          brief
            ? {
                lens: await scopeLabel(propertyId, scope),
                summary: brief.summary,
                insights: brief.insights,
                generatedAt: brief.generated_at,
              }
            : { brief: null, note: "no brief cached for this lens yet" },
        );
      },
    );

    server.tool(
      "get_weekly_report",
      "The latest AI weekly management report (markdown) with its period.",
      {},
      async (_args, extra) => {
        const propertyId = propertyIdOf(extra);
        const supabase = createServiceClient();
        const { data } = await supabase
          .from("insight_reports")
          .select("period_start, period_end, summary_md")
          .eq("property_id", propertyId)
          .eq("audience", "management")
          .order("period_start", { ascending: false })
          .limit(1)
          .maybeSingle();
        return json(data ?? { report: null, note: "no weekly report yet" });
      },
    );
  },
  {
    serverInfo: { name: "hotelclaw-insights", version: "1.0.0" },
  },
  {
    basePath: "/api/mcp",
    disableSse: true,
    maxDuration: 60,
  },
);

const authedHandler = withMcpAuth(
  handler,
  async (_req, bearerToken) => {
    const verified = await verifyApiToken(bearerToken);
    if (!verified) return undefined;
    return {
      token: bearerToken!,
      clientId: verified.tokenId,
      scopes: ["insights:read"],
      extra: { propertyId: verified.propertyId },
    };
  },
  { required: true },
);

export {
  authedHandler as GET,
  authedHandler as POST,
  authedHandler as DELETE,
};
