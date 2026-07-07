"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  DEFAULT_EVENT_PAGE,
  EVENT_COVER_PRESETS,
  parseServiceSchedule,
  type EventPageConfig,
} from "@/lib/bookings/schema";
import type { ServiceListItem } from "./bookings-view";
import { updateService } from "./actions";

/** Accent choices for the ticket page CTA — guest-palette friendly. */
const ACCENTS = [
  "#c96442", // terracotta (house default)
  "#b45309", // amber
  "#1e6f5c", // teal
  "#4f46e5", // indigo
  "#9d174d", // berry
  "#1f1e1b", // ink
];

/**
 * Customize the event's public ticket page (the Luma-style landing at
 * /book/<slug>/event/<id>): cover art, accent, tagline, location, host,
 * about. Saves into schedule.page — versioned JSON, no migration.
 */
export function EventPageDialog({
  service,
  propertySlug,
  onClose,
}: {
  service: ServiceListItem;
  propertySlug?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const schedule = parseServiceSchedule(service.schedule);
  const [page, setPage] = useState<EventPageConfig>({
    ...DEFAULT_EVENT_PAGE,
    ...(schedule.page ?? {}),
  });
  const patch = (p: Partial<EventPageConfig>) => setPage((v) => ({ ...v, ...p }));

  const pageUrl = propertySlug
    ? `/book/${propertySlug}/event/${service.id}`
    : null;
  const cover = EVENT_COVER_PRESETS[page.coverStyle] ?? EVENT_COVER_PRESETS.sunset;

  function save() {
    startSaving(async () => {
      const result = await updateService({
        serviceId: service.id,
        patch: { schedule: { ...schedule, page } },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Ticket page updated");
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize the ticket page</DialogTitle>
          <DialogDescription>
            The public landing page guests see when they follow your event
            link — cover art, story, and the details that sell it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Cover preview + presets */}
          <div className="flex items-start gap-4">
            <div
              aria-hidden
              className="flex size-24 shrink-0 items-center justify-center rounded-2xl ring-1 ring-foreground/10 ring-inset"
              style={{ background: cover.css }}
            >
              <span className="text-4xl">
                {page.coverEmoji || service.emoji || "🎉"}
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <Label className="text-xs">Cover art</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(EVENT_COVER_PRESETS).map(([id, preset]) => (
                  <button
                    key={id}
                    type="button"
                    title={preset.label}
                    aria-label={preset.label}
                    aria-pressed={page.coverStyle === id}
                    onClick={() => patch({ coverStyle: id })}
                    className={cn(
                      "size-8 rounded-full border-2 ring-1 ring-foreground/15 ring-inset",
                      page.coverStyle === id
                        ? "border-foreground"
                        : "border-transparent",
                    )}
                    style={{ background: preset.css }}
                  />
                ))}
              </div>
              <Input
                value={page.coverEmoji}
                onChange={(e) => patch({ coverEmoji: e.target.value.slice(0, 8) })}
                placeholder={`Emoji — defaults to ${service.emoji || "🎉"}`}
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Accent */}
          <div className="space-y-2">
            <Label className="text-xs">Accent — buttons and highlights</Label>
            <div className="flex flex-wrap gap-1.5">
              {ACCENTS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={hex}
                  aria-pressed={page.accent === hex}
                  onClick={() => patch({ accent: hex })}
                  className={cn(
                    "size-8 rounded-full border-2",
                    page.accent === hex ? "border-foreground" : "border-transparent",
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Tagline</Label>
            <Input
              value={page.tagline}
              onChange={(e) => patch({ tagline: e.target.value.slice(0, 160) })}
              placeholder="One line that sells the night"
              className="h-9 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Location</Label>
              <Input
                value={page.location}
                onChange={(e) => patch({ location: e.target.value.slice(0, 160) })}
                placeholder="The beach deck"
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hosted by</Label>
              <Input
                value={page.host}
                onChange={(e) => patch({ host: e.target.value.slice(0, 80) })}
                placeholder="Defaults to the property"
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">About this event</Label>
            <Textarea
              value={page.about}
              onChange={(e) => patch({ about: e.target.value.slice(0, 4000) })}
              rows={5}
              placeholder={
                "What to expect, who it's for, what's included…\n\nBlank lines become paragraphs."
              }
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {pageUrl ? (
            <Button
              variant="ghost"
              size="sm"
              render={<a href={pageUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink data-slot="icon" />
              Preview page
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save page"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
