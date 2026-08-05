"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  defaultScheduleForKind,
  parseServiceSchedule,
  SERVICE_KIND_META,
  WEEKDAYS,
  type ServiceSchedule,
  type Weekday,
} from "@/lib/bookings/schema";
import type { BookableServiceKind } from "@/lib/db/types";
import type { ServiceListItem } from "./bookings-view";
import { createService, updateService } from "./actions";
import { NativeSelect } from "@/components/ui/native-select";

const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function ServiceDialog({
  propertyId,
  service,
  onClose,
  onDelete,
}: {
  propertyId: string;
  service: ServiceListItem | null;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}) {
  const router = useRouter();
  const [name, setName] = useState(service?.name ?? "");
  const [kind, setKind] = useState<BookableServiceKind>(service?.kind ?? "table");
  const [bookingMode, setBookingMode] = useState<"capacity" | "tables" | "rental">(
    service?.booking_mode ?? "tables",
  );
  const [newDate, setNewDate] = useState("");
  const [emoji, setEmoji] = useState(service?.emoji ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [timezone, setTimezone] = useState(service?.timezone ?? guessTimezone());
  const [active, setActive] = useState(service?.active ?? true);
  const [publicBookable, setPublicBookable] = useState(
    service?.public_bookable ?? true,
  );
  const [schedule, setSchedule] = useState<ServiceSchedule>(() =>
    service ? parseServiceSchedule(service.schedule) : defaultScheduleForKind("table"),
  );
  // Published forms for the "booking questions" picker (RLS-scoped read).
  const [forms, setForms] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    void createClient()
      .from("forms")
      .select("id, title")
      .eq("property_id", propertyId)
      .eq("status", "published")
      .order("title")
      .then(({ data }) => {
        if (!cancelled && data) setForms(data);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId]);
  const [saving, startSaving] = useTransition();

  function pickKind(next: BookableServiceKind) {
    setKind(next);
    // New services get the kind's sensible defaults; editing keeps the
    // existing schedule (changing kind shouldn't wipe tuned hours).
    if (!service) {
      setSchedule(defaultScheduleForKind(next));
      setBookingMode(
        next === "table" ? "tables" : next === "rental" ? "rental" : "capacity",
      );
    }
  }

  function patchSchedule(patch: Partial<ServiceSchedule>) {
    setSchedule((s) => ({ ...s, ...patch }));
  }

  function save() {
    startSaving(async () => {
      const payload = {
        name: name.trim(),
        kind,
        booking_mode: bookingMode,
        public_bookable: publicBookable,
        emoji: emoji.trim() || null,
        description: description.trim() || null,
        schedule,
        timezone,
      };
      const result = service
        ? await updateService({ serviceId: service.id, patch: { ...payload, active } })
        : await createService({ propertyId, ...payload });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(service ? "Service updated" : "Service created");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{service ? "Edit service" : "New bookable service"}</DialogTitle>
          <DialogDescription>
            Hours and capacity drive the availability your chatbots offer —
            the bot can never book outside these rules.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="svc-name">Name</Label>
              <Input
                id="svc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dinner table · Sunset kayak tour · 60-min massage"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-emoji">Emoji</Label>
              <Input
                id="svc-emoji"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                maxLength={4}
                placeholder={SERVICE_KIND_META[kind].emoji}
                className="w-20"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="svc-kind">Type</Label>
            <NativeSelect
              id="svc-kind"
              value={kind}
              onChange={(e) => pickKind(e.target.value as BookableServiceKind)}
            >
              {Object.entries(SERVICE_KIND_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="svc-mode">Booking mode</Label>
            <NativeSelect
              id="svc-mode"
              value={bookingMode}
              onChange={(e) => setBookingMode(e.target.value as typeof bookingMode)}
            >
              <option value="tables">
                Tables &amp; floor plan — discrete tables, best-fit seating
              </option>
              <option value="capacity">
                Pooled capacity — N concurrent slots (spa, tours, tickets)
              </option>
              <option value="rental">
                Rental units — named cars/boats, guest-chosen duration
              </option>
            </NativeSelect>
            {bookingMode === "tables" ? (
              <p className="text-xs text-muted-foreground">
                Availability comes from the floor plan (a free table that fits
                the party) — set tables up in the Floor plan view. The
                capacity number below is ignored in this mode.
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="svc-desc">Description (the bot can quote this)</Label>
            <Textarea
              id="svc-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Two-hour guided kayak tour along the coast, includes gear and snacks."
            />
          </div>

          {/* Weekly hours */}
          <div className="space-y-2 rounded-card bg-muted p-3">
            <p className="text-sm font-medium">Weekly hours</p>
            <p className="text-xs text-muted-foreground">
              The booking window per day — the last start time is the end of
              the range. Times are local to the timezone below.
            </p>
            {WEEKDAYS.map((day) => {
              const range = schedule.weekly[day]?.[0];
              return (
                <div key={day} className="flex items-center gap-2">
                  <Chip
                    size="sm"
                    selected={!!range}
                    onClick={() =>
                      patchSchedule({
                        weekly: {
                          ...schedule.weekly,
                          [day]: range ? [] : [{ start: "09:00", end: "17:00" }],
                        },
                      })
                    }
                    className="w-12 justify-center px-2"
                  >
                    {WEEKDAY_LABELS[day]}
                  </Chip>
                  {range ? (
                    <>
                      <input
                        type="time"
                        value={range.start}
                        onChange={(e) =>
                          patchSchedule({
                            weekly: {
                              ...schedule.weekly,
                              [day]: [{ ...range, start: e.target.value }],
                            },
                          })
                        }
                        className="h-7 rounded-md bg-transparent px-2 text-sm shadow-ring transition-[background-color,box-shadow] outline-none focus-visible:shadow-focus dark:bg-muted"
                        aria-label={`${WEEKDAY_LABELS[day]} opens`}
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <input
                        type="time"
                        value={range.end}
                        onChange={(e) =>
                          patchSchedule({
                            weekly: {
                              ...schedule.weekly,
                              [day]: [{ ...range, end: e.target.value }],
                            },
                          })
                        }
                        className="h-7 rounded-md bg-transparent px-2 text-sm shadow-ring transition-[background-color,box-shadow] outline-none focus-visible:shadow-focus dark:bg-muted"
                        aria-label={`${WEEKDAY_LABELS[day]} last booking`}
                      />
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">Closed</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Slot rules */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <NumberField
              label="Slot every (min)"
              value={schedule.slotIntervalMinutes}
              onChange={(v) => patchSchedule({ slotIntervalMinutes: v })}
            />
            <NumberField
              label="Duration (min)"
              value={schedule.durationMinutes}
              onChange={(v) => patchSchedule({ durationMinutes: v })}
            />
            <NumberField
              label={
                schedule.countPartySize
                  ? kind === "tour"
                    ? "Seats per slot"
                    : "Covers per slot"
                  : "Concurrent bookings"
              }
              value={schedule.capacityPerSlot}
              onChange={(v) => patchSchedule({ capacityPerSlot: v })}
            />
            <NumberField
              label="Max party size"
              value={schedule.maxPartySize}
              onChange={(v) => patchSchedule({ maxPartySize: v })}
            />
            <NumberField
              label="Min notice (min)"
              value={schedule.minNoticeMinutes}
              onChange={(v) => patchSchedule({ minNoticeMinutes: v })}
            />
            <NumberField
              label="Book ahead (days)"
              value={schedule.horizonDays}
              onChange={(v) => patchSchedule({ horizonDays: v })}
            />
          </div>

          {/* Specific dates — one-off events and special hours. Overrides
              weekly for that date (an event = empty weekly + dated ranges). */}
          <div className="space-y-2 rounded-card bg-muted p-3">
            <p className="text-sm font-medium">
              {kind === "event" ? "Event dates" : "Special dates (optional)"}
            </p>
            <p className="text-xs text-muted-foreground">
              {kind === "event"
                ? "When the event runs — each date gets its own doors-open window. Leave weekly hours empty for one-offs."
                : "Date-specific hours that override the weekly schedule (holiday hours, one-off openings)."}
            </p>
            {Object.entries(schedule.dates)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([dateKey, ranges]) => {
                const range = ranges[0] ?? { start: "19:00", end: "23:00" };
                return (
                  <div key={dateKey} className="flex items-center gap-2">
                    <span className="w-28 text-xs font-medium tabular-nums">{dateKey}</span>
                    <input
                      type="time"
                      value={range.start}
                      onChange={(e) =>
                        patchSchedule({
                          dates: {
                            ...schedule.dates,
                            [dateKey]: [{ ...range, start: e.target.value }],
                          },
                        })
                      }
                      className="h-7 rounded-md bg-transparent px-2 text-sm shadow-ring transition-[background-color,box-shadow] outline-none focus-visible:shadow-focus dark:bg-muted"
                      aria-label={`${dateKey} opens`}
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <input
                      type="time"
                      value={range.end}
                      onChange={(e) =>
                        patchSchedule({
                          dates: {
                            ...schedule.dates,
                            [dateKey]: [{ ...range, end: e.target.value }],
                          },
                        })
                      }
                      className="h-7 rounded-md bg-transparent px-2 text-sm shadow-ring transition-[background-color,box-shadow] outline-none focus-visible:shadow-focus dark:bg-muted"
                      aria-label={`${dateKey} last entry`}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${dateKey}`}
                      onClick={() => {
                        const next = { ...schedule.dates };
                        delete next[dateKey];
                        patchSchedule({ dates: next });
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="h-7 rounded-md bg-transparent px-2 text-sm shadow-ring transition-[background-color,box-shadow] outline-none focus-visible:shadow-focus dark:bg-muted"
                aria-label="Add a date"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!newDate || !!schedule.dates[newDate]}
                onClick={() => {
                  patchSchedule({
                    dates: {
                      ...schedule.dates,
                      [newDate]: [{ start: "19:00", end: "23:00" }],
                    },
                  });
                  setNewDate("");
                }}
              >
                Add date
              </Button>
            </div>
          </div>

          {bookingMode === "rental" ? (
            <div className="space-y-1.5">
              <Label htmlFor="svc-durations">
                Rental durations guests can choose (hours, comma-separated)
              </Label>
              <Input
                id="svc-durations"
                value={schedule.rentalDurations.map((m) => m / 60).join(", ")}
                onChange={(e) =>
                  patchSchedule({
                    rentalDurations: e.target.value
                      .split(",")
                      .map((s) => Math.round(Number(s.trim()) * 60))
                      .filter((m) => Number.isFinite(m) && m >= 30)
                      .slice(0, 8),
                  })
                }
                placeholder="4, 8, 24"
              />
              <p className="text-xs text-muted-foreground">
                The shortest is the default. Use 24, 48… for multi-day hires.
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="svc-price">Price (shown to guests, optional)</Label>
              <Input
                id="svc-price"
                value={schedule.priceLabel}
                onChange={(e) => patchSchedule({ priceLabel: e.target.value })}
                placeholder={
                  kind === "event"
                    ? "$45 per ticket — pay at the door"
                    : kind === "rental"
                      ? "€120 per day, fuel included"
                      : "Optional"
                }
              />
            </div>
            <NumberField
              label="Turnaround between bookings (min)"
              value={schedule.turnaroundMinutes}
              onChange={(v) => patchSchedule({ turnaroundMinutes: v })}
            />
          </div>

          {forms.length > 0 || schedule.formId ? (
            <div className="space-y-1.5">
              <Label htmlFor="svc-form">Booking questions (optional)</Label>
              <NativeSelect
                id="svc-form"
                value={schedule.formId ?? ""}
                onChange={(e) =>
                  patchSchedule({ formId: e.target.value || undefined })
                }
              >
                <option value="">None</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
                {schedule.formId && !forms.some((f) => f.id === schedule.formId) ? (
                  <option value={schedule.formId}>
                    (current form — unpublished or deleted)
                  </option>
                ) : null}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">
                A published form guests answer while booking — dietary needs,
                waivers, onboarding. Answers land in the form&apos;s responses
                and as a summary on the booking.
              </p>
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={publicBookable}
              onChange={(e) => setPublicBookable(e.target.checked)}
              className="mt-0.5 accent-ring"
            />
            <span>
              Show on the public booking page
              <span className="block text-xs text-muted-foreground">
                Guests can reserve at /book/&lt;property&gt; without the
                chatbot. Web requests arrive as pending.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={schedule.countPartySize}
              onChange={(e) => patchSchedule({ countPartySize: e.target.checked })}
              className="mt-0.5 accent-ring"
            />
            <span>
              Party size consumes capacity
              <span className="block text-xs text-muted-foreground">
                On for tables and tours (a party of 4 takes 4 covers/seats);
                off for 1:1 appointments where capacity = chairs/therapists.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="svc-tz">Timezone</Label>
              <NativeSelect
                id="svc-tz"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {[...new Set([timezone, guessTimezone(), "UTC", ...(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [])])].map(
                  (tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ),
                )}
              </NativeSelect>
            </div>
            {service ? (
              <div className="space-y-1.5">
                <Label htmlFor="svc-active">Status</Label>
                <NativeSelect
                  id="svc-active"
                  value={active ? "active" : "paused"}
                  onChange={(e) => setActive(e.target.value === "active")}
                >
                  <option value="active">Active — bookable</option>
                  <option value="paused">Paused — hidden from bots</option>
                </NativeSelect>
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="gap-2">
          {onDelete ? (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              onClick={() => void onDelete()}
              disabled={saving}
            >
              <Trash2 data-slot="icon" />
              Delete
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : service ? "Save service" : "Create service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(0, Math.round(n)));
        }}
      />
    </div>
  );
}
