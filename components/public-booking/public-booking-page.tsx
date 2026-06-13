"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Check, Loader2 } from "lucide-react";
import type { Slot } from "@/lib/bookings/availability";
import type { FormAnswers, FormField } from "@/lib/forms/schema";
import { GuestFormFields } from "./guest-form-fields";

/**
 * The public reserve/book/buy-tickets wizard — one decision per screen
 * (the forms feature's wizard discipline), warm cream + serif guest
 * palette, mobile-first. Steps: service → date/party/duration → time →
 * details → done. Web bookings land as pending; the confirmation makes
 * that honest and the email carries the signed manage link.
 */

export type PublicService = {
  id: string;
  name: string;
  emoji: string | null;
  kind: string;
  description: string | null;
  maxPartySize: number;
  priceLabel: string;
  rentalDurations: number[];
  eventDates: string[];
  timezone: string;
  /** Organizer's booking questions (guest-safe fields), if attached. */
  form?: { formId: string; title: string; fields: FormField[] } | null;
};

const ACCENT = "#c96442";
const INK = "#1f1e1b";
const INK_SOFT = "#6f6a60";
const CANVAS = "#faf7f1";
const HAIRLINE = "rgba(31,30,27,0.12)";

type Step = "service" | "when" | "time" | "details" | "done";

function fmtDuration(m: number) {
  return m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"}` : m % 60 === 0 ? `${m / 60}h` : `${m}min`;
}

export function PublicBookingPage({
  propertySlug,
  propertyName,
  services,
}: {
  propertySlug: string;
  propertyName: string;
  services: PublicService[];
}) {
  const [step, setStep] = useState<Step>(services.length === 1 ? "when" : "service");
  const [service, setService] = useState<PublicService>(services[0]);
  const [date, setDate] = useState("");
  const [party, setParty] = useState(2);
  const [duration, setDuration] = useState<number | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ reference: string; status: string } | null>(null);
  const [formAnswers, setFormAnswers] = useState<FormAnswers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const effectiveDuration =
    service.rentalDurations.length > 0 ? (duration ?? service.rentalDurations[0]) : null;
  const isTicket = service.kind === "event";
  // "2 tickets" for events, "2 guests" otherwise — used in every summary line.
  const partyLabel = isTicket
    ? `${party} ticket${party === 1 ? "" : "s"}`
    : `${party} guest${party === 1 ? "" : "s"}`;

  const stepOrder: Step[] = (
    services.length > 1
      ? ["service", "when", "time", "details"]
      : ["when", "time", "details"]
  ) as Step[];
  const stepIndex = stepOrder.indexOf(step);

  // Reset the slot grid during render when the query changes (sanctioned
  // adjust-on-changed-value pattern); the effect below only fetches.
  const slotQueryKey = `${step}|${service.id}|${date}|${party}|${effectiveDuration ?? ""}`;
  const [prevSlotQueryKey, setPrevSlotQueryKey] = useState(slotQueryKey);
  if (slotQueryKey !== prevSlotQueryKey) {
    setPrevSlotQueryKey(slotQueryKey);
    setSlots(null);
    setSlot(null);
  }

  // Slot fetch when the time step opens.
  useEffect(() => {
    if (step !== "time" || !date) return;
    let cancelled = false;
    fetch(
      `/api/guest/book/${propertySlug}?serviceId=${service.id}&date=${date}&partySize=${party}${effectiveDuration ? `&durationMinutes=${effectiveDuration}` : ""}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: { slots: Slot[] }) => {
        if (!cancelled) setSlots(data.slots);
      })
      .catch(() => {
        if (!cancelled) setSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [step, propertySlug, service.id, date, party, effectiveDuration]);

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
          durationMinutes: effectiveDuration ?? undefined,
          guestName: name.trim(),
          guestEmail: email.trim(),
          guestPhone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
          formAnswers: service.form ? formAnswers : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't work — try another time.");
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        if (res.status === 409) setStep("time");
        return;
      }
      setDone({ reference: data.reference, status: data.status });
      setStep("done");
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  const back: Partial<Record<Step, Step>> = {
    when: services.length > 1 ? "service" : undefined,
    time: "when",
    details: "time",
  };

  return (
    <div className="min-h-dvh" style={{ backgroundColor: CANVAS, color: INK }}>
      <div className="mx-auto max-w-xl px-5 py-10 sm:py-14">
        {/* Heading group: eyebrow + serif headline. */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[13px]" style={{ color: INK_SOFT }}>
            {propertyName}
          </p>
          {stepIndex >= 0 ? (
            <p className="text-[13px] tabular-nums" style={{ color: INK_SOFT }}>
              Step {stepIndex + 1} of {stepOrder.length}
            </p>
          ) : null}
        </div>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight text-balance">
          {step === "done"
            ? "All set"
            : isTicket && step !== "service"
              ? "Get your tickets"
              : "Book your visit"}
        </h1>

        {back[step] ? (
          <button
            type="button"
            onClick={() => setStep(back[step]!)}
            className="mt-4 inline-flex items-center gap-1 text-sm"
            style={{ color: INK_SOFT }}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </button>
        ) : null}

        <div className="mt-6">
          {step === "service" ? (
            <div className="flex flex-col gap-3">
              {services.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setService(s);
                    setDuration(null);
                    setDate(s.eventDates[0] ?? "");
                    setStep("when");
                  }}
                  className="rounded-2xl border bg-white p-4 text-left transition-shadow hover:shadow-sm"
                  style={{ borderColor: HAIRLINE }}
                >
                  <p className="text-base font-semibold">
                    {s.emoji ? `${s.emoji} ` : ""}
                    {s.name}
                  </p>
                  {s.description ? (
                    <p className="mt-1 text-sm text-pretty" style={{ color: INK_SOFT }}>
                      {s.description}
                    </p>
                  ) : null}
                  {s.priceLabel ? (
                    <p className="mt-2 text-sm font-medium" style={{ color: ACCENT }}>
                      {s.priceLabel}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}

          {step === "when" ? (
            <div className="flex flex-col gap-5">
              <p className="font-serif text-xl">
                {service.emoji ? `${service.emoji} ` : ""}
                {service.name}
              </p>

              <Field label={service.eventDates.length > 0 ? "Which date?" : "What day?"}>
                {service.eventDates.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {service.eventDates.map((d) => (
                      <Chip key={d} active={date === d} onClick={() => setDate(d)}>
                        {new Intl.DateTimeFormat("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        }).format(new Date(`${d}T00:00:00Z`))}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <input
                    type="date"
                    value={date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-12 w-full rounded-xl border bg-white px-4 text-base outline-none"
                    style={{ borderColor: HAIRLINE }}
                  />
                )}
              </Field>

              <Field
                label={
                  service.kind === "event"
                    ? "How many tickets?"
                    : service.kind === "rental"
                      ? "How many people?"
                      : "How many guests?"
                }
              >
                <div className="flex flex-wrap gap-2">
                  {Array.from(
                    { length: Math.min(service.maxPartySize, 10) },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <Chip key={n} active={party === n} onClick={() => setParty(n)}>
                      {n}
                    </Chip>
                  ))}
                </div>
              </Field>

              {service.rentalDurations.length > 0 ? (
                <Field label="For how long?">
                  <div className="flex flex-wrap gap-2">
                    {service.rentalDurations.map((m) => (
                      <Chip
                        key={m}
                        active={effectiveDuration === m}
                        onClick={() => setDuration(m)}
                      >
                        {fmtDuration(m)}
                      </Chip>
                    ))}
                  </div>
                </Field>
              ) : null}

              <PrimaryButton disabled={!date} onClick={() => setStep("time")}>
                See available times
              </PrimaryButton>
            </div>
          ) : null}

          {step === "time" ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm" style={{ color: INK_SOFT }}>
                {new Intl.DateTimeFormat("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${date}T00:00:00Z`))}{" "}
                · {partyLabel}
                {effectiveDuration ? ` · ${fmtDuration(effectiveDuration)}` : ""}
              </p>
              {error ? (
                <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              {slots === null ? (
                <p className="flex items-center gap-2 py-6 text-sm" style={{ color: INK_SOFT }}>
                  <Loader2 className="size-4 animate-spin" />
                  Checking availability…
                </p>
              ) : slots.length === 0 ? (
                <div className="flex flex-col items-start gap-3 py-6">
                  <p className="text-sm" style={{ color: INK_SOFT }}>
                    {isTicket
                      ? "This date is sold out."
                      : "Nothing free that day."}
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep("when")}
                    className="text-sm font-medium underline underline-offset-4"
                    style={{ color: ACCENT }}
                  >
                    Choose another date
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button
                      key={s.startsAt}
                      type="button"
                      onClick={() => {
                        setSlot(s);
                        setError(null);
                        setStep("details");
                      }}
                      className="h-12 rounded-xl border bg-white text-base font-medium tabular-nums transition-colors"
                      style={{ borderColor: HAIRLINE }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {step === "details" && slot ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div
                className="rounded-2xl border bg-white p-4"
                style={{ borderColor: HAIRLINE }}
              >
                <p className="text-sm font-semibold">
                  {service.emoji ? `${service.emoji} ` : ""}
                  {service.name}
                </p>
                <p className="text-sm" style={{ color: INK_SOFT }}>
                  {new Intl.DateTimeFormat("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: service.timezone,
                  }).format(new Date(slot.startsAt))}{" "}
                  · {partyLabel}
                </p>
                {service.priceLabel ? (
                  <p className="mt-1 text-sm font-medium" style={{ color: ACCENT }}>
                    {service.priceLabel}
                  </p>
                ) : null}
              </div>

              <Field label="Your name">
                <TextInput value={name} onChange={setName} required placeholder="Alex Chen" />
              </Field>
              <Field label="Email — your confirmation and booking link go here">
                <TextInput
                  value={email}
                  onChange={setEmail}
                  required
                  type="email"
                  placeholder="alex@example.com"
                />
              </Field>
              <Field label="Phone (optional)">
                <TextInput value={phone} onChange={setPhone} placeholder="+1 415 555 0100" />
              </Field>
              <Field label="Anything we should know? (optional)">
                <TextInput value={notes} onChange={setNotes} placeholder="Window seat, anniversary…" />
              </Field>

              {service.form ? (
                <div
                  className="flex flex-col gap-4 rounded-2xl border bg-white p-4"
                  style={{ borderColor: HAIRLINE }}
                >
                  <p className="font-serif text-lg">{service.form.title}</p>
                  <GuestFormFields
                    fields={service.form.fields}
                    answers={formAnswers}
                    accent={ACCENT}
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
                </div>
              ) : null}

              {error ? (
                <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              <PrimaryButton type="submit" disabled={busy || !name.trim() || !email.trim()}>
                {busy
                  ? isTicket
                    ? "Reserving…"
                    : "Booking…"
                  : isTicket
                    ? "Reserve tickets"
                    : "Request booking"}
              </PrimaryButton>
              <p className="text-center text-xs" style={{ color: INK_SOFT }}>
                {!busy && (!name.trim() || !email.trim())
                  ? "Enter your name and email to continue."
                  : "The team confirms your request — nothing is charged online."}
              </p>
            </form>
          ) : null}

          {step === "done" && done ? (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <span
                className="flex size-14 items-center justify-center rounded-full"
                style={{ backgroundColor: `${ACCENT}1a` }}
              >
                <Check className="size-7" style={{ color: ACCENT }} />
              </span>
              <div>
                <p className="font-serif text-xl font-semibold">
                  {isTicket
                    ? "Tickets reserved"
                    : done.status === "pending"
                      ? "Request received"
                      : "Booked"}
                </p>
                <p className="mt-1 max-w-[40ch] text-sm text-pretty" style={{ color: INK_SOFT }}>
                  Your reference is{" "}
                  <strong style={{ color: INK }}>{done.reference}</strong>.{" "}
                  {isTicket
                    ? "We emailed your tickets — open the link inside to show your door QR code."
                    : "We emailed your confirmation with a link to view or cancel —"}
                  {done.status === "pending"
                    ? " The team will confirm shortly."
                    : isTicket
                      ? ""
                      : " see you soon."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDone(null);
                  setSlot(null);
                  setError(null);
                  setStep(services.length === 1 ? "when" : "service");
                }}
                className="text-sm underline underline-offset-4"
                style={{ color: ACCENT }}
              >
                Make another booking
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="font-serif text-lg">{label}</label>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="h-11 min-w-11 rounded-full border bg-white px-4 text-base tabular-nums transition-colors"
      style={
        active
          ? { borderColor: ACCENT, backgroundColor: `${ACCENT}14`, color: ACCENT }
          : { borderColor: HAIRLINE, color: INK }
      }
    >
      {children}
    </button>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      required={required}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      // 16px — anything smaller makes iOS zoom on focus.
      className="h-12 w-full rounded-xl border bg-white px-4 text-base outline-none placeholder:text-[#6f6a60]/60"
      style={{ borderColor: HAIRLINE, color: INK }}
    />
  );
}

function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="h-12 rounded-full text-base font-semibold text-white transition-opacity disabled:opacity-40"
      style={{ backgroundColor: ACCENT }}
    >
      {children}
    </button>
  );
}
