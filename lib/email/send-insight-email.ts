import "server-only";
/**
 * Insight digest + alert emails. Delivery is rendering: digests render the
 * already-cached brief cards / weekly report headline — no generation
 * happens here. Three layers make retries and respect cheap:
 *   1. email_prefs — global per-user switchboard + tokenized unsubscribe
 *      (rows lazily created on first send).
 *   2. insight_email_log — insert-first dedupe on (user, dedupe_key), so a
 *      cron retry can't double-send.
 *   3. Resend idempotencyKey = the same dedupe key (24h window upstream).
 * Inline-HTML rendering follows the send-invite-email house pattern.
 */
import { createServiceClient } from "@/lib/supabase/server";
import { DEFAULT_FROM, getResend } from "./resend";
import type { InsightCard } from "@/lib/ai/bots/insights-bot";

export type EmailPrefsRow = {
  user_id: string;
  unsubscribe_token: string;
  digests_enabled: boolean;
  alerts_enabled: boolean;
  unsubscribed_at: string | null;
};

/** Load-or-create the user's email prefs row. */
export async function getEmailPrefs(userId: string): Promise<EmailPrefsRow> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("email_prefs")
    .select(
      "user_id, unsubscribe_token, digests_enabled, alerts_enabled, unsubscribed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as EmailPrefsRow;
  const { data: created, error } = await supabase
    .from("email_prefs")
    .upsert({ user_id: userId }, { onConflict: "user_id" })
    .select(
      "user_id, unsubscribe_token, digests_enabled, alerts_enabled, unsubscribed_at",
    )
    .single();
  if (error) throw new Error(`email_prefs upsert failed: ${error.message}`);
  return created as EmailPrefsRow;
}

type SendArgs = {
  userId: string;
  propertyId: string;
  kind: "digest_daily" | "digest_weekly" | "alert";
  dedupeKey: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Shared send path: prefs gate → log dedupe → Resend. Returns the outcome
 * for cron status JSON; "skipped" reasons are normal flow, not errors.
 */
async function sendInsightEmail(
  args: SendArgs,
): Promise<{ status: "sent" | "skipped"; reason?: string }> {
  const supabase = createServiceClient();

  const prefs = await getEmailPrefs(args.userId);
  if (prefs.unsubscribed_at) return { status: "skipped", reason: "unsubscribed" };
  if (args.kind === "alert" && !prefs.alerts_enabled)
    return { status: "skipped", reason: "alerts_disabled" };
  if (args.kind !== "alert" && !prefs.digests_enabled)
    return { status: "skipped", reason: "digests_disabled" };

  // Insert-first dedupe — a unique violation means an earlier run sent it.
  const { error: logError } = await supabase.from("insight_email_log").insert({
    user_id: args.userId,
    property_id: args.propertyId,
    kind: args.kind,
    dedupe_key: args.dedupeKey,
  });
  if (logError) {
    if (logError.code === "23505")
      return { status: "skipped", reason: "already_sent" };
    throw new Error(`email log insert failed: ${logError.message}`);
  }

  const { data: userRes, error: userError } =
    await supabase.auth.admin.getUserById(args.userId);
  const email = userRes?.user?.email;
  if (userError || !email) return { status: "skipped", reason: "no_email" };

  const unsubscribeUrl = await unsubscribeUrlFor(prefs.unsubscribe_token);
  const resend = getResend();
  const { data, error } = await resend.emails.send(
    {
      from: DEFAULT_FROM,
      to: [email],
      subject: args.subject,
      html: args.html.replace("%%UNSUBSCRIBE_URL%%", unsubscribeUrl),
      text: `${args.text}\n\nUnsubscribe: ${unsubscribeUrl}`,
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
    { idempotencyKey: args.dedupeKey.slice(0, 256) },
  );
  if (error) {
    console.error("[insight-email] send failed", args.dedupeKey, error.message);
    return { status: "skipped", reason: `resend: ${error.message}` };
  }
  await supabase
    .from("insight_email_log")
    .update({ resend_id: data?.id ?? null })
    .eq("user_id", args.userId)
    .eq("dedupe_key", args.dedupeKey);
  return { status: "sent" };
}

async function unsubscribeUrlFor(token: string): Promise<string> {
  const { getOrigin } = await import("@/lib/utils/origin");
  const origin = await getOrigin();
  return `${origin}/api/email/unsubscribe?token=${token}`;
}

/* ── Digest email ─────────────────────────────────────────────────────────── */

export async function sendDigestEmail(args: {
  userId: string;
  propertyId: string;
  propertyName: string;
  lensLabel: string;
  cadence: "daily" | "weekly";
  dedupeKey: string;
  summary: string | null;
  cards: InsightCard[];
  insightsUrl: string;
}): Promise<{ status: "sent" | "skipped"; reason?: string }> {
  const subject =
    args.cadence === "weekly"
      ? `Weekly insights — ${args.propertyName}`
      : `Today's insights — ${args.lensLabel} · ${args.propertyName}`;

  const cardsHtml = args.cards
    .map(
      (c) => `
        <tr>
          <td style="padding:12px 0;border-top:1px solid #e5e5e5;">
            <p style="margin:0 0 4px 0;font-size:14px;font-weight:600;color:${severityColor(c.severity)};">${escapeHtml(c.headline)}</p>
            <p style="margin:0;font-size:13px;line-height:1.5;color:#525252;">${escapeHtml(c.detail)}</p>
          </td>
        </tr>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 2px 0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#737373;">${escapeHtml(args.propertyName)} · ${escapeHtml(args.lensLabel)}</p>
          <h1 style="margin:0;font-size:19px;font-weight:600;color:#0a0a0a;">${args.cadence === "weekly" ? "Your weekly insights" : "Since yesterday"}</h1>
        </td></tr>
        ${
          args.summary
            ? `<tr><td style="padding:8px 32px 4px 32px;"><p style="margin:0;font-size:13px;line-height:1.6;color:#525252;">${escapeHtml(args.summary)}</p></td></tr>`
            : ""
        }
        <tr><td style="padding:8px 32px 8px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${cardsHtml}</table>
        </td></tr>
        <tr><td style="padding:12px 32px 28px 32px;">
          <a href="${args.insightsUrl}" style="display:inline-block;padding:11px 18px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open Insights</a>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <p style="margin:0;color:#a3a3a3;font-size:11px;line-height:1.5;">You follow this lens on Hotelclaw. <a href="%%UNSUBSCRIBE_URL%%" style="color:#a3a3a3;">Unsubscribe from all emails</a> or adjust follows in Insights.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `${args.propertyName} · ${args.lensLabel}`,
    args.summary ?? "",
    ...args.cards.map((c) => `- ${c.headline}: ${c.detail}`),
    `Open Insights: ${args.insightsUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return sendInsightEmail({
    userId: args.userId,
    propertyId: args.propertyId,
    kind: args.cadence === "weekly" ? "digest_weekly" : "digest_daily",
    dedupeKey: args.dedupeKey,
    subject,
    html,
    text,
  });
}

/* ── Alert email ──────────────────────────────────────────────────────────── */

export async function sendAlertEmail(args: {
  userId: string;
  propertyId: string;
  propertyName: string;
  dedupeKey: string;
  ruleDescription: string;
  currentValue: string;
  detailLines: string[];
  insightsUrl: string;
}): Promise<{ status: "sent" | "skipped"; reason?: string }> {
  const detailHtml = args.detailLines
    .map(
      (l) =>
        `<li style="margin:0 0 4px 0;font-size:13px;line-height:1.5;color:#525252;">${escapeHtml(l)}</li>`,
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
        <tr><td style="padding:28px 32px 8px 32px;">
          <p style="margin:0 0 2px 0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#e11d48;">Alert · ${escapeHtml(args.propertyName)}</p>
          <h1 style="margin:0;font-size:19px;font-weight:600;color:#0a0a0a;">${escapeHtml(args.ruleDescription)}</h1>
          <p style="margin:6px 0 0 0;font-size:13px;color:#525252;">Now at <strong style="color:#0a0a0a;">${escapeHtml(args.currentValue)}</strong>.</p>
        </td></tr>
        ${
          args.detailLines.length > 0
            ? `<tr><td style="padding:8px 32px 4px 32px;"><ul style="margin:0;padding-left:18px;">${detailHtml}</ul></td></tr>`
            : ""
        }
        <tr><td style="padding:14px 32px 28px 32px;">
          <a href="${args.insightsUrl}" style="display:inline-block;padding:11px 18px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:500;font-size:13px;">Open Insights</a>
        </td></tr>
        <tr><td style="padding:0 32px 24px 32px;">
          <p style="margin:0;color:#a3a3a3;font-size:11px;line-height:1.5;">You set this alert on Hotelclaw. <a href="%%UNSUBSCRIBE_URL%%" style="color:#a3a3a3;">Unsubscribe from all emails</a> or adjust rules in Insights.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `${args.ruleDescription} — now at ${args.currentValue}.`,
    ...args.detailLines.map((l) => `- ${l}`),
    `Open Insights: ${args.insightsUrl}`,
  ].join("\n");

  return sendInsightEmail({
    userId: args.userId,
    propertyId: args.propertyId,
    kind: "alert",
    dedupeKey: args.dedupeKey,
    subject: `⚠ ${args.ruleDescription} — ${args.propertyName}`,
    html,
    text,
  });
}

function severityColor(severity: InsightCard["severity"]): string {
  return severity === "critical"
    ? "#e11d48"
    : severity === "warning"
      ? "#d97706"
      : "#0a0a0a";
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
