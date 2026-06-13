import "server-only";
/**
 * Booking confirmation email — fail-soft (no RESEND_API_KEY → log + skip;
 * the booking itself never depends on email delivery). Inline-HTML house
 * pattern, warm guest palette to match the public pages.
 */
import { DEFAULT_FROM, getResend } from "@/lib/email/resend";
import { formatSlotForGuest } from "@/lib/bookings/availability";
import type { BookableServiceRow, BookingRow } from "@/lib/bookings/availability";

const ACCENT = "#c96442";
const INK = "#1f1e1b";
const INK_SOFT = "#6f6a60";

export async function sendBookingEmail(args: {
  booking: BookingRow;
  service: BookableServiceRow;
  propertyName: string;
  manageUrl: string;
}): Promise<boolean> {
  const { booking, service } = args;
  if (!booking.guest_email) return false;
  if (!process.env.RESEND_API_KEY) {
    console.warn("[booking-email] RESEND_API_KEY not set — skipping confirmation email");
    return false;
  }

  const when = formatSlotForGuest(
    { startsAt: booking.starts_at, endsAt: booking.ends_at, label: "", remaining: 0 },
    service.timezone,
  );
  const pending = booking.status === "pending";
  const isTicket = service.kind === "event";
  const partyLine = isTicket
    ? `${booking.party_size} ticket${booking.party_size === 1 ? "" : "s"}`
    : `party of ${booking.party_size}`;
  const subject = isTicket
    ? `Your ticket${booking.party_size === 1 ? "" : "s"} — ${service.name}, ${when}`
    : pending
      ? `Booking request received — ${service.name}, ${when}`
      : `Booking confirmed — ${service.name}, ${when}`;

  const html = `
  <div style="margin:0 auto;max-width:520px;padding:32px 24px;background:#faf7f1;color:${INK};font-family:Georgia,'Times New Roman',serif;">
    <p style="margin:0 0 4px;font-size:13px;color:${INK_SOFT};font-family:Helvetica,Arial,sans-serif;">${escapeHtml(args.propertyName)}</p>
    <h1 style="margin:0 0 16px;font-size:24px;font-weight:600;">${isTicket ? "Your tickets are reserved" : pending ? "We got your booking request" : "You're booked"}</h1>
    <div style="border:1px solid rgba(31,30,27,0.12);border-radius:12px;background:#ffffff;padding:20px;font-family:Helvetica,Arial,sans-serif;">
      <p style="margin:0 0 6px;font-size:16px;font-weight:600;">${service.emoji ? `${service.emoji} ` : ""}${escapeHtml(service.name)}</p>
      <p style="margin:0 0 2px;font-size:14px;">${when}</p>
      <p style="margin:0 0 2px;font-size:14px;">${escapeHtml(booking.guest_name)} · ${partyLine}</p>
      <p style="margin:8px 0 0;font-size:13px;color:${INK_SOFT};">Reference <strong style="color:${INK};">${booking.reference}</strong></p>
      ${pending ? `<p style="margin:10px 0 0;font-size:13px;color:${INK_SOFT};">The team will confirm shortly — you'll see the status on your booking page.</p>` : ""}
    </div>
    <p style="margin:20px 0 0;font-family:Helvetica,Arial,sans-serif;">
      <a href="${args.manageUrl}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:999px;">${isTicket ? "View your tickets" : "View or cancel your booking"}</a>
    </p>
    ${isTicket ? `<p style="margin:14px 0 0;font-size:13px;color:${INK_SOFT};font-family:Helvetica,Arial,sans-serif;">Your ticket page has a QR code — show it at the door to check in.</p>` : ""}
    <p style="margin:14px 0 0;font-size:12px;color:${INK_SOFT};font-family:Helvetica,Arial,sans-serif;">If the button doesn't work, open this link: <a href="${args.manageUrl}" style="color:${ACCENT};">${args.manageUrl}</a></p>
    <p style="margin:10px 0 0;font-size:12px;color:${INK_SOFT};font-family:Helvetica,Arial,sans-serif;">This link is unique to your booking — anyone with it can manage it.</p>
  </div>`;

  const text = [
    `${isTicket ? "Tickets reserved" : pending ? "Booking request received" : "Booking confirmed"} — ${args.propertyName}`,
    `${service.name} · ${when}`,
    `${booking.guest_name} · ${partyLine}`,
    `Reference: ${booking.reference}`,
    `${isTicket ? "Your tickets (QR at the door)" : "Manage your booking"}: ${args.manageUrl}`,
  ].join("\n");

  try {
    await getResend().emails.send({
      from: DEFAULT_FROM,
      to: booking.guest_email,
      subject,
      html,
      text,
      headers: { "X-Entity-Ref-ID": booking.reference },
    });
    return true;
  } catch (err) {
    console.error("[booking-email] send failed", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
