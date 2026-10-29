"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useInfoPanel } from "./context";
import { MembersTab } from "./members-tab";
import { PinnedTab } from "./pinned-tab";
import { AboutTab } from "./about-tab";
import { FilesTab } from "@/components/chat/files/files-tab";

const TABS = [
  ["members", "Members"],
  ["pinned", "Pinned"],
  ["files", "Files"],
  ["about", "About"],
] as const;

/**
 * Right-side slide-out panel in gr8r's drawer vocabulary (`.drawer-h`
 * header, `.tabs` strip, padded body) — a non-modal sheet over the message
 * list. It portals out of the shell, so it carries `g8 g8-port` itself.
 * Mounted inside <Channel> so all child components have channel context.
 */
export function ChannelInfoPanel({ propertyId }: { propertyId: string }) {
  const { open, tab, setTab, close } = useInfoPanel();

  return (
    <Sheet open={open} onOpenChange={(o) => (o ? null : close())}>
      <SheetContent
        side="right"
        className="g8 g8-port flex w-[380px] flex-col gap-0 p-0 sm:max-w-[380px]"
      >
        <div className="drawer-h">
          <SheetTitle
            className="grow trunc"
            style={{ fontSize: "var(--g8-fs)", fontWeight: 600 }}
          >
            Channel details
          </SheetTitle>
          <SheetDescription className="sr-only">
            Members, pinned messages, files, and channel details.
          </SheetDescription>
        </div>
        <div className="tabs" role="tablist" style={{ padding: "0 12px", flexShrink: 0 }}>
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "tab on" : "tab"}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "members" ? (
            <MembersTab propertyId={propertyId} />
          ) : tab === "pinned" ? (
            <PinnedTab />
          ) : tab === "files" ? (
            <FilesTab />
          ) : (
            <AboutTab propertyId={propertyId} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
