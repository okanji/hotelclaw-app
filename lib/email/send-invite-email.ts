import "server-only";
import { DEFAULT_FROM, getResend } from "./resend";

type Args = {
  to: string;
  inviterName: string;
  propertyName: string;
  role: string;
  /** Magic link from `auth.admin.generateLink` — clicking it signs the
   *  recipient in (or signs them up) and lands them on /invites/{token}. */
  acceptUrl: string;
  /** Used for the idempotency key so retries don't double-send. */
  inviteToken: string;
};

export async function sendInviteEmail(args: Args): Promise<{
  ok: boolean;
  error?: string;
  id?: string;
}> {
  const resend = getResend();

  const subject = `${args.inviterName} invited you to ${args.propertyName} on Hotelclaw`;

  const html = renderInviteHtml(args);
  const text = renderInviteText(args);

  const { data, error } = await resend.emails.send(
    {
      from: DEFAULT_FROM,
      to: [args.to],
      subject,
      html,
      text,
    },
    { idempotencyKey: `invite-email/${args.inviteToken}` },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id };
}

function renderInviteHtml({
  inviterName,
  propertyName,
  role,
  acceptUrl,
}: Args): string {
  // Inline styles keep the email rendering consistent across clients.
  return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
          <tr>
            <td style="padding:32px 32px 16px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#0a0a0a;">Join ${escapeHtml(propertyName)}</h1>
              <p style="margin:0;color:#525252;font-size:14px;line-height:1.5;">
                <strong style="color:#0a0a0a;">${escapeHtml(inviterName)}</strong> invited you to join
                <strong style="color:#0a0a0a;">${escapeHtml(propertyName)}</strong> on Hotelclaw as
                <strong style="color:#0a0a0a;">${escapeHtml(role)}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 32px 32px;">
              <a href="${acceptUrl}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:500;font-size:14px;">
                Accept invite
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px 32px;">
              <p style="margin:0;color:#737373;font-size:12px;line-height:1.5;">
                Clicking the link signs you in to your existing account and brings you to the invite acceptance page.
                The link expires in 7 days. If you weren't expecting this, you can ignore the email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e5e5e5;background:#fafafa;">
              <p style="margin:0;color:#a3a3a3;font-size:11px;word-break:break-all;">
                Or paste this URL into your browser:<br/>
                <span style="color:#525252;">${escapeHtml(acceptUrl)}</span>
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;color:#a3a3a3;font-size:11px;">Hotelclaw · AI-first hotel productivity</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderInviteText({
  inviterName,
  propertyName,
  role,
  acceptUrl,
}: Args): string {
  return [
    `${inviterName} invited you to join ${propertyName} on Hotelclaw as ${role}.`,
    ``,
    `Accept here:`,
    acceptUrl,
    ``,
    `Clicking the link signs you in and brings you to the invite acceptance page.`,
    `The link expires in 7 days.`,
    ``,
    `Hotelclaw · AI-first hotel productivity`,
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
