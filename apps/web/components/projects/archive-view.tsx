"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FolderOpen, Layers, RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/page-shell";
import { PageHeader } from "@/components/shell/page-header";
import {
  archivedQueryOptions,
  type ArchivedEntity,
} from "@/lib/query/project-queries";
import { LABEL_DOT } from "@/components/labels/label-tokens";
import {
  deleteProject,
  deleteSpace,
  restoreProject,
  restoreSpace,
} from "./actions";

const COLOR_DOT = LABEL_DOT;

type Kind = "project" | "space";

function archivedAgo(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ArchiveView({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(archivedQueryOptions(propertyId));
  const [busy, setBusy] = useState<string | null>(null);

  const projects = data?.projects ?? [];
  const spaces = data?.spaces ?? [];
  const isEmpty = !isPending && projects.length === 0 && spaces.length === 0;

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["archived", propertyId] });
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    void qc.invalidateQueries({ queryKey: ["projects-tracking", propertyId] });
    void qc.invalidateQueries({ queryKey: ["spaces", propertyId] });
  }

  async function onRestore(kind: Kind, item: ArchivedEntity) {
    setBusy(item.id);
    const res =
      kind === "project"
        ? await restoreProject(item.id)
        : await restoreSpace(item.id);
    setBusy(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Restored ${item.name || "item"}`);
    refresh();
  }

  async function onDelete(kind: Kind, item: ArchivedEntity) {
    if (
      !window.confirm(
        `Permanently delete "${item.name || "Untitled"}"? This cannot be undone.`,
      )
    )
      return;
    setBusy(item.id);
    const res =
      kind === "project"
        ? await deleteProject(item.id)
        : await deleteSpace(item.id);
    setBusy(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Deleted ${item.name || "item"}`);
    refresh();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          {
            label: "Projects",
            href: `/p/${propertyId}/projects`,
            icon: <FolderOpen />,
          },
          { label: "Archive" },
        ]}
        meta="Deleting unlinks tasks and docs — it never deletes them"
      />
      <div className="min-h-0 flex-1 overflow-y-auto pt-4 pb-16">
        <PageShell width="full" className="flex flex-col">

          {isPending ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : isEmpty ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing archived. Archived projects and teams show up here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              <Section
                title="Projects"
                Icon={FolderOpen}
                items={projects}
                kind="project"
                busy={busy}
                onRestore={onRestore}
                onDelete={onDelete}
              />
              <Section
                title="Teams"
                Icon={Layers}
                items={spaces}
                kind="space"
                busy={busy}
                onRestore={onRestore}
                onDelete={onDelete}
              />
            </div>
          )}
        </PageShell>
      </div>
    </div>
  );
}

function Section({
  title,
  Icon,
  items,
  kind,
  busy,
  onRestore,
  onDelete,
}: {
  title: string;
  Icon: typeof FolderOpen;
  items: ArchivedEntity[];
  kind: Kind;
  busy: string | null;
  onRestore: (kind: Kind, item: ArchivedEntity) => void;
  onDelete: (kind: Kind, item: ArchivedEntity) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
        <h2 className="text-base leading-6 font-semibold text-foreground">
          {title}
        </h2>
        <span className="text-xs text-faint-foreground tabular-nums">
          {items.length}
        </span>
      </div>
      <ul
        role="list"
        className="flex flex-col divide-y divide-border border-t border-border"
      >
        {items.map((item) => (
          <li
            key={item.id}
            className="flex h-[37px] items-center gap-3 px-1"
          >
            {item.icon ? (
              <span className="shrink-0 text-base leading-none">
                {item.icon}
              </span>
            ) : (
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  COLOR_DOT[item.color],
                )}
                aria-hidden="true"
              />
            )}
            {/* Name cell = the UI-row rung: 14px w500. */}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
              {item.name || "Untitled"}
            </span>
            {item.archived_at ? (
              <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
                Archived {archivedAgo(item.archived_at)}
              </span>
            ) : null}
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === item.id}
                onClick={() => onRestore(kind, item)}
              >
                <RotateCcw className="size-3.5" />
                Restore
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                title="Delete permanently"
                aria-label="Delete permanently"
                disabled={busy === item.id}
                onClick={() => onDelete(kind, item)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
