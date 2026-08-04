import Link from "next/link";
import {
  CalendarDays,
  FileText,
  ListChecks,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { TintIcon, type TintTone } from "@/components/ui/tint-card";

/**
 * Quick access to the main workspaces under the Home masthead. Neutral cards in
 * the house language — `bg-card` + the 1px warm ring, no stroke and no resting
 * shadow, matching the KPI stat cards. Colour lives only in the small tinted
 * icon chip, never the fill, so the whole page reads as one consistent card
 * system. Deep-links via next/link.
 */
type QuickTile = {
  label: string;
  sub: string;
  href: (base: string) => string;
  icon: LucideIcon;
  tone: TintTone;
};

const TILES: QuickTile[] = [
  {
    label: "Tasks",
    sub: "Boards & your work",
    href: (b) => `${b}/tasks`,
    icon: ListChecks,
    tone: "blue",
  },
  {
    label: "Bookings",
    sub: "Reservations & agenda",
    href: (b) => `${b}/bookings`,
    icon: Ticket,
    tone: "coral",
  },
  {
    label: "Calendar",
    sub: "Meetings & events",
    href: (b) => `${b}/calendar`,
    icon: CalendarDays,
    tone: "sage",
  },
  {
    label: "Docs",
    sub: "Notes & knowledge",
    href: (b) => `${b}/documents`,
    icon: FileText,
    tone: "lavender",
  },
];

export function QuickAccessRow({ propertyId }: { propertyId: string }) {
  const base = `/p/${propertyId}`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.label}
            href={t.href(base)}
            className="flex min-w-0 items-center gap-3 rounded-md bg-card p-3.5 shadow-ring transition-colors hover:bg-accent focus-visible:shadow-focus"
          >
            <TintIcon tone={t.tone}>
              <Icon />
            </TintIcon>
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">
                {t.label}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {t.sub}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
