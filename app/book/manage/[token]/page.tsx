import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyManageToken } from "@/lib/bookings/manage-token";
import { formatSlotForGuest } from "@/lib/bookings/availability";
import { CancelBookingButton } from "@/components/public-booking/cancel-booking-button";
import { TicketQr } from "@/components/public-booking/ticket-qr";
import { getOrigin } from "@/lib/utils/origin";

/**
 * The guest's booking page — destination of the emailed signed link.
 * View status + self-cancel before the start time. No account, no session;
 * the HMAC in the URL is the credential.
 */
export default async function ManageBookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const bookingId = verifyManageToken(token);
  if (!bookingId) notFound();

  const supabase = createServiceClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) notFound();

  const [{ data: service }, { data: property }] = await Promise.all([
    supabase
      .from("bookable_services")
      .select("name, emoji, kind, timezone, schedule")
      .eq("id", booking.service_id)
      .maybeSingle(),
    supabase
      .from("properties")
      .select("name, slug")
      .eq("id", booking.property_id)
      .maybeSingle(),
  ]);

  const when = formatSlotForGuest(
    { startsAt: booking.starts_at, endsAt: booking.ends_at, label: "", remaining: 0 },
    service?.timezone ?? "UTC",
  );
  const now = new Date();
  const cancellable =
    (booking.status === "pending" || booking.status === "confirmed") &&
    new Date(booking.starts_at) > now;

  const isTicket = service?.kind === "event";
  const STATUS_COPY: Record<string, { title: string; tone: string }> = {
    pending: { title: "Waiting for confirmation", tone: "#b45309" },
    confirmed: { title: "Confirmed", tone: "#047857" },
    seated: {
      title: isTicket ? "Checked in" : "In progress",
      tone: "#6d28d9",
    },
    completed: { title: "Completed", tone: "#6f6a60" },
    cancelled: { title: "Cancelled", tone: "#6f6a60" },
    no_show: { title: "Marked as no-show", tone: "#b91c1c" },
  };
  const status = STATUS_COPY[booking.status] ?? STATUS_COPY.pending;
  const origin = await getOrigin();

  return (
    <div className="min-h-dvh bg-[#faf7f1] text-[#1f1e1b]">
      <div className="mx-auto max-w-xl px-5 py-10 sm:py-14">
        <p className="text-[13px] text-[#6f6a60]">{property?.name ?? "Your booking"}</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">
          {isTicket
            ? booking.party_size === 1
              ? "Your ticket"
              : "Your tickets"
            : "Your booking"}
        </h1>

        <div className="mt-6 rounded-2xl border border-[#1f1e1b]/10 bg-white p-5">
          <p
            className="text-sm font-semibold tracking-wide uppercase"
            style={{ color: status.tone }}
          >
            {status.title}
          </p>
          <p className="mt-3 text-lg font-semibold">
            {service?.emoji ? `${service.emoji} ` : ""}
            {service?.name ?? "Booking"}
          </p>
          <p className="text-[15px] text-[#6f6a60]">{when}</p>
          <p className="mt-1 text-[15px]">
            {booking.guest_name} ·{" "}
            {isTicket
              ? `${booking.party_size} ticket${booking.party_size === 1 ? "" : "s"}`
              : `party of ${booking.party_size}`}
          </p>
          {booking.notes ? (
            <p className="mt-2 text-sm text-[#6f6a60]">&ldquo;{booking.notes}&rdquo;</p>
          ) : null}
          <p className="mt-4 text-sm text-[#6f6a60]">
            Reference <strong className="text-[#1f1e1b]">{booking.reference}</strong>
          </p>
        </div>

        {isTicket &&
        (booking.status === "confirmed" || booking.status === "pending") ? (
          <div className="mt-5">
            <TicketQr
              url={`${origin}/book/manage/${token}`}
              reference={booking.reference}
            />
          </div>
        ) : null}

        {cancellable ? (
          <div className="mt-5">
            <CancelBookingButton token={token} />
          </div>
        ) : null}

        <p className="mt-6 text-xs text-[#6f6a60]">
          Questions or changes? Contact {property?.name ?? "the venue"} directly
          and quote your reference.
        </p>
        {property?.slug ? (
          <a
            href={`/book/${property.slug}`}
            className="mt-3 inline-block text-sm font-medium text-[#c96442] underline underline-offset-4"
          >
            {isTicket ? "Get more tickets" : "Make another booking"}
          </a>
        ) : null}
      </div>
    </div>
  );
}
