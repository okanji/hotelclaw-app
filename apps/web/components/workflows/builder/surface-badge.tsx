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

// Surface colour tokens for the workflow builder. The previous palette used
// `bg-[var(--chart-N)]` + `text-white`, but the chart vars in this theme are
// grayscale (chart-1 = oklch 0.87), so the badge ended up nearly invisible
// in dark mode and the white icons disappeared against the light fills.
//
// The new palette uses tinted Tailwind utilities (`bg-<colour>-100 dark:bg-
// <colour>-950/40 text-<colour>-700 dark:text-<colour>-300`) — those land
// on a curated dark-mode tone that always has enough contrast against the
// surrounding card without overpowering it.

const SURFACE_META: Record<
  Surface,
  { tone: string; icon: typeof Zap; label: string }
> = {
  tasks: {
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    icon: CheckSquare,
    label: "Tasks",
  },
  docs: {
    tone: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    icon: FileText,
    label: "Docs",
  },
  chat: {
    tone: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    icon: MessageSquare,
    label: "Chat",
  },
  meetings: {
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    icon: Video,
    label: "Meetings",
  },
  calendar: {
    tone: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
    icon: CalendarDays,
    label: "Calendar",
  },
  forms: {
    tone: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
    icon: ClipboardList,
    label: "Forms",
  },
  bookings: {
    tone: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    icon: Ticket,
    label: "Bookings",
  },
  entities: {
    tone: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
    icon: Database,
    label: "Entities",
  },
  system: {
    tone: "bg-foreground/[0.08] text-foreground/80",
    icon: Zap,
    label: "System",
  },
  ai: {
    tone: "bg-primary/15 text-primary dark:text-primary",
    icon: Sparkles,
    label: "AI",
  },
  control: {
    tone: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    icon: GitBranch,
    label: "Logic",
  },
  external: {
    tone: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
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
        "inline-flex size-5 shrink-0 items-center justify-center rounded-[4px]",
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
        "inline-flex w-fit shrink-0 items-center rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium leading-none",
        meta.tone,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
