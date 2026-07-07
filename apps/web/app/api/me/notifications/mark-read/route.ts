import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  ids: z.array(z.string().uuid()).optional(),
  all: z.boolean().optional(),
});

/**
 * POST /api/me/notifications/mark-read
 *   body: { ids?: string[], all?: boolean }
 *
 * RLS guarantees the update only affects rows the user owns, so we don't
 * need to also filter by user_id (we still do, defensively).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const now = new Date().toISOString();
  let q = supabase
    .from("notifications")
    .update({ seen_at: now })
    .eq("user_id", user.id)
    .is("seen_at", null);

  if (parsed.data.ids && parsed.data.ids.length > 0) {
    q = q.in("id", parsed.data.ids);
  } else if (!parsed.data.all) {
    return NextResponse.json(
      { error: "specify ids or all" },
      { status: 400 },
    );
  }

  const { error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
