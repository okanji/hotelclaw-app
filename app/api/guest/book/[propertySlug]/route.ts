import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { publicRateLimit } from "@/lib/chatbots/limits";
import {
  createBookingChecked,
  getServiceAvailability,
  type BookableServiceRow,
} from "@/lib/bookings/availability";
import { mintManageToken } from "@/lib/bookings/manage-token";
import { sendBookingEmail } from "@/lib/bookings/email";
import { parseServiceSchedule } from "@/lib/bookings/schema";
import {
  loadBookingForm,
  recordBookingFormResponse,
  summarizeAnswers,
  validateBookingAnswers,
} from "@/lib/bookings/booking-form";
import type { FormAnswers } from "@/lib/forms/schema";
import { getOrigin } from "@/lib/utils/origin";

/**
 * PUBLIC booking endpoints for /book/<property-slug> — the no-chat path.
 * Same deterministic engine as the bot tools; web bookings land as PENDING
 * (staff confirm from the agenda) and the guest gets a confirmation email
 * with a signed manage link.
 *
 *   GET  ?serviceId&date&partySize&durationMinutes → open slots
 *   POST {serviceId, startsAt, …guest}             → create + email
 */

async function resolveProperty(slug: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("properties")
    .select("id, name")
    .eq("slug", slug)
    .is("archived_at", null)
    .maybeSingle();
  return data;
}

async function resolveService(propertyId: string, serviceId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("bookable_services")
    .select("*")
    .eq("id", serviceId)
    .eq("property_id", propertyId)
    .eq("active", true)
    .eq("public_bookable", true)
    .is("archived_at", null)
    .maybeSingle();
  return data as BookableServiceRow | null;
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ propertySlug: string }> },
) {
  const { propertySlug } = await params;
  if (!(await publicRateLimit(`avail:${clientIp(request)}`, 60, 60))) {
    return NextResponse.json({ error: "slow down" }, { status: 429 });
  }
  const property = await resolveProperty(propertySlug);
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  const q = request.nextUrl.searchParams;
  const date = q.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }
  const service = await resolveService(property.id, q.get("serviceId") ?? "");
  if (!service) return NextResponse.json({ error: "service not found" }, { status: 404 });

  const durationRaw = Number(q.get("durationMinutes") ?? "");
  const slots = await getServiceAvailability({
    service,
    date,
    partySize: Math.max(1, Number(q.get("partySize") ?? "1") || 1),
    durationMinutes:
      Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined,
  });
  return NextResponse.json({ slots, timezone: service.timezone });
}

const CreateBody = z.object({
  serviceId: z.string().uuid(),
  startsAt: z.string().max(40),
  partySize: z.number().int().min(1).max(100),
  durationMinutes: z.number().int().optional(),
  guestName: z.string().trim().min(1).max(120),
  guestEmail: z.string().trim().email().max(200),
  guestPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
  /** Answers to the service's attached booking form (schedule.formId). */
  formAnswers: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ propertySlug: string }> },
) {
  const { propertySlug } = await params;
  const ip = clientIp(request);
  // Tight create limit per IP — a public form is a spam magnet.
  if (!(await publicRateLimit(`create:${ip}`, 6, 600))) {
    return NextResponse.json(
      { error: "Too many booking attempts — try again in a few minutes." },
      { status: 429 },
    );
  }
  const property = await resolveProperty(propertySlug);
  if (!property) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const service = await resolveService(property.id, body.serviceId);
  if (!service) return NextResponse.json({ error: "service not found" }, { status: 404 });

  // Booking questions: validate BEFORE the booking exists so a missing
  // required answer never burns a slot.
  const bookingForm = await loadBookingForm(
    parseServiceSchedule(service.schedule).formId,
    property.id,
  );
  let cleanAnswers: FormAnswers = {};
  let notes = body.notes ?? null;
  if (bookingForm) {
    const validated = validateBookingAnswers(
      bookingForm.fields,
      (body.formAnswers ?? {}) as FormAnswers,
    );
    if (!validated.ok) {
      return NextResponse.json(
        { error: "Some answers need attention", fieldErrors: validated.errors },
        { status: 422 },
      );
    }
    cleanAnswers = validated.answers;
    const summary = summarizeAnswers(bookingForm.fields, cleanAnswers);
    if (summary) notes = notes ? `${notes} · ${summary}` : summary;
  }

  const result = await createBookingChecked({
    service,
    startsAt: body.startsAt,
    partySize: body.partySize,
    guestName: body.guestName,
    guestEmail: body.guestEmail,
    guestPhone: body.guestPhone ?? null,
    notes,
    // Web bookings wait for a staff yes — the safe default for an open form.
    autoConfirm: false,
    source: "web",
    durationMinutes: body.durationMinutes,
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, alternatives: result.alternatives ?? [] },
      { status: 409 },
    );
  }

  const booking = result.booking;

  // The full response also lands in the Forms feature (organizer analytics,
  // per-field summaries). Fail-soft: the booking stands even if this insert
  // hiccups — the notes summary already carries the answers.
  if (bookingForm) {
    await recordBookingFormResponse({
      formId: bookingForm.formId,
      propertyId: property.id,
      answers: cleanAnswers,
      reference: booking.reference,
    });
  }

  const manageToken = mintManageToken(booking.id);
  const origin = await getOrigin();
  after(async () => {
    await sendBookingEmail({
      booking,
      service,
      propertyName: property.name,
      manageUrl: `${origin}/book/manage/${manageToken}`,
    });
  });

  return NextResponse.json({
    reference: booking.reference,
    status: booking.status,
    manageToken,
  });
}
