"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutGrid,
  CircleUser,
  Power,
  FilePen,
  TriangleAlert,
  Sparkles,
  History,
  Database,
  LibraryBig,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

/**
 * Secondary sidebar for the Workflows section, in gr8r's `.sitem` rows (it
 * renders inside the tree node's `.sub`). Pinned views (All / Mine / Active /
 * Drafts / Failing) + library entries (Templates, Runs, Entities).
 *
 * Saved views use ?view= so the list page can switch filters without a route
 * change.
 */
export function WorkflowsSection({ propertyId }: { propertyId: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const base = `/p/${propertyId}/workflows`;
  const onList = pathname === base;
  const view = params.get("view") ?? "all";

  // Everything under /workflows/<segment> that isn't a library route is a
  // builder route (`new`, `<workflowId>`, `<workflowId>/runs/...`). Those pages
  // have no sidebar item of their own, so keep their parent lit rather than
  // leaving the whole sidebar unselected.
  const sub = pathname.startsWith(`${base}/`)
    ? pathname.slice(base.length + 1).split("/")[0]
    : null;
  const onNew = sub === "new";
  const onBuilder =
    sub !== null && !onNew && !["templates", "runs", "entities"].includes(sub);

  const pinned = [
    { id: "all", label: "All workflows", icon: LayoutGrid },
    { id: "mine", label: "My workflows", icon: CircleUser },
    { id: "active", label: "Active", icon: Power },
    { id: "drafts", label: "Drafts", icon: FilePen },
    { id: "failing", label: "Failing", icon: TriangleAlert },
  ] as const;

  const library = [
    { label: "Templates", icon: LibraryBig, href: `${base}/templates` },
    { label: "Runs", icon: History, href: `${base}/runs` },
    { label: "Entities", icon: Database, href: `${base}/entities` },
  ];

  const row = (
    key: string,
    href: string,
    label: string,
    icon: typeof LayoutGrid,
    on: boolean,
    tip?: string,
  ) => (
    <Link
      key={key}
      href={href}
      className={on ? "sitem on" : "sitem"}
      title={tip}
      aria-current={on ? "page" : undefined}
    >
      <Gi icon={icon} size={14} />
      <span className="trunc">{label}</span>
    </Link>
  );

  return (
    <>
      {/* Root first, then create, then the saved cuts (audit 2026-10-25 —
          a create row never leads the list). */}
      {pinned.flatMap((v, i) => {
        const href = v.id === "all" ? base : `${base}?view=${v.id}`;
        const on = (onList && view === v.id) || (onBuilder && v.id === "all");
        const out = [row(v.id, href, v.label, v.icon, on)];
        if (i === 0) {
          out.push(
            row("new", `${base}/new`, "New workflow", Sparkles, onNew, "Build a workflow with AI"),
          );
        }
        return out;
      })}
      <div className="sgroup-h">Library</div>
      {library.map((v) =>
        row(v.label, v.href, v.label, v.icon, pathname.startsWith(v.href)),
      )}
    </>
  );
}
