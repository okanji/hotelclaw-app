import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getEmailPrefs } from "@/lib/email/send-insight-email";

/**
 * GET   — the caller's email preferences (row lazily created).
 * PATCH — toggle digests/alerts, or clear an unsubscribe (re-enable).
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const prefs = await getEmailPrefs(user.id);
  return NextResponse.json({
    prefs: {
      digestsEnabled: prefs.digests_enabled,
      alertsEnabled: prefs.alerts_enabled,
      unsubscribedAt: prefs.unsubscribed_at,
    },
  });
}

const PatchBody = z.object({
  digestsEnabled: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
  resubscribe: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = PatchBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  await getEmailPrefs(user.id); // ensure the row exists
  const update: Partial<{
    digests_enabled: boolean;
    alerts_enabled: boolean;
    unsubscribed_at: string | null;
  }> = {};
  if (parsed.data.digestsEnabled !== undefined)
    update.digests_enabled = parsed.data.digestsEnabled;
  if (parsed.data.alertsEnabled !== undefined)
    update.alerts_enabled = parsed.data.alertsEnabled;
  if (parsed.data.resubscribe) update.unsubscribed_at = null;
  const { error } = await supabase
    .from("email_prefs")
    .update(update)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
