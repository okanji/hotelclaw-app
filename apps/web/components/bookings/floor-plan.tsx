"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Armchair, ChevronLeft, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { StatusBadge } from "@/components/ui/status-badge";
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
import { cn } from "@/lib/utils";
import type { ResourceShape } from "@/lib/db/types";
import type { BookingListItem, ServiceListItem } from "./bookings-view";
import { BookingStatusBadge } from "./bookings-view";
import { BOOKING_STATUS_UI } from "@/lib/bookings/status-colors";
import { NativeSelect } from "@/components/ui/native-select";
import {
  assignBookingResource,
  saveServiceResources,
  seatWalkIn,
  setBookingStatus,
} from "./actions";

/**
 * The floor plan — one canvas, two modes (research: editing is always an
 * explicit mode, never live during service):
 *
 *   Live — the host view. Tables colored by what's happening at the selected
 *   time (seated / booked / pending / free); click a table to seat, finish,
 *   or move the booking selected in the side list onto it.
 *
 *   Edit layout — drag tables on a percent grid (deliberately schematic, not
 *   architecture), add/rename/resize via the inspector, AI-draft a layout
 *   from a description. Saves as a whole (service_resources upsert).
 */

export type ResourceItem = {
  id?: string;
  name: string;
  seats: number;
  min_party: number;
  shape: ResourceShape;
  x: number;
  y: number;
  w: number;
  h: number;
  zone: string | null;
  active: boolean;
};

const SNAP = 2; // percent grid

function snap(v: number) {
  return Math.round(v / SNAP) * SNAP;
}

function defaultSize(seats: number): { w: number; h: number } {
  if (seats <= 2) return { w: 8, h: 8 };
  if (seats <= 4) return { w: 11, h: 10 };
  if (seats <= 6) return { w: 14, h: 10 };
  return { w: 17, h: 12 };
}

type TableState = "free" | "pending" | "booked" | "seated" | "inactive";

const TABLE_TONES: Record<TableState, string> = {
  free: "border-border bg-background text-muted-foreground hover:border-foreground/40",
  pending: BOOKING_STATUS_UI.pending.tone,
  booked: BOOKING_STATUS_UI.confirmed.tone,
  seated: BOOKING_STATUS_UI.seated.tone,
  inactive: "border-dashed border-border bg-muted/30 text-muted-foreground/50",
};

export function FloorPlanView({
  propertyId,
  service,
  resources: initialResources,
  bookings,
  day,
}: {
  propertyId: string;
  service: ServiceListItem;
  resources: (ResourceItem & { id: string })[];
  bookings: BookingListItem[];
  day: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"live" | "edit">("live");
  const [draft, setDraft] = useState<ResourceItem[]>(initialResources);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<BookingListItem | null>(null);
  // Live mode: the table whose detail panel is open in the sidebar.
  const [focusTableId, setFocusTableId] = useState<string | null>(null);
  const [atTime, setAtTime] = useState<string | null>(null); // ISO; null = now
  const [generateOpen, setGenerateOpen] = useState(false);
  const [saving, startSaving] = useTransition();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ idx: number; dx: number; dy: number } | null>(null);

  const dayBookings = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.service_id === service.id && b.starts_at.slice(0, 10) === day,
        )
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [bookings, service.id, day],
  );

  // "Now" is captured post-mount (render must stay pure for the compiler).
  const [nowTs, setNowTs] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setNowTs(Date.now()), []);

  // What's on each table at the focus time (live mode).
  const focusTs = atTime ? new Date(atTime).getTime() : (nowTs ?? 0);
  const tableBookings = useMemo(() => {
    const map = new Map<string, BookingListItem[]>();
    for (const b of dayBookings) {
      if (b.status === "cancelled" || b.status === "no_show" || b.status === "completed")
        continue;
      if (
        new Date(b.starts_at).getTime() <= focusTs &&
        focusTs < new Date(b.ends_at).getTime() &&
        b.resource_id
      ) {
        const list = map.get(b.resource_id) ?? [];
        list.push(b);
        map.set(b.resource_id, list);
      }
    }
    return map;
  }, [dayBookings, focusTs]);

  function stateOf(resource: ResourceItem): TableState {
    if (!resource.active) return "inactive";
    const current = resource.id ? tableBookings.get(resource.id) : undefined;
    if (!current || current.length === 0) return "free";
    if (current.some((b) => b.status === "seated")) return "seated";
    if (current.some((b) => b.status === "confirmed")) return "booked";
    return "pending";
  }

  // ── edit-mode drag ─────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent, idx: number) {
    if (mode !== "edit") return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    dragRef.current = { idx, dx: px - draft[idx].x, dy: py - draft[idx].y };
    setSelectedIdx(idx);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect || mode !== "edit") return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    setDraft((d) =>
      d.map((r, i) =>
        i === drag.idx
          ? {
              ...r,
              x: Math.min(100 - r.w, Math.max(0, snap(px - drag.dx))),
              y: Math.min(100 - r.h, Math.max(0, snap(py - drag.dy))),
            }
          : r,
      ),
    );
  }
  function onPointerUp() {
    dragRef.current = null;
  }

  function addTable() {
    const n = draft.length + 1;
    const size = defaultSize(2);
    setDraft((d) => [
      ...d,
      {
        name: `T${n}`,
        seats: 2,
        min_party: 1,
        shape: "rect",
        x: snap(6 + ((n - 1) % 5) * 18),
        y: snap(8 + Math.floor((n - 1) / 5) * 18),
        ...size,
        zone: null,
        active: true,
      },
    ]);
    setSelectedIdx(draft.length);
  }

  function patchSelected(patch: Partial<ResourceItem>) {
    if (selectedIdx === null) return;
    setDraft((d) =>
      d.map((r, i) =>
        i === selectedIdx
          ? {
              ...r,
              ...patch,
              ...(patch.seats !== undefined ? defaultSize(patch.seats) : {}),
            }
          : r,
      ),
    );
  }

  function save() {
    startSaving(async () => {
      const result = await saveServiceResources({
        serviceId: service.id,
        propertyId,
        resources: draft,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Floor plan saved");
      setMode("live");
      router.refresh();
    });
  }

  function actOn(booking: BookingListItem, status: "seated" | "completed" | "confirmed") {
    startSaving(async () => {
      const result = await setBookingStatus({ bookingId: booking.id, status });
      if ("error" in result) toast.error(result.error);
      else router.refresh();
    });
  }

  function seatWalkInAt(resource: ResourceItem, partySize: number, guestName: string) {
    if (!resource.id) return;
    startSaving(async () => {
      const result = await seatWalkIn({
        serviceId: service.id,
        resourceId: resource.id!,
        partySize,
        guestName: guestName.trim() || undefined,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(`Seated at ${resource.name}`);
        router.refresh();
      }
    });
  }

  function moveSelectedTo(resource: ResourceItem) {
    if (!selectedBooking || !resource.id) return;
    startSaving(async () => {
      const result = await assignBookingResource({
        bookingId: selectedBooking.id,
        resourceId: resource.id!,
      });
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(`${selectedBooking.guest_name} → ${resource.name}`);
        setSelectedBooking(null);
        router.refresh();
      }
    });
  }

  // Time scrubber options: each booked hour of the day plus "now".
  const timeOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const b of dayBookings) {
      const d = new Date(b.starts_at);
      set.set(
        b.starts_at,
        new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: service.timezone,
        }).format(d),
      );
    }
    return [...set.entries()];
  }, [dayBookings, service.timezone]);

  const selected = selectedIdx !== null ? draft[selectedIdx] : null;
  const seatedCount = [...tableBookings.values()].flat().filter((b) => b.status === "seated").length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">
            {service.emoji ? `${service.emoji} ` : ""}
            {service.name} — floor plan
          </p>
          {mode === "live" && seatedCount > 0 ? (
            <StatusBadge tone="violet" dot={false}>
              {seatedCount} seated
            </StatusBadge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {mode === "live" && timeOptions.length > 0 ? (
            <NativeSelect
              value={atTime ?? "now"}
              onChange={(e) => setAtTime(e.target.value === "now" ? null : e.target.value)}
              wrapperClassName="w-auto"
              aria-label="View floor at time"
            >
              <option value="now">Now</option>
              {timeOptions.map(([iso, label]) => (
                <option key={iso} value={iso}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          {mode === "edit" ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setGenerateOpen(true)}>
                <Sparkles data-slot="icon" />
                Draft with AI
              </Button>
              <Button variant="outline" size="sm" onClick={addTable}>
                <Plus data-slot="icon" />
                Add table
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save layout"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(initialResources);
                  setSelectedIdx(null);
                  setMode("live");
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setMode("edit")}>
              Edit layout
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        {/* Canvas */}
        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className={cn(
            "relative aspect-[4/3] w-full touch-none overflow-hidden rounded-lg border border-border bg-muted/20",
            mode === "edit" &&
              "bg-[radial-gradient(circle,_var(--color-border)_1px,_transparent_1px)] bg-[length:24px_24px]",
          )}
        >
          {draft.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <Armchair className="size-6 text-muted-foreground" />
              <p className="max-w-[38ch] text-sm text-muted-foreground">
                No tables yet. Sketch the room yourself, or describe it and
                let AI lay out a first draft to drag into shape.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setMode("edit");
                    addTable();
                  }}
                >
                  <Plus data-slot="icon" />
                  Add a table
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setMode("edit");
                    setGenerateOpen(true);
                  }}
                >
                  <Sparkles data-slot="icon" />
                  Draft with AI
                </Button>
              </div>
            </div>
          ) : null}
          {draft.map((r, i) => {
            const state = mode === "live" ? stateOf(r) : "free";
            const current = r.id ? tableBookings.get(r.id)?.[0] : undefined;
            return (
              <button
                key={r.id ?? `new-${i}`}
                type="button"
                onPointerDown={(e) => onPointerDown(e, i)}
                onClick={() => {
                  if (mode === "edit") setSelectedIdx(i);
                  else if (selectedBooking) moveSelectedTo(r);
                  else if (r.id)
                    setFocusTableId(focusTableId === r.id ? null : r.id);
                }}
                aria-label={`Table ${r.name}, ${r.seats} seats`}
                style={{
                  left: `${r.x}%`,
                  top: `${r.y}%`,
                  width: `${r.w}%`,
                  height: `${r.h}%`,
                }}
                className={cn(
                  "absolute flex flex-col items-center justify-center border-2 text-center transition-colors",
                  r.shape === "round" ? "rounded-full" : "rounded-lg",
                  TABLE_TONES[state],
                  mode === "edit" && "cursor-grab active:cursor-grabbing",
                  mode === "edit" && selectedIdx === i && "ring-2 ring-ring",
                  mode === "live" && "cursor-pointer",
                  mode === "live" && selectedBooking && state === "free" && r.active &&
                    "ring-2 ring-success/60",
                  mode === "live" && !selectedBooking && focusTableId === r.id &&
                    "ring-2 ring-ring",
                )}
              >
                <span className="text-xs leading-tight font-semibold">{r.name}</span>
                <span className="text-[10px] leading-tight opacity-80">
                  {mode === "live" && current
                    ? `${current.guest_name.split(" ")[0]} ×${current.party_size}`
                    : `${r.seats} seats`}
                </span>
              </button>
            );
          })}
        </div>

        {/* Side panel */}
        {mode === "edit" ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            {selected ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Table</p>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete table"
                    onClick={() => {
                      setDraft((d) => d.filter((_, i) => i !== selectedIdx));
                      setSelectedIdx(null);
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={selected.name}
                      onChange={(e) => patchSelected({ name: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Zone</Label>
                    <Input
                      value={selected.zone ?? ""}
                      onChange={(e) => patchSelected({ zone: e.target.value || null })}
                      placeholder="Patio"
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Seats (max)</Label>
                    <Input
                      inputMode="numeric"
                      value={String(selected.seats)}
                      onChange={(e) =>
                        patchSelected({
                          seats: Math.max(1, Math.min(50, Number(e.target.value) || 1)),
                        })
                      }
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Min party</Label>
                    <Input
                      inputMode="numeric"
                      value={String(selected.min_party)}
                      onChange={(e) =>
                        patchSelected({
                          min_party: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  {(["rect", "round"] as const).map((shape) => (
                    <Chip
                      key={shape}
                      size="sm"
                      selected={selected.shape === shape}
                      onClick={() => patchSelected({ shape })}
                    >
                      {shape === "rect" ? "Rectangle" : "Round"}
                    </Chip>
                  ))}
                  <Chip
                    size="sm"
                    selected={!selected.active}
                    onClick={() => patchSelected({ active: !selected.active })}
                    className="ml-auto"
                  >
                    {selected.active ? "Active" : "Inactive"}
                  </Chip>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Drag tables to arrange the room (it&apos;s a schematic, not a
                blueprint). Click one to edit its name, seats, and shape.
                Min&nbsp;party keeps small parties off big tables until
                nothing else is free.
              </p>
            )}
          </div>
        ) : focusTableId && !selectedBooking ? (
          /* Live mode, table focused: what's on this table + walk-in seating. */
          <TableDetailPanel
            key={focusTableId}
            table={draft.find((r) => r.id === focusTableId)}
            current={tableBookings.get(focusTableId) ?? []}
            upcoming={dayBookings.filter(
              (b) =>
                b.resource_id === focusTableId &&
                new Date(b.starts_at).getTime() > focusTs &&
                b.status !== "cancelled" &&
                b.status !== "no_show" &&
                b.status !== "completed",
            )}
            timezone={service.timezone}
            busy={saving}
            onBack={() => setFocusTableId(null)}
            onAct={actOn}
            onSeatWalkIn={seatWalkInAt}
          />
        ) : (
          /* Live mode: the chronological list, host-board style. */
          <div className="flex max-h-[480px] flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
            <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">
              {selectedBooking
                ? "Now click a free table to move them"
                : "Today — click a booking then a table to move it, or click a table to seat a walk-in"}
            </p>
            {dayBookings.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                No bookings this day.
              </p>
            ) : (
              dayBookings.map((b) => {
                const table = draft.find((r) => r.id === b.resource_id);
                const time = new Intl.DateTimeFormat("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: service.timezone,
                }).format(new Date(b.starts_at));
                const terminal =
                  b.status === "cancelled" || b.status === "no_show" || b.status === "completed";
                return (
                  <div
                    key={b.id}
                    className={cn(
                      "rounded-md border px-2 py-1.5",
                      selectedBooking?.id === b.id
                        ? "border-success/60 bg-success/5"
                        : "border-transparent hover:border-border",
                      terminal && "opacity-50",
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 text-left"
                      onClick={() =>
                        setSelectedBooking(
                          selectedBooking?.id === b.id || terminal ? null : b,
                        )
                      }
                    >
                      <span className="w-14 shrink-0 text-xs font-medium tabular-nums">
                        {time}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">
                        {b.guest_name} ×{b.party_size}
                        {table ? (
                          <span className="text-muted-foreground"> · {table.name}</span>
                        ) : null}
                      </span>
                      <BookingStatusBadge status={b.status} />
                    </button>
                    {!terminal ? (
                      <div className="mt-1 flex gap-1 pl-14">
                        {b.status === "confirmed" ? (
                          <MiniAction label="Seat" onClick={() => actOn(b, "seated")} />
                        ) : null}
                        {b.status === "seated" ? (
                          <MiniAction label="Finish" onClick={() => actOn(b, "completed")} />
                        ) : null}
                        {b.status === "pending" ? (
                          <MiniAction label="Confirm" onClick={() => actOn(b, "confirmed")} />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {generateOpen ? (
        <GenerateFloorDialog
          propertyId={propertyId}
          serviceId={service.id}
          onClose={() => setGenerateOpen(false)}
          onGenerated={(tables) => {
            setDraft(tables);
            setSelectedIdx(null);
            setGenerateOpen(false);
            toast.success("Layout drafted — adjust and save");
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Sidebar detail for one table: who's on it now (with status actions), who's
 * booked on it later, and — when it's free — the walk-in seating form. This
 * is what a click on the floor plan opens.
 */
function TableDetailPanel({
  table,
  current,
  upcoming,
  timezone,
  busy,
  onBack,
  onAct,
  onSeatWalkIn,
}: {
  table: ResourceItem | undefined;
  current: BookingListItem[];
  upcoming: BookingListItem[];
  timezone: string;
  busy: boolean;
  onBack: () => void;
  onAct: (booking: BookingListItem, status: "seated" | "completed" | "confirmed") => void;
  onSeatWalkIn: (table: ResourceItem, partySize: number, guestName: string) => void;
}) {
  const [party, setParty] = useState(2);
  const [name, setName] = useState("");
  if (!table) return null;

  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(iso));
  const free = current.length === 0;

  return (
    <div className="flex max-h-[480px] flex-col gap-3 overflow-y-auto rounded-lg border border-border p-3">
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onBack}
          aria-label="Back to all bookings"
          className="-ml-1 text-muted-foreground"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <p className="text-sm font-medium">{table.name}</p>
        <p className="text-xs text-muted-foreground">
          {table.zone ? `${table.zone} · ` : ""}
          {table.seats} seats
        </p>
      </div>

      {free ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-success">
            Free now
          </p>
          {table.active ? (
            <div className="space-y-2 rounded-md border border-border p-2">
              <p className="text-xs font-medium">Seat a walk-in</p>
              <div className="flex flex-wrap gap-1">
                {Array.from(
                  { length: Math.min(table.seats, 8) },
                  (_, i) => i + 1,
                ).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={party === n}
                    onClick={() => setParty(n)}
                    className={cn(
                      "size-7 rounded-full border text-xs tabular-nums",
                      party === n
                        ? "border-foreground/40 bg-foreground/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (optional)"
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                className="w-full"
                disabled={busy}
                onClick={() => onSeatWalkIn(table, party, name)}
              >
                {busy ? "Seating…" : `Seat ${party} now`}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              This table is inactive — reactivate it in Edit layout.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {current.map((b) => (
            <div key={b.id} className="rounded-md border border-border p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs font-medium">
                  {b.guest_name} ×{b.party_size}
                </p>
                <BookingStatusBadge status={b.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {time(b.starts_at)} – {time(b.ends_at)}
                {b.guest_phone ? ` · ${b.guest_phone}` : ""}
              </p>
              <div className="mt-1.5 flex gap-1">
                {b.status === "pending" ? (
                  <MiniAction label="Confirm" onClick={() => onAct(b, "confirmed")} />
                ) : null}
                {b.status === "confirmed" ? (
                  <MiniAction label="Seat" onClick={() => onAct(b, "seated")} />
                ) : null}
                {b.status === "seated" ? (
                  <MiniAction label="Finish" onClick={() => onAct(b, "completed")} />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      {upcoming.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Later today</p>
          {upcoming.map((b) => (
            <p key={b.id} className="text-xs">
              <span className="font-medium tabular-nums">{time(b.starts_at)}</span>{" "}
              <span className="text-muted-foreground">
                {b.guest_name} ×{b.party_size}
              </span>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MiniAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {label}
    </button>
  );
}

function GenerateFloorDialog({
  propertyId,
  serviceId,
  onClose,
  onGenerated,
}: {
  propertyId: string;
  serviceId: string;
  onClose: () => void;
  onGenerated: (tables: ResourceItem[]) => void;
}) {
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);

  async function generate() {
    setPending(true);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/bookings/services/${serviceId}/generate-floor`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description }),
        },
      );
      if (!res.ok) {
        toast.error("Couldn't draft that layout — try again");
        return;
      }
      const data = (await res.json()) as { tables: ResourceItem[] };
      onGenerated(data.tables);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Draft the floor plan with AI</DialogTitle>
          <DialogDescription>
            Describe the room — table counts, sizes, zones — and get a
            starting layout to drag into shape. Replaces the current draft.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Main dining room with eight 2-tops along the window, six 4-tops in the middle, two round 6-tops at the back, and four patio tables for 4."
        />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={generate} disabled={pending || !description.trim()}>
            <Sparkles data-slot="icon" />
            {pending ? "Drafting…" : "Draft layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
