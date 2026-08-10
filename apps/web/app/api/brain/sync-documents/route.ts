import { NextResponse, type NextRequest } from "next/server";
import {
  sweepDocumentsBrainSync,
  sweepOrphanedBrainPages,
} from "@/lib/brain/doc-sync";

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
  // Second pass, walking brain → app: the cursor sweep above is
  // document-driven and structurally cannot see mirror pages whose document
  // was hard-deleted (no row left to iterate) or archived before it was ever
  // mirrored. Those pages stay searchable, so a bot cites retracted content
  // as current knowledge — a correctness bug, not housekeeping.
  const orphans = await sweepOrphanedBrainPages();
  return NextResponse.json({
    ok: true,
    ...counts,
    orphansScanned: orphans.scanned,
    orphansDeleted: orphans.deleted,
    orphansFailed: orphans.failed,
  });
}
