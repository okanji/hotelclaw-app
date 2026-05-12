"use client";

import { File, MessageSquare, Pin, Plus, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Slack-style tab strip directly under the channel header.
 * Messages is the only functional tab today; Canvas/Files/Pins/+ are visual
 * scaffolding that will wire up once those features land.
 */
export function ChannelTabs() {
  return (
    <nav
      aria-label="Channel views"
      className="flex h-[42px] shrink-0 items-center gap-0.5 border-b border-border px-3"
    >
      <TabButton active label="Messages" icon={<MessageSquare />} />
      <TabButton label="Canvas" icon={<StickyNote />} />
      <TabButton label="Files" icon={<File />} />
      <TabButton label="Pins" icon={<Pin />} />
      <button
        type="button"
        aria-label="Add tab"
        className="ml-0.5 inline-flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[oklch(1_0_0_/_0.08)] hover:text-foreground [&_svg]:size-3.5"
      >
        <Plus />
      </button>
    </nav>
  );
}

function TabButton({
  active,
  label,
  icon,
}: {
  active?: boolean;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-full items-center gap-1.5 rounded-md px-2 !text-[13px] !leading-none font-medium transition-colors",
        active
          ? "text-[#F8F8F8]"
          : "text-muted-foreground hover:bg-[oklch(1_0_0_/_0.06)] hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className="[&_svg]:size-[15px]">{icon}</span>
      <span>{label}</span>
      {active ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-2 -bottom-px h-[2px] rounded-t-sm bg-[#CFA0CB]"
        />
      ) : null}
    </button>
  );
}
