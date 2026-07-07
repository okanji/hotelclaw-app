"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Database, History, LayoutTemplate, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Route-based sub-navigation for the workflows section. Unlike TasksBoard's
 * local-state tabs, the workflows surface picks its view from the pathname
 * (see workflows-surface.tsx), so these are real <Link>s — Next navigates,
 * `usePathname` updates, and the surface swaps the view. Active state is
 * derived from the current path, never local state.
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
    <nav
      role="tablist"
      aria-label="Workflows sections"
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-3"
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            title={t.hint}
            className={cn(
              "relative inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.Icon className="size-3.5" />
            {t.label}
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
