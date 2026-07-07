"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSurfacePathname } from "@/lib/shell/use-surface-pathname";
import { ChannelView } from "./channel-view";

/** Captures the conversation id from `/p/<pid>/(chat|dms)/<id>`. */
const CHANNEL_ROUTE = /^\/p\/[^/]+\/(?:chat|dms)\/([^/]+)\/?$/;
/** Matches the bare `/p/<pid>/dms` root (no conversation selected). */
const DMS_ROOT = /^\/p\/[^/]+\/dms\/?$/;

/**
 * Persistent chat message pane.
 *
 * Mounted once in the property layout, it owns rendering for every chat/DM
 * URL — both conversation routes and the `/dms` "nothing selected" landing.
 * That lets rail clicks `pushState` even to `/dms` root (see app-rail) without
 * paying a cross-segment Next route navigation: `useSurfacePathname` picks up
 * the new URL in the same React tick as the other surfaces, and the right
 * branch below renders in place. Channel-to-channel and section-to-section
 * switches both stay zero round-trip.
 *
 * Off chat/DM routes the surface returns null and the section page (Tasks,
 * Docs, …) fills the pane instead.
 */
export function ChatSurface({ propertyId }: { propertyId: string }) {
  return (
    <Suspense fallback={null}>
      <ChatSurfaceInner propertyId={propertyId} />
    </Suspense>
  );
}

function ChatSurfaceInner({ propertyId }: { propertyId: string }) {
  const pathname = useSurfacePathname();
  const messageId = useSearchParams().get("messageId");

  const channelId = pathname.match(CHANNEL_ROUTE)?.[1];
  if (channelId) {
    // No `key` — a channelId change must reconcile, not remount. That's what
    // makes the switch instant; <ChannelView> already handles a changing id.
    return (
      <ChannelView
        channelId={channelId}
        propertyId={propertyId}
        messageId={messageId}
      />
    );
  }

  // Bare `/dms`: render the empty-state landing right here so the rail can
  // pushState to this URL without Next having to mount `/dms/page.tsx` as a
  // new route segment. `dms/page.tsx` returns null and lets the surface own
  // every chat/DM URL.
  if (DMS_ROOT.test(pathname)) {
    return <DmsEmptyState />;
  }

  return null;
}

function DmsEmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <h2 className="text-lg font-semibold">No conversation selected</h2>
      <p className="text-sm text-muted-foreground">
        Pick a direct message from the sidebar, or start a new one with the
        + button.
      </p>
    </div>
  );
}
