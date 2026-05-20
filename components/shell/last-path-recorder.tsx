"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useShellSection } from "./shell-section-context";
import {
  rememberSectionPath,
  sectionPathPrefix,
} from "@/lib/shell/last-path";

// The section→URL-prefix map lives in `lib/shell/last-path` so the writer
// (here) and the reader (`lastSectionPath`) agree on which strings are valid
// for which section. Updating the routes only needs a touch over there.

/**
 * Records the current route as the active section's "last path" (localStorage)
 * so the rail can jump straight back to it. Renders nothing — mounted once in
 * the property shell, so it captures every navigation regardless of how it
 * happened (sidebar, command palette, notification, deep link).
 *
 * The route is filed under the *active* section. Each section's recorded
 * paths must match its URL prefix; the reader re-validates the same way so
 * a route-shape change can't quietly mis-route later.
 */
export function LastPathRecorder({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const { section } = useShellSection();

  useEffect(() => {
    const prefix = sectionPathPrefix(section);
    if (prefix && pathname.includes(prefix)) {
      rememberSectionPath(propertyId, section, pathname);
    }
  }, [propertyId, pathname, section]);

  return null;
}
