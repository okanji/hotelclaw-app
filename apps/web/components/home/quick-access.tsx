import Link from "next/link";
import {
  CalendarDays,
  FileText,
  ListChecks,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tintTone, type TintTone } from "@/components/ui/tint-card";

/**
 * Quick access to the main workspaces under the Home masthead. Soft brand-tint
 * cards (one per hue), the same gentle tint intensity as the intelligence brief
 * cards so the whole page reads as one tinted-card system. Deep-links via
 * next/link.
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
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-xl p-4 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-sm",
              tintTone[t.tone],
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-current/10">
              <Icon className="size-[1.15rem]" />
            </span>
            <div className="min-w-0">
              <div className="font-medium">{t.label}</div>
              <div className="truncate text-sm text-current/70">{t.sub}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
