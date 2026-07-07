import { NextResponse, type NextRequest } from "next/server";
import { drainEvents } from "@/lib/workflows/dispatcher";

// Vercel Cron route — runs every 15s (see vercel.json crons config).
// Drains any workflow_events rows that the inline-after() race missed.
// Vercel signs cron calls with the `x-vercel-cron-signature` header.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: NextRequest) {
  const result = await drainEvents(100);
  return NextResponse.json(result);
}
