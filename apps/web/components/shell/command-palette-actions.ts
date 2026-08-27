import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CalendarDays,
  ClipboardList,
  ClipboardPlus,
  FileText,
  Home,
  LineChart,
  ListChecks,
  MessageSquarePlus,
  MessagesSquare,
  Sparkle,
  Sparkles,
  Ticket,
  Video,
  Workflow,
  Zap,
} from "lucide-react";

/**
 * Command-palette actions + recents store.
 *
 * Pure data/helpers for `command-palette.tsx` — no React here. Actions map
 * ONLY to routes that exist under `app/p/[propertyId]/*` (each verified
 * against the app rail / shell sections); nothing here invents a surface.
 */

// ---- Actions ----------------------------------------------------------------

export type PaletteAction = {
  id: string;
  /** Sentence-case row label. */
  label: string;
  /** Extra match terms beyond the label (synonyms, rail names). */
  keywords: string[];
  icon: LucideIcon;
  href: string;
};

/**
 * The action list for one property. Icons mirror the app rail
 * (`components/shell/app-rail.tsx`) so the palette and the rail agree on
 * what each section looks like.
 *
 * NOTE (kbd hints): none of these actions has a real global shortcut — the
 * shell registers only Cmd+K (this palette) and Cmd+\ (sidebar toggle) — so
 * action rows deliberately carry NO shortcut hint. Don't add one without a
 * matching document-level listener.
 */
export function paletteActions(propertyId: string): PaletteAction[] {
  const base = `/p/${propertyId}`;
  return [
    // -- Navigation (one per rail section) --
    {
      id: "go-home",
      label: "Go to home",
      keywords: ["overview", "widgets"],
      icon: Home,
      href: `${base}/home`,
    },
    {
      id: "go-tasks",
      label: "Go to tasks",
      keywords: ["board", "todo", "work"],
      icon: ListChecks,
      href: `${base}/tasks`,
    },
    {
      id: "go-chat",
      label: "Go to chat",
      keywords: ["channels", "messages"],
      icon: MessagesSquare,
      href: `${base}/chat`,
    },
    {
      id: "go-documents",
      label: "Go to documents",
      keywords: ["docs", "notes", "pages", "wiki"],
      icon: FileText,
      href: `${base}/documents`,
    },
    {
      id: "go-calendar",
      label: "Go to calendar",
      keywords: ["schedule", "events"],
      icon: CalendarDays,
      href: `${base}/calendar`,
    },
    {
      id: "go-meetings",
      label: "Go to meetings",
      keywords: ["video", "calls"],
      icon: Video,
      href: `${base}/meetings`,
    },
    {
      id: "go-bookings",
      label: "Go to bookings",
      keywords: ["reservations", "tables", "services"],
      icon: Ticket,
      href: `${base}/bookings`,
    },
    {
      id: "go-forms",
      label: "Go to forms",
      keywords: ["surveys", "responses"],
      icon: ClipboardList,
      href: `${base}/forms`,
    },
    {
      id: "go-chatbots",
      label: "Go to chatbots",
      keywords: ["guest", "bots", "widget"],
      icon: Bot,
      href: `${base}/chatbots`,
    },
    {
      id: "go-workflows",
      label: "Go to workflows",
      keywords: ["automations", "triggers"],
      icon: Workflow,
      href: `${base}/workflows`,
    },
    {
      id: "go-agents",
      label: "Go to agents",
      keywords: ["ai", "fleet", "brain"],
      icon: Sparkles,
      href: `${base}/agents`,
    },
    {
      id: "go-assistant",
      label: "Go to assistant",
      keywords: ["ai", "copilot", "projects"],
      icon: Sparkle,
      href: `${base}/assistant`,
    },
    {
      // Served from /home/insights (its own rail entry — see app-rail.tsx).
      id: "go-insights",
      label: "Go to insights",
      keywords: ["metrics", "reports", "my week", "analytics"],
      icon: LineChart,
      href: `${base}/home/insights`,
    },
    // -- Creation (real affordances only) --
    {
      id: "new-workflow",
      label: "New workflow",
      keywords: ["create", "automation", "add"],
      icon: Zap,
      href: `${base}/workflows/new`,
    },
    {
      // `?new=1` is the forms sidebar's own deep link (forms-section.tsx);
      // FormsList opens the create dialog then strips the param.
      id: "new-form",
      label: "New form",
      keywords: ["create", "survey", "add"],
      icon: ClipboardPlus,
      href: `${base}/forms?new=1`,
    },
    {
      // The Assistant sidebar's "New chat" is plain navigation to the
      // section root (no create param exists) — mirror that exactly.
      id: "new-assistant-chat",
      label: "New assistant chat",
      keywords: ["create", "conversation", "ai"],
      icon: MessageSquarePlus,
      href: `${base}/assistant`,
    },
  ];
}

/**
 * Label/keyword matcher for the Actions group. The palette runs cmdk with
 * `shouldFilter={false}` (search groups filter server-side), so actions
 * filter here: empty query shows everything, otherwise a case-insensitive
 * substring match against the label or any keyword.
 */
export function matchesAction(action: PaletteAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (action.label.toLowerCase().includes(q)) return true;
  return action.keywords.some((k) => k.toLowerCase().includes(q));
}

// ---- Recents ----------------------------------------------------------------

export type RecentKind =
  | "action"
  | "channel"
  | "dm"
  | "person"
  | "task"
  | "message";

/**
 * Minimal record of a selected palette item.
 * - action/task: `href` is the destination
 * - channel/dm: `id` is `<channelType>:<channelId>`
 * - message:    `id` is `<channelType>:<channelId>:<messageId>`
 * - person:     `id` is the user id (re-opens/creates the DM)
 */
export type RecentEntry = {
  type: RecentKind;
  id?: string;
  label: string;
  href?: string;
};

const MAX_RECENTS = 5;
const RECENT_KINDS: RecentKind[] = [
  "action",
  "channel",
  "dm",
  "person",
  "task",
  "message",
];

function recentsKey(propertyId: string): string {
  return `cmdk-recents:${propertyId}`;
}

/** Read this property's recents. Bad/absent JSON degrades to []. */
export function loadRecents(propertyId: string): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(recentsKey(propertyId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e): e is RecentEntry => {
        if (typeof e !== "object" || e === null) return false;
        const entry = e as Record<string, unknown>;
        return (
          typeof entry.label === "string" &&
          RECENT_KINDS.includes(entry.type as RecentKind)
        );
      })
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** Prepend a selection, de-duped by identity, capped at 5. Fail-soft. */
export function recordRecent(propertyId: string, entry: RecentEntry): void {
  if (typeof window === "undefined") return;
  try {
    const identity = (e: RecentEntry) => `${e.type}|${e.id ?? e.href ?? e.label}`;
    const rest = loadRecents(propertyId).filter(
      (e) => identity(e) !== identity(entry),
    );
    window.localStorage.setItem(
      recentsKey(propertyId),
      JSON.stringify([entry, ...rest].slice(0, MAX_RECENTS)),
    );
  } catch {
    // Storage full / disabled — recents are a convenience, never fatal.
  }
}
