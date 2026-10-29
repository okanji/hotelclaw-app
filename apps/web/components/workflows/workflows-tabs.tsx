"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, History, LayoutTemplate, Workflow } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

/**
 * Route-based sub-navigation for the workflows section. Unlike TasksBoard's
 * local-state tabs, the workflows surface picks its view from the pathname
 * (see workflows-surface.tsx), so these are real <Link>s — Next navigates,
 * `usePathname` updates, and the surface swaps the view. Active state is
 * derived from the current path, never local state. Drawn as gr8r's `.tabs`
 * strip, under the page's `.ph` header.
 */
export function WorkflowsTabs({ propertyId }: { propertyId: string }) {
  const pathname = usePathname() ?? "";
  const base = `/p/${propertyId}/workflows`;

  const active: string =
    pathname === `${base}/templates` || pathname.startsWith(`${base}/templates/`)
      ? "templates"
      : pathname === `${base}/entities` || pathname.startsWith(`${base}/entities/`)
        ? "entities"
        : pathname === `${base}/runs` || /\/workflows\/[^/]+\/runs(?:\/|$)/.test(pathname)
          ? "runs"
          : "workflows";

  const tabs = [
    { key: "workflows", label: "Workflows", href: base, Icon: Workflow, hint: "All workflows in this property" },
    {
      key: "runs",
      label: "Runs",
      href: `${base}/runs`,
      Icon: History,
      hint: "History of every workflow run in this property",
    },
    {
      key: "templates",
      label: "Templates",
      href: `${base}/templates`,
      Icon: LayoutTemplate,
      hint: "Ready-made workflows you can start from",
    },
    {
      key: "entities",
      label: "Entities",
      href: `${base}/entities`,
      Icon: Database,
      hint: "Custom data types you track, like rooms or guests",
    },
  ];

  return (
    <nav className="tabs" aria-label="Workflows sections" style={{ marginBottom: 16 }}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          title={t.hint}
          className={active === t.key ? "tab on" : "tab"}
          aria-current={active === t.key ? "page" : undefined}
        >
          <Gi icon={t.Icon} size={14} />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
