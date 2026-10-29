"use client";

import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, FolderKanban, FolderOpen, Layers, RotateCcw, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Gi } from "@/components/gr8r/icon";
import { G8_COLOR } from "@/components/gr8r/home-glyphs";
import { ago } from "@/components/gr8r/inbox-shared";
import { archivedQueryOptions, type ArchivedEntity } from "@/lib/query/project-queries";
import {
  deleteProject,
  deleteSpace,
  restoreProject,
  restoreSpace,
} from "@/components/projects/actions";

/**
 * gr8r-studio's `pageArchive` (src/features/archive.js) over our archive:
 * archived projects and teams (spaces) in two tabs, each row with Restore
 * and Delete permanently. Deleting unlinks tasks and docs — it never deletes
 * them (the server actions own that rule).
 */

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;
type Kind = "project" | "space";

function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ArchiveView({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const { data, isPending } = useQuery(archivedQueryOptions(propertyId));
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<Kind>("project");

  const projects = data?.projects ?? [];
  const spaces = data?.spaces ?? [];
  const items = tab === "project" ? projects : spaces;

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["archived", propertyId] });
    void qc.invalidateQueries({ queryKey: ["projects", propertyId] });
    void qc.invalidateQueries({ queryKey: ["projects-tracking", propertyId] });
    void qc.invalidateQueries({ queryKey: ["spaces", propertyId] });
  }

  async function onRestore(kind: Kind, item: ArchivedEntity) {
    setBusy(item.id);
    const res = kind === "project" ? await restoreProject(item.id) : await restoreSpace(item.id);
    setBusy(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Restored ${item.name || "item"}`);
    refresh();
  }

  async function onDelete(kind: Kind, item: ArchivedEntity) {
    if (!window.confirm(`Permanently delete "${item.name || "Untitled"}"? This cannot be undone.`))
      return;
    setBusy(item.id);
    const res = kind === "project" ? await deleteProject(item.id) : await deleteSpace(item.id);
    setBusy(null);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`Deleted ${item.name || "item"}`);
    refresh();
  }

  const TABS: [Kind, string, number][] = [
    ["project", "Projects", projects.length],
    ["space", "Teams", spaces.length],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        breadcrumbs={[
          { label: "Projects", href: `/p/${propertyId}/projects`, icon: <FolderOpen /> },
          { label: "Archive" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page" style={{ maxWidth: 900 }}>
          <div className="ph">
            <div>
              <h1>Archive</h1>
              <p>
                Archived work is hidden everywhere else. Restore it any time, or delete it for good —
                deleting unlinks tasks and docs, it never deletes them.
              </p>
            </div>
          </div>
          <div className="tabs" style={{ marginBottom: 14 }} role="tablist" aria-label="Archive">
            {TABS.map(([k, n, c]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`tab ${tab === k ? "on" : ""}`}
                onClick={() => setTab(k)}
              >
                {n}
                <span className="cnt">{c}</span>
              </button>
            ))}
          </div>

          {isPending ? (
            <div className="panel">
              <div className="empty-state sm">
                <p>Loading…</p>
              </div>
            </div>
          ) : items.length ? (
            <div className="panel" style={{ overflow: "hidden" }}>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="mini"
                  style={{ minHeight: 52, cursor: "default", gap: 12 }}
                >
                  <span
                    className="picon"
                    style={
                      {
                        "--g8-c": G8_COLOR[item.color] ?? G8_COLOR.slate,
                        "--g8-sz": "24px",
                        fontSize: 12,
                      } as CSSVars
                    }
                  >
                    {item.icon ? (
                      item.icon
                    ) : (
                      <Gi icon={tab === "project" ? FolderKanban : Layers} size={13} />
                    )}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="trunc" style={{ fontWeight: 500 }}>
                      {item.name || "Untitled"}
                    </div>
                    <div className="faint trunc" style={{ fontSize: 12 }}>
                      {tab === "project" ? "Project" : "Team"}
                      {item.archived_at ? ` · archived ${fullDate(item.archived_at)}` : ""}
                    </div>
                  </div>
                  <span className="faint hide-m" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                    {item.archived_at ? `Archived ${ago(item.archived_at)}` : "Archived"}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy === item.id}
                    onClick={() => void onRestore(tab, item)}
                  >
                    <Gi icon={RotateCcw} size={13} />
                    Restore
                  </button>
                  <button
                    type="button"
                    className="ibtn ibtn-sm"
                    title="Delete permanently"
                    aria-label="Delete permanently"
                    disabled={busy === item.id}
                    style={{ color: "var(--g8-red)" }}
                    onClick={() => void onDelete(tab, item)}
                  >
                    <Gi icon={Trash2} size={15} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="panel">
              <div className="empty-state">
                <div className="glyph">
                  <Gi icon={Archive} size={20} />
                </div>
                <h2 className="es-h">
                  {tab === "project" ? "No archived projects" : "No archived teams"}
                </h2>
                <p>
                  {tab === "project"
                    ? "Archived projects disappear from the sidebar and project lists but keep every task, file, and comment."
                    : "Archived teams leave the sidebar with their lists; restore one to bring it back."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
