import {
  CheckSquare,
  MessageSquare,
  FileText,
  Video,
  CalendarDays,
  ClipboardList,
  Database,
  Ticket,
  Zap,
  Sparkles,
  GitBranch,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Surface } from "@/lib/workflows/catalog/types";

// Surface chips are MONOCHROME by design (Notion normalization, 2026-08-04).
// The identity of a surface is carried by its ICON, not by a colour — a
// twelve-way rainbow of `bg-<colour>-100 text-<colour>-700` chips was the
// loudest "stock component library" tell in the builder. Every chip is now
// the quiet warm well (`bg-muted`) with muted ink; `ai` keeps the single
// blue icon accent because it marks the one non-deterministic step kind.

const SURFACE_META: Record<
  Surface,
  { tone: string; icon: typeof Zap; label: string }
> = {
  tasks: {
    tone: "bg-muted text-muted-foreground",
    icon: CheckSquare,
    label: "Tasks",
  },
  docs: {
    tone: "bg-muted text-muted-foreground",
    icon: FileText,
    label: "Docs",
  },
  chat: {
    tone: "bg-muted text-muted-foreground",
    icon: MessageSquare,
    label: "Chat",
  },
  meetings: {
    tone: "bg-muted text-muted-foreground",
    icon: Video,
    label: "Meetings",
  },
  calendar: {
    tone: "bg-muted text-muted-foreground",
    icon: CalendarDays,
    label: "Calendar",
  },
  forms: {
    tone: "bg-muted text-muted-foreground",
    icon: ClipboardList,
    label: "Forms",
  },
  bookings: {
    tone: "bg-muted text-muted-foreground",
    icon: Ticket,
    label: "Bookings",
  },
  entities: {
    tone: "bg-muted text-muted-foreground",
    icon: Database,
    label: "Entities",
  },
  system: {
    tone: "bg-muted text-muted-foreground",
    icon: Zap,
    label: "System",
  },
  ai: {
    tone: "bg-muted text-icon-accent",
    icon: Sparkles,
    label: "AI",
  },
  control: {
    tone: "bg-muted text-muted-foreground",
    icon: GitBranch,
    label: "Logic",
  },
  external: {
    tone: "bg-muted text-muted-foreground",
    icon: ExternalLink,
    label: "External",
  },
};

export function surfaceMeta(surface: Surface) {
  return SURFACE_META[surface];
}

export function SurfaceBadge({
  surface,
  className,
}: {
  surface: Surface;
  className?: string;
}) {
  const meta = SURFACE_META[surface];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-md",
        meta.tone,
        className,
      )}
      aria-label={meta.label}
    >
      <Icon className="size-3.5" aria-hidden />
    </span>
  );
}

/** Text pill for surface names in headers, palette rows, and map nodes. */
export function SurfaceLabelBadge({
  surface,
  className,
}: {
  surface: Surface;
  className?: string;
}) {
  const meta = SURFACE_META[surface];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
        meta.tone,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
