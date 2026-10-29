"use client";

import { useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  channelsQueryOptions,
  documentsTreeQueryOptions,
  tasksQueryOptions,
} from "@/lib/query/section-queries";
import {
  projectsQueryOptions,
  spacesQueryOptions,
} from "@/lib/query/project-queries";

const APP_NAME = "Hotelclaw";

/**
 * Pages that aren't a rail section's root, matched in order (most specific
 * first). Section roots fall through to `SECTION_LABELS`.
 */
const PAGE_LABELS: [RegExp, string][] = [
  [/\/home\/insights/, "Insights"],
  [/\/home\/org/, "Org chart"],
  [/\/my-tasks/, "My tasks"],
  [/\/triage/, "Triage"],
  [/\/cycles/, "Cycles"],
  [/\/initiatives/, "Initiatives"],
  [/\/tasks\/new/, "New task"],
  [/\/inbox/, "Mentions"],
  [/\/threads/, "Replies"],
  [/\/search/, "Search"],
  [/\/archive/, "Archive"],
  [/\/assistant/, "Assistant"],
  [/\/projects/, "Projects"],
  [/\/spaces/, "Teams"],
  [/\/home/, "Home"],
  [/\/activity/, "Inbox"],
  [/\/chatbots/, "Chatbots"],
  [/\/chat/, "Chat"],
  [/\/dms/, "DMs"],
  [/\/tasks/, "Tasks"],
  [/\/calendar/, "Planner"],
  [/\/documents/, "Docs"],
  [/\/forms/, "Forms"],
  [/\/meetings/, "Meetings"],
  [/\/workflows/, "Workflows"],
  [/\/agents/, "Agents"],
];

function pageLabel(pathname: string): string | undefined {
  return PAGE_LABELS.find(([rx]) => rx.test(pathname))?.[1];
}

/** "daily-ops" → "Daily ops". */
function humanize(slug: string): string {
  const s = slug.replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Sets `document.title` from the current route — "Timeline · Festival ·
 * Projects · Hotelclaw" — so browser tabs and the back-button history menu
 * say where each entry is (gr8r does the same). Every page used to read just
 * "Hotelclaw". Renders nothing; mounted once in the property shell.
 *
 * Entity names come from caches the sidebars and rail already fill; the
 * queries here are `enabled: false`, so this never fetches on its own — a
 * cold cache just yields the section label until the name arrives.
 */
export function RouteTitle({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");

  const cacheOnly = { enabled: false } as const;
  const { data: projects } = useQuery({
    ...projectsQueryOptions(propertyId),
    ...cacheOnly,
  });
  const { data: spaces } = useQuery({
    ...spacesQueryOptions(propertyId),
    ...cacheOnly,
  });
  const { data: docs } = useQuery({
    ...documentsTreeQueryOptions(propertyId),
    ...cacheOnly,
  });
  const { data: tasks } = useQuery({
    ...tasksQueryOptions(propertyId),
    ...cacheOnly,
  });
  const { data: channels } = useQuery({
    ...channelsQueryOptions(propertyId),
    ...cacheOnly,
  });

  const title = useMemo(() => {
    const id = (seg: string) =>
      pathname.match(new RegExp(`/${seg}/([^/?#]+)`))?.[1];
    let entity: string | undefined;
    if (id("projects")) {
      entity = projects?.find((p) => p.id === id("projects"))?.name;
    } else if (id("spaces")) {
      entity = spaces?.find((s) => s.id === id("spaces"))?.name;
    } else if (id("documents")) {
      const doc = docs?.find((d) => d.id === id("documents"));
      entity = doc ? doc.title || "Untitled" : undefined;
    } else if (id("tasks") && id("tasks") !== "new") {
      entity = tasks?.find((t) => t.id === id("tasks"))?.title;
    } else if (id("chat")) {
      const cid = id("chat");
      const ch = channels?.find(
        (c) => c.streamChannelId === cid || c.id === cid,
      );
      entity = ch ? `#${ch.name}` : undefined;
    }
    const parts = [
      tab ? humanize(tab) : undefined,
      entity,
      pageLabel(pathname),
      APP_NAME,
    ].filter((p): p is string => !!p);
    // Drop adjacent duplicates ("Home · Home").
    return parts.filter((p, i) => p !== parts[i - 1]).join(" · ");
  }, [pathname, tab, projects, spaces, docs, tasks, channels]);

  useEffect(() => {
    document.title = title;
    // Next re-applies the root metadata title on segment navigations (and may
    // swap the <title> node itself); put ours back whenever that happens.
    const observer = new MutationObserver(() => {
      if (document.title !== title) document.title = title;
    });
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [title]);

  return null;
}
