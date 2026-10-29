"use client";

import { File, MessageSquare, Pin, Plus, StickyNote } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { FilesPopover } from "@/components/chat/files/files-popover";
import { useInfoPanel } from "@/components/chat/info-panel/context";

/**
 * Tab strip directly under the channel topbar, in gr8r's `.tabs` / `.tab`
 * vocabulary (2px ink underline on the active tab), on the content gutter.
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
      className="tabs"
      style={{ flexShrink: 0, padding: "0 var(--g8-gutter)", background: "var(--g8-surface)" }}
    >
      <TabButton active label="Messages" icon={MessageSquare} />
      <TabButton label="Canvas" icon={StickyNote} />
      <FilesPopover onClick={openFilesPanel}>
        <TabButton label="Files" icon={File} />
      </FilesPopover>
      <TabButton label="Pins" icon={Pin} />
      <button
        type="button"
        className="ibtn ibtn-xs"
        aria-label="Add tab"
        style={{ alignSelf: "center", marginLeft: 2 }}
      >
        <Gi icon={Plus} size={13} />
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
  icon: typeof File;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={active ? "tab on" : "tab"}
      aria-current={active ? "page" : undefined}
      {...rest}
    >
      <Gi icon={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}
