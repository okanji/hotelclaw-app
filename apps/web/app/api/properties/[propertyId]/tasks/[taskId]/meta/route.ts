import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTaskDetailMeta } from "@/lib/tasks/task-detail-meta";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ propertyId: string; taskId: string }> },
) {
  const { taskId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const meta = await getTaskDetailMeta(supabase, taskId, user.id);
    if (!meta) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(meta);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load task meta" },
      { status: 500 },
    );
  }
}
