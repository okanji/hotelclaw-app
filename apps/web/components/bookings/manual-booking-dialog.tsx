"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Slot } from "@/lib/bookings/availability";
import { parseServiceSchedule } from "@/lib/bookings/schema";
import type { ServiceListItem } from "./bookings-view";
import { createManualBooking } from "./actions";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Staff walk-in/phone booking — pick service + date, the live slot grid
 * comes from the same deterministic availability engine the bots use.
 */
export function ManualBookingDialog({
  propertyId,
  services,
  defaultDate,
  onClose,
}: {
  propertyId: string;
  services: ServiceListItem[];
  defaultDate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate);
  const [partySize, setPartySize] = useState("2");
  const [duration, setDuration] = useState<number | null>(null);

  const activeService = services.find((s) => s.id === serviceId);
  const rentalDurations =
    activeService?.booking_mode === "rental"
      ? parseServiceSchedule(activeService.schedule).rentalDurations
      : [];
  const effectiveDuration =
    rentalDurations.length > 0 ? (duration ?? rentalDurations[0]) : null;
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, startSaving] = useTransition();

  // Reset the slot grid during render when the query changes (sanctioned
  // adjust-on-changed-value pattern) — the effect below only fetches.
  const queryKey = `${serviceId}|${date}|${partySize}`;
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  if (queryKey !== prevQueryKey) {
    setPrevQueryKey(queryKey);
    setSlots(null);
    setSelected(null);
  }

  useEffect(() => {
    if (!serviceId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let cancelled = false;
    const size = Math.max(1, Number(partySize) || 1);
    fetch(
      `/api/properties/${propertyId}/bookings/availability?serviceId=${serviceId}&date=${date}&partySize=${size}${effectiveDuration ? `&durationMinutes=${effectiveDuration}` : ""}`,
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
  }, [propertyId, serviceId, date, partySize, effectiveDuration]);

  function save() {
    if (!selected) return;
    startSaving(async () => {
      const result = await createManualBooking({
        serviceId,
        startsAt: selected.startsAt,
        partySize: Math.max(1, Number(partySize) || 1),
        guestName: guestName.trim(),
        guestPhone: guestPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        durationMinutes: effectiveDuration ?? undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Booked — ${result.reference}`);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>
            Walk-ins and phone bookings — staff bookings skip the online
            notice rule but still respect hours and capacity.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mb-service">Service</Label>
              <NativeSelect
                id="mb-service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.emoji ? `${s.emoji} ` : ""}
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mb-party">Party size</Label>
              <Input
                id="mb-party"
                inputMode="numeric"
                value={partySize}
                onChange={(e) => setPartySize(e.target.value)}
              />
            </div>
          </div>

          {rentalDurations.length > 0 ? (
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <div className="flex flex-wrap gap-1.5">
                {rentalDurations.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={effectiveDuration === m}
                    onClick={() => setDuration(m)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-sm tabular-nums transition-colors",
                      effectiveDuration === m
                        ? "border-foreground bg-foreground text-background"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    {m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : `${m}min`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="mb-date">Date</Label>
            <input
              id="mb-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Time</Label>
            {slots === null ? (
              <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Checking availability…
              </p>
            ) : slots.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">
                Nothing free — closed that day, or full for this party size.
              </p>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                {slots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    aria-pressed={selected?.startsAt === slot.startsAt}
                    onClick={() => setSelected(slot)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-sm tabular-nums transition-colors",
                      selected?.startsAt === slot.startsAt
                        ? "border-foreground bg-foreground text-background"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mb-name">Guest name</Label>
              <Input
                id="mb-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Alex Chen"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mb-phone">Phone (optional)</Label>
              <Input
                id="mb-phone"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="+1 415 555 0100"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mb-notes">Notes (optional)</Label>
            <Input
              id="mb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Window seat, anniversary"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !selected || !guestName.trim()}>
            {saving ? "Booking…" : "Create booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
