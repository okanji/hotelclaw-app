import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholder shaped like the real <ChannelView> layout
 * (header → tab strip → message list → composer). Shared by the route-level
 * `loading.tsx` and ChannelView's cold-load fallback so a deep link and a
 * route transition show the same shape — no layout shift when content lands.
 *
 * The message rows mirror SlackMessageUI's metrics exactly (see
 * app/stream-chat-overrides.css): a 36px / 8px-radius avatar, a 10px gap to
 * the content column, and 22px of breathing room from the left edge. Rows are
 * grouped into Slack-style clusters — a lead row with an avatar + name,
 * followed by tight continuation rows that keep the avatar gutter empty.
 */

// Avatar column: 36px avatar (`size-9`) + 10px gap (`gap-2.5`), 22px from the
// left edge (`pl-5.5`). Continuation rows reuse `size-9` as an empty spacer so
// their text aligns under the lead row, exactly like SlackMessageUI.
const ROW_FRAME = "flex gap-2.5 pl-5.5 pr-4";

// Oldest → newest; older clusters fade toward the top of the scrollback.
const CLUSTERS: {
  opacity: string;
  name: string;
  lead: string[];
  follows: string[][];
}[] = [
  {
    opacity: "opacity-45",
    name: "w-24",
    lead: ["w-[58%]"],
    follows: [["w-[41%]"]],
  },
  {
    opacity: "opacity-65",
    name: "w-32",
    lead: ["w-[82%]", "w-[49%]"],
    follows: [],
  },
  {
    opacity: "opacity-85",
    name: "w-20",
    lead: ["w-[64%]"],
    follows: [["w-[75%]", "w-[37%]"], ["w-[52%]"]],
  },
  {
    opacity: "opacity-100",
    name: "w-28",
    lead: ["w-[56%]"],
    follows: [],
  },
];

function MessageRow({
  name,
  lines,
}: {
  /** Width class for the author-name bar; omit for a continuation row. */
  name?: string;
  lines: string[];
}) {
  return (
    <div className={ROW_FRAME}>
      {name ? (
        <Skeleton className="size-9 shrink-0 rounded-lg" />
      ) : (
        <div className="size-9 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
        {name ? (
          <div className="flex items-center gap-2">
            <Skeleton className={cn("h-3.5", name)} />
            <Skeleton className="h-3 w-9" />
          </div>
        ) : null}
        {lines.map((width, i) => (
          <Skeleton key={i} className={cn("h-3.5", width)} />
        ))}
      </div>
    </div>
  );
}

export function ChannelSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Header — mirrors channel-header (h-14, px-3). */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Skeleton className="size-7 shrink-0 rounded-md" />
          <Skeleton className="size-4.5 shrink-0 rounded-sm" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="size-9 rounded-md" />
        </div>
      </header>

      {/* Tab strip — mirrors channel-tabs (h-10.5 = 42px, border-b). */}
      <div className="flex h-10.5 shrink-0 items-center gap-3 border-b border-border px-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-14" />
        <Skeleton className="h-4 w-12" />
      </div>

      {/* Message list — bottom-anchored, Slack-clustered rows fading upward. */}
      <div className="flex flex-1 flex-col justify-end gap-5 overflow-hidden py-3">
        {CLUSTERS.map((cluster, i) => (
          <div key={i} className={cn("flex flex-col gap-1", cluster.opacity)}>
            <MessageRow name={cluster.name} lines={cluster.lead} />
            {cluster.follows.map((lines, j) => (
              <MessageRow key={j} lines={lines} />
            ))}
          </div>
        ))}
      </div>

      {/* Composer. */}
      <div className="shrink-0 px-5 pb-5">
        <Skeleton className="h-17 w-full rounded-xl" />
      </div>
    </div>
  );
}
