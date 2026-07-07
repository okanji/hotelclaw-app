"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, MapPin, Ticket } from "lucide-react";
import type { Slot } from "@/lib/bookings/availability";
import {
  EVENT_COVER_PRESETS,
  type EventPageConfig,
} from "@/lib/bookings/schema";
import type { FormAnswers, FormField } from "@/lib/forms/schema";
import { GuestFormFields } from "./guest-form-fields";

/**
 * The guest-facing event ticket page (Luma pattern): square cover art on
 * the left, title + date tile + location + registration card on the right,
 * long-form about below. Mobile stacks. The accent + cover come from
 * `schedule.page`; the booking POST is the same engine as the wizard.
 */

const INK = "#1f1e1b";
const INK_SOFT = "#6f6a60";
const CANVAS = "#faf7f1";
const HAIRLINE = "rgba(31,30,27,0.12)";

export type EventService = {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  timezone: string;
  maxPartySize: number;
  capacity: number;
  priceLabel: string;
};

export function EventPage({
  propertySlug,
  propertyName,
  service,
  page,
  dates,
  form = null,
}: {
  propertySlug: string;
  propertyName: string;
  service: EventService;
  page: EventPageConfig;
  dates: string[];
  /** The organizer's booking questions (guest-safe fields). */
  form?: { formId: string; title: string; fields: FormField[] } | null;
}) {
  const accent = page.accent;
  const cover =
    EVENT_COVER_PRESETS[page.coverStyle] ?? EVENT_COVER_PRESETS.sunset;
  const coverEmoji = page.coverEmoji || service.emoji || "🎉";
  const host = page.host || propertyName;
  const about = page.about || service.description || "";

  const [date, setDate] = useState(dates[0] ?? "");
  const [party, setParty] = useState(1);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string } | null>(null);
  const [formAnswers, setFormAnswers] = useState<FormAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset slots during render when the query changes (sanctioned
  // adjust-on-changed-value pattern); the effect only fetches.
  const slotQueryKey = `${date}|${party}`;
  const [prevSlotQueryKey, setPrevSlotQueryKey] = useState(slotQueryKey);
  if (slotQueryKey !== prevSlotQueryKey) {
    setPrevSlotQueryKey(slotQueryKey);
    setSlots(null);
    setSlot(null);
  }

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    fetch(
      `/api/guest/book/${propertySlug}?serviceId=${service.id}&date=${date}&partySize=${party}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { slots: Slot[] }) => {
        if (cancelled) return;
        setSlots(data.slots);
        // Events usually have one start time — preselect it.
        if (data.slots.length === 1) setSlot(data.slots[0]);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [propertySlug, service.id, date, party]);

  // Tickets remaining on the selected date (capacity-aware engine data).
  const remaining =
    slots && slots.length > 0
      ? Math.max(...slots.map((s) => s.remaining))
      : slots
        ? 0
        : null;
  const soldOut = remaining === 0;
  const lowStock = remaining !== null && remaining > 0 && remaining <= Math.ceil(service.capacity * 0.2);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slot) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/guest/book/${propertySlug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: service.id,
          startsAt: slot.startsAt,
          partySize: party,
          guestName: name.trim(),
          guestEmail: email.trim(),
          formAnswers: form ? formAnswers : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't work — try again.");
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        return;
      }
      setDone({ reference: data.reference });
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  const dateLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(
      new Date(`${d}T00:00:00Z`),
    );
  const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: service.timezone,
    }).format(new Date(iso));

  // Blank-line paragraphs (the about field's convention).
  const aboutParagraphs = about
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="min-h-dvh" style={{ backgroundColor: CANVAS, color: INK }}>
      <div className="mx-auto max-w-4xl px-5 pt-10 pb-20 sm:pt-14 sm:pb-28">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[320px_minmax(0,1fr)]">
          {/* Cover column (the Luma square + host block) — sticky so the
              art keeps the registration card company on long pages. */}
          <div className="mx-auto w-full max-w-80 md:sticky md:top-10 md:mx-0 md:self-start">
            <div
              aria-hidden
              className="flex aspect-square w-full items-center justify-center rounded-3xl shadow-sm ring-1 ring-[#1f1e1b]/10 ring-inset"
              style={{ background: cover.css }}
            >
              <span className="text-8xl drop-shadow-sm">{coverEmoji}</span>
            </div>
            <div className="mt-5 hidden md:block">
              <p
                className="border-b pb-1.5 text-xs font-semibold tracking-wide uppercase"
                style={{ borderColor: HAIRLINE, color: INK_SOFT }}
              >
                Hosted by
              </p>
              <div className="mt-3 flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {host.charAt(0).toUpperCase()}
                </span>
                <p className="min-w-0 truncate text-sm font-medium">{host}</p>
              </div>
            </div>
          </div>

          {/* Title + facts + registration */}
          <div className="min-w-0">
            <p className="text-sm md:hidden" style={{ color: INK_SOFT }}>
              Hosted by {host}
            </p>
            <h1 className="font-serif text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {service.name}
            </h1>
            {page.tagline ? (
              <p className="mt-2 text-base text-pretty" style={{ color: INK_SOFT }}>
                {page.tagline}
              </p>
            ) : null}

            {/* Date tile + facts */}
            <div className="mt-5 flex flex-col gap-3">
              {date ? (
                <div className="flex items-center gap-3">
                  <span
                    className="flex w-11 shrink-0 flex-col overflow-hidden rounded-lg border text-center"
                    style={{ borderColor: HAIRLINE }}
                  >
                    <span
                      className="text-xs font-semibold tracking-wide text-white uppercase"
                      style={{ backgroundColor: accent }}
                    >
                      {dateLabel(date, { month: "short" })}
                    </span>
                    <span className="bg-white py-0.5 text-base font-semibold tabular-nums">
                      {dateLabel(date, { day: "numeric" })}
                    </span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {dateLabel(date, { weekday: "long", month: "long", day: "numeric" })}
                    </p>
                    <p className="text-sm" style={{ color: INK_SOFT }}>
                      {slot
                        ? `${timeLabel(slot.startsAt)} – ${timeLabel(slot.endsAt)}`
                        : slots === null
                          ? "Checking times…"
                          : slots.length > 1
                            ? "Several start times"
                            : "—"}
                    </p>
                  </div>
                </div>
              ) : null}
              {page.location ? (
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-white"
                    style={{ borderColor: HAIRLINE }}
                  >
                    <MapPin className="size-4" style={{ color: INK_SOFT }} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{page.location}</p>
                    <p className="text-sm" style={{ color: INK_SOFT }}>
                      {propertyName}
                    </p>
                  </div>
                </div>
              ) : null}
              {service.priceLabel ? (
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-white"
                    style={{ borderColor: HAIRLINE }}
                  >
                    <Ticket className="size-4" style={{ color: INK_SOFT }} />
                  </span>
                  <p className="text-sm font-medium">{service.priceLabel}</p>
                </div>
              ) : null}
            </div>

            {/* Registration card */}
            <div
              className="mt-6 overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: HAIRLINE }}
            >
              {/* Muted header strip (Luma's "Registration" bar). */}
              <p
                className="border-b bg-[#1f1e1b]/[0.04] px-4 py-2.5 text-sm font-semibold"
                style={{ borderColor: HAIRLINE }}
              >
                {done ? "You're in" : soldOut ? "Sold out" : "Get your tickets"}
              </p>

              {done ? (
                <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                  <span
                    className="flex size-12 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${accent}1a` }}
                  >
                    <Check className="size-6" style={{ color: accent }} />
                  </span>
                  <div>
                    <p className="font-serif text-lg font-semibold">Tickets reserved</p>
                    <p className="mt-1 max-w-[36ch] text-sm text-pretty" style={{ color: INK_SOFT }}>
                      Reference <strong style={{ color: INK }}>{done.reference}</strong>.
                      We emailed your tickets — the link inside has your door
                      QR code.
                    </p>
                  </div>
                </div>
              ) : dates.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm" style={{ color: INK_SOFT }}>
                  No upcoming dates — check back soon.
                </p>
              ) : soldOut ? (
                <p className="px-4 py-8 text-center text-sm text-pretty" style={{ color: INK_SOFT }}>
                  This date is sold out. Contact {propertyName} directly in
                  case seats free up.
                </p>
              ) : (
                <form onSubmit={submit} className="flex flex-col gap-4 px-4 py-4">
                  {remaining !== null ? (
                    <p
                      className="text-xs font-medium"
                      style={{ color: lowStock ? "#b45309" : INK_SOFT }}
                    >
                      {lowStock
                        ? `Almost gone — ${remaining} ticket${remaining === 1 ? "" : "s"} left`
                        : `${remaining} of ${service.capacity} tickets left`}
                    </p>
                  ) : null}

                  {dates.length > 1 ? (
                    <div className="flex flex-wrap gap-2">
                      {dates.map((d) => (
                        <Chip key={d} accent={accent} active={date === d} onClick={() => setDate(d)}>
                          {dateLabel(d, { weekday: "short", month: "short", day: "numeric" })}
                        </Chip>
                      ))}
                    </div>
                  ) : null}

                  {slots !== null && slots.length > 1 ? (
                    <div className="flex flex-wrap gap-2">
                      {slots.map((s) => (
                        <Chip
                          key={s.startsAt}
                          accent={accent}
                          active={slot?.startsAt === s.startsAt}
                          onClick={() => setSlot(s)}
                        >
                          {s.label}
                        </Chip>
                      ))}
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-1.5 text-xs font-medium" style={{ color: INK_SOFT }}>
                      How many tickets?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Array.from(
                        { length: Math.min(service.maxPartySize, 8) },
                        (_, i) => i + 1,
                      ).map((n) => (
                        <Chip key={n} accent={accent} active={party === n} onClick={() => setParty(n)}>
                          {n}
                        </Chip>
                      ))}
                    </div>
                  </div>

                  {form ? (
                    <GuestFormFields
                      fields={form.fields}
                      answers={formAnswers}
                      accent={accent}
                      errors={fieldErrors}
                      onChange={(fieldId, value) =>
                        setFormAnswers((a) => {
                          const next = { ...a };
                          if (value === undefined) delete next[fieldId];
                          else next[fieldId] = value;
                          return next;
                        })
                      }
                    />
                  ) : null}

                  <input
                    value={name}
                    required
                    name="guestName"
                    aria-label="Your name"
                    placeholder="Your name"
                    onChange={(e) => setName(e.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-base outline-none placeholder:text-[#6f6a60]/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f1e1b]/25"
                    style={{ borderColor: HAIRLINE, color: INK }}
                  />
                  <input
                    value={email}
                    required
                    type="email"
                    name="guestEmail"
                    aria-label="Email"
                    placeholder="Email — your tickets go here"
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-base outline-none placeholder:text-[#6f6a60]/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f1e1b]/25"
                    style={{ borderColor: HAIRLINE, color: INK }}
                  />

                  {error ? (
                    <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {error}
                    </p>
                  ) : null}

                  <button
                    type="submit"
                    disabled={busy || !slot || !name.trim() || !email.trim()}
                    className="flex h-12 items-center justify-center gap-2 rounded-full text-base font-semibold text-white disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f1e1b]/40"
                    style={{ backgroundColor: accent }}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Reserving…
                      </>
                    ) : (
                      `Reserve ${party} ticket${party === 1 ? "" : "s"}`
                    )}
                  </button>
                  <p className="text-center text-xs" style={{ color: INK_SOFT }}>
                    {!busy && (!name.trim() || !email.trim())
                      ? "Enter your name and email to continue."
                      : "Reserve now, pay at the venue."}
                  </p>
                </form>
              )}
            </div>
          </div>
        </div>

        {/* About — Luma rhythm: hairline section label, bold lead
            paragraph, calm body copy. */}
        {aboutParagraphs.length > 0 ? (
          <div className="mt-10">
            <p
              className="border-b pb-2 text-xs font-semibold tracking-wide uppercase"
              style={{ borderColor: HAIRLINE, color: INK_SOFT }}
            >
              About this event
            </p>
            <div className="mt-4 max-w-[65ch] space-y-4">
              {aboutParagraphs.map((paragraph, i) => (
                <p
                  key={i}
                  className={
                    i === 0
                      ? "text-base leading-relaxed font-medium text-pretty"
                      : "text-base leading-relaxed text-pretty"
                  }
                  style={i === 0 ? undefined : { color: "#3d3a33" }}
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {/* Hosted by — mobile gets it down here (desktop shows it under
            the cover). */}
        <div className="mt-10 md:hidden">
          <p
            className="border-b pb-2 text-xs font-semibold tracking-wide uppercase"
            style={{ borderColor: HAIRLINE, color: INK_SOFT }}
          >
            Hosted by
          </p>
          <div className="mt-3 flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              {host.charAt(0).toUpperCase()}
            </span>
            <p className="min-w-0 truncate text-sm font-medium">{host}</p>
          </div>
        </div>

        <footer
          className="mt-12 flex flex-col items-center gap-1 border-t pt-6 text-center"
          style={{ borderColor: HAIRLINE }}
        >
          <a
            href={`/book/${propertySlug}`}
            className="text-sm font-medium underline underline-offset-4"
            style={{ color: accent }}
          >
            More experiences at {propertyName}
          </a>
          <p className="text-xs" style={{ color: INK_SOFT }}>
            Reserve online, pay at the venue.
          </p>
        </footer>
      </div>
    </div>
  );
}

function Chip({
  accent,
  active,
  onClick,
  children,
}: {
  accent: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="h-11 min-w-11 rounded-full border bg-white px-3.5 text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f1e1b]/40"
      style={
        active
          ? { borderColor: accent, backgroundColor: `${accent}14`, color: accent }
          : { borderColor: HAIRLINE, color: INK }
      }
    >
      {children}
    </button>
  );
}
