import Link from "next/link";
import {
  CalendarDays,
  FileText,
  ListChecks,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

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
  /** gr8r palette token for the icon tile. */
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
];

export function QuickAccessRow({ propertyId }: { propertyId: string }) {
  const base = `/p/${propertyId}`;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => (
        <Link
          key={t.label}
          href={t.href(base)}
          className="panel row min-w-0"
          style={{ padding: "10px 12px", gap: 10, color: "inherit" }}
        >
          <span
            className="picon"
            style={{ "--g8-c": t.tone } as React.CSSProperties}
          >
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
