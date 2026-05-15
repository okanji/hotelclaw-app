"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useShellSection, type ShellSection } from "./shell-section-context";
import { rememberSectionPath } from "@/lib/shell/last-path";

/**
 * Substring that marks a route as "content worth returning to" for each
 * section. Chat / DMs only count a specific conversation route (`/chat/<id>`)
 * — not the `/chat` index or the inbox / threads side-trips — so the rail
 * jumps back to an actual channel. The rest match their section broadly, so
 * an index page or a detail page both qualify.
 */
const SECTION_ROUTE: Record<ShellSection, string> = {
  activity: "/activity",
  chat: "/chat/",
  dms: "/chat/",
  tasks: "/tasks",
  docs: "/documents",
};

/**
 * Records the current route as the active section's "last path" (localStorage)
 * so the rail can jump straight back to it. Renders nothing — mounted once in
 * the property shell, so it captures every navigation regardless of how it
 * happened (sidebar, command palette, notification, deep link).
 *
 * The route is filed under the *active* section, which is what disambiguates
 * the shared `/chat/*` routes: a conversation opened from the Chat section is
 * remembered as `chat`, one opened from the DMs section as `dms`.
 */
export function LastPathRecorder({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const { section } = useShellSection();

  useEffect(() => {
    if (pathname.includes(SECTION_ROUTE[section])) {
      rememberSectionPath(propertyId, section, pathname);
    }
  }, [propertyId, pathname, section]);

  return null;
}
