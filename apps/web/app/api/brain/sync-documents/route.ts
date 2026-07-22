import { NextResponse, type NextRequest } from "next/server";
import { sweepDocumentsBrainSync } from "@/lib/brain/doc-sync";

// Vercel Cron — nightly 03:30 UTC (see vercel.json). Reconciliation sweep
// for the document → brain mirror: the Liveblocks snapshot webhook is the
// primary (edit-driven) trigger, this catches missed deliveries, archives,
// and docs created while a property had no brain binding yet.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const counts = await sweepDocumentsBrainSync();
  return NextResponse.json({ ok: true, ...counts });
}
