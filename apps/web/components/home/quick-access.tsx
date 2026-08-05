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
 * Quick access to the main workspaces, sitting under the Home masthead like
 * Notion's "recently visited" strip: four **page-like cards** — the one place
 * on Home that legitimately takes `rounded-card` + `shadow-card`, because each
 * card stands for a destination page (notion-spec-v2 §5). Content is stacked —
 * tinted icon chip, then the destination name at the **content rung**
 * (`16px / 24px` weight 400, not a 14px UI label), then a 12px faint line —
 * which is what lets four of them sit inside the 720px document column without
 * truncating. Colour lives only in the icon chip, never the fill.
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
            className="flex min-w-0 flex-col gap-2.5 rounded-card bg-card p-3 shadow-card transition-colors hover:bg-accent focus-visible:shadow-focus"
          >
            <TintIcon tone={t.tone}>
              <Icon />
            </TintIcon>
            <div className="min-w-0">
              <div className="truncate text-base leading-6 font-normal text-foreground">
                {t.label}
              </div>
              <div className="truncate text-xs leading-4 text-faint-foreground">
                {t.sub}
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
