import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { emitWorkflowEvent } from "@/lib/workflows/event-emitter";

// Vercel Cron route — runs every 10 minutes (see vercel.json).
// Finds tasks past their due_at that haven't been notified yet, emits a
// task.overdue workflow_event per task, and stamps overdue_notified_at so
// each task triggers at most one overdue event per "miss" (the marker
// resets when a task moves back from done → todo via tasks_reset_overdue_on_reopen).

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BATCH = 200;

export async function GET(_request: NextRequest) {
  const supabase = createServiceClient();
  // Pull a batch of overdue, unnotified tasks. The partial index
  // tasks_overdue_candidates_idx keeps this cheap.
  const { data: candidates, error } = await supabase
    .from("tasks")
    .select("id, property_id, title, due_at, assignee_id, priority, status, labels")
    .lt("due_at", new Date().toISOString())
    .is("overdue_notified_at", null)
    .neq("status", "done")
    .order("due_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ swept: 0 });
  }

  const now = new Date().toISOString();
  let emitted = 0;
  for (const t of candidates) {
    try {
      await emitWorkflowEvent({
        propertyId: t.property_id,
        source: "cron",
        eventType: "task.overdue",
        entityId: t.id,
        entityKind: "task",
        payload: { new: t },
      });
      await supabase
        .from("tasks")
        .update({ overdue_notified_at: now })
        .eq("id", t.id);
      emitted++;
    } catch (err) {
      console.error("[workflows:sweep-overdue] task", t.id, err);
    }
  }

  return NextResponse.json({ swept: emitted });
}
