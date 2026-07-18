import { defineTool } from "eve/tools";
import { z } from "zod";
import { serviceClient } from "../../../lib/supabase";
import { resolveTenantCaller } from "../../../lib/tenant";

export default defineTool({
  description:
    "List bookings for this property in a date window (default: next 7 days).",
  inputSchema: z.object({
    from: z.string().optional().describe("ISO date, default today"),
    days: z.number().int().min(1).max(60).default(7),
    limit: z.number().int().min(1).max(50).default(25),
  }),
  async execute({ from, days, limit }, ctx) {
    const { propertyId } = await resolveTenantCaller(ctx);
    const start = from ? new Date(`${from}T00:00:00Z`) : new Date();
    const end = new Date(start.getTime() + days * 86_400_000);
    const { data, error } = await serviceClient()
      .from("bookings")
      .select(
        "reference, guest_name, party_size, status, starts_at, bookable_services(name)",
      )
      .eq("property_id", propertyId)
      .gte("starts_at", start.toISOString())
      .lte("starts_at", end.toISOString())
      .order("starts_at", { ascending: true })
      .limit(limit);
    if (error) return { error: error.message };
    return {
      count: (data ?? []).length,
      bookings: (data ?? []).map((b) => ({
        reference: b.reference,
        guest: b.guest_name,
        party: b.party_size,
        status: b.status,
        starts_at: b.starts_at,
        service: (b.bookable_services as { name?: string } | null)?.name ?? null,
      })),
    };
  },
});
