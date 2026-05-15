"use client";

import { File, MessageSquare, Pin, Plus, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { FilesPopover } from "@/components/chat/files/files-popover";
import { useInfoPanel } from "@/components/chat/info-panel/context";

/**
 * Slack-style tab strip directly under the channel header.
 * Messages is the active tab; Files hover-previews + opens the info panel
 * on the Files tab when clicked. Canvas/Pins/+ are still scaffolding.
 */
export function ChannelTabs() {
  const { setTab, toggle, open } = useInfoPanel();

  const openFilesPanel = () => {
    setTab("files");
    if (!open) toggle();
  };

  return (
    <nav
      aria-label="Channel views"
      className="flex h-[42px] shrink-0 items-center gap-0.5 border-b border-border px-3"
    >
      <TabButton active label="Messages" icon={<MessageSquare />} />
      <TabButton label="Canvas" icon={<StickyNote />} />
      <FilesPopover onClick={openFilesPanel}>
        <TabButton label="Files" icon={<File />} />
      </FilesPopover>
      <TabButton label="Pins" icon={<Pin />} />
      <button
        type="button"
        aria-label="Add tab"
        className="ml-0.5 inline-flex size-[26px] items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-3.5"
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
  ...rest
}: {
  active?: boolean;
  label: string;
  icon: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "relative inline-flex h-full items-center gap-1.5 rounded-md px-2 !text-[13px] !leading-none font-medium transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      aria-current={active ? "page" : undefined}
      {...rest}
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
