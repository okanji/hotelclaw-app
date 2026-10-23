import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { consolidateMemories, distillFeedback } from "@/lib/memory/learn";

// Vercel Cron — nightly 03:15 UTC (vercel.json). The learning loop's
// housekeeping: turn feedback notes into per-person preference memories
// (deterministic) and merge/prune auto-captured memories (Haiku, only for
// scopes past the threshold — quiet properties cost nothing).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient();
  const { data: properties, error } = await supabase.from("properties").select("id");
  if (error) {
    console.error("[memory-cron] properties query failed", error);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
  const results: Record<string, unknown>[] = [];
  for (const property of properties ?? []) {
    try {
      const feedback = await distillFeedback(property.id);
      const consolidation = await consolidateMemories(property.id);
      results.push({ propertyId: property.id, ...feedback, ...consolidation });
    } catch (err) {
      console.error("[memory-cron] failed", property.id, err);
      results.push({ propertyId: property.id, error: String(err) });
    }
  }
  return NextResponse.json({ ok: true, results });
}
