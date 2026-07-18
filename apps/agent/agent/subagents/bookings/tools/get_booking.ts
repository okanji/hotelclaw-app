import { defineTool } from "eve/tools";
import { z } from "zod";
import { serviceClient } from "../../../lib/supabase";
import { resolveTenantCaller } from "../../../lib/tenant";

export default defineTool({
  description: "Fetch one booking by its reference (BKG-XXXXXX).",
  inputSchema: z.object({ reference: z.string().min(4).max(20) }),
  async execute({ reference }, ctx) {
    const { propertyId } = await resolveTenantCaller(ctx);
    const { data, error } = await serviceClient()
      .from("bookings")
      .select(
        "reference, guest_name, party_size, status, starts_at, ends_at, notes, bookable_services(name)",
      )
      .eq("property_id", propertyId)
      .eq("reference", reference.toUpperCase())
      .maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: "No booking with that reference here." };
    return { booking: data };
  },
});
