import Link from "next/link";
import {
  CalendarDays,
  FileText,
  ListChecks,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

/**
 * Quick access to the main workspaces — a Home section (registry id
 * `quick-access`, full width) of four soft pastel tiles, each a destination
 * page. Colour is a light tint of the tile's tone: the only place on Home
 * that fills a surface with colour, kept pale so the page stays calm.
 */
type QuickTile = {
  label: string;
  sub: string;
  href: (base: string) => string;
  icon: LucideIcon;
  /** gr8r palette token for the tile tint. */
  tone: string;
};

const TILES: QuickTile[] = [
  {
    label: "Tasks",
    sub: "Boards & your work",
    href: (b) => `${b}/tasks`,
    icon: ListChecks,
    tone: "var(--g8-blue)",
  },
  {
    label: "Calendar",
    sub: "Meetings & events",
    href: (b) => `${b}/calendar`,
    icon: CalendarDays,
    tone: "var(--g8-green)",
  },
  {
    label: "Docs",
    sub: "Notes & knowledge",
    href: (b) => `${b}/documents`,
    icon: FileText,
    tone: "var(--g8-violet)",
  },
  {
    label: "Chat",
    sub: "Channels & DMs",
    href: (b) => `${b}/chat`,
    icon: MessageSquare,
    tone: "var(--g8-orange)",
  },
];

export function QuickAccessWidget({ propertyId }: { propertyId: string }) {
  const base = `/p/${propertyId}`;
  return (
    <div className="home-quick">
      {TILES.map((t) => (
        <Link
          key={t.label}
          href={t.href(base)}
          className="home-tile"
          style={{ "--g8-c": t.tone } as React.CSSProperties}
        >
          <span className="picon" style={{ "--g8-sz": "30px" } as React.CSSProperties}>
            <Gi icon={t.icon} size={15} />
          </span>
          <span className="min-w-0">
            <span className="trunc" style={{ display: "block", fontWeight: 500 }}>
              {t.label}
            </span>
            <span
              className="faint trunc"
              style={{ display: "block", fontSize: "var(--g8-fs-xs)" }}
            >
              {t.sub}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
