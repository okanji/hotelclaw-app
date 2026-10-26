"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Loader2, MoreHorizontal, Pencil, Settings2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LABEL_COLORS, LABEL_DOT } from "@/components/labels/label-tokens";
import type { ListRow } from "@/lib/tasks/statuses";
import { useStatusCatalog } from "@/lib/query/status-queries";
import { archiveList, updateList } from "./actions";

/**
 * The "…" menu of a list — rename, recolour, archive. Archiving a list that
 * still holds open tasks asks where to move them first (the scope's default
 * list is pre-picked). Shared by the sidebar rows and the board header.
 */
export function ListRowMenu({
  propertyId,
  list,
  trigger,
  align = "end",
  onArchived,
  onOpenSettings,
}: {
  propertyId: string;
  list: ListRow;
  /** The element that opens the menu; defaults to a small "…" button. */
  trigger?: React.ReactElement;
  align?: "start" | "end";
  /** Called after an archive lands (the board navigates away, the sidebar doesn't). */
  onArchived?: () => void;
  /** Hosts that mount `ListSettingsDialog` get a "List settings…" row. */
  onOpenSettings?: (tab: "general" | "statuses" | "danger") => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const catalog = useStatusCatalog(propertyId);
  const [renaming, setRenaming] = useState(false);
  const [archiving, setArchiving] = useState<{ open: number } | null>(null);
  const [name, setName] = useState(list.name);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["status-catalog", propertyId] });

  async function rename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === list.name) {
      setRenaming(false);
      return;
    }
    setBusy(true);
    const res = await updateList({ listId: list.id, name: trimmed });
    setBusy(false);
    if ("error" in res) return void toast.error(res.error);
    setRenaming(false);
    void refresh();
  }

  async function recolor(color: ListRow["color"]) {
    const res = await updateList({ listId: list.id, color });
    if ("error" in res) toast.error(res.error);
    else void refresh();
  }

  async function archive(target?: string | null) {
    setBusy(true);
    const res = await archiveList({ listId: list.id, moveTasksTo: target });
    setBusy(false);
    if ("error" in res) return void toast.error(res.error);
    if ("needsMove" in res) {
      // Pre-pick the scope's default list so one click resolves it.
      const fallback =
        catalog.defaultListOf(list.space_id) ?? catalog.generalList();
      setMoveTo(fallback && fallback.id !== list.id ? fallback.id : null);
      setArchiving({ open: res.needsMove });
      return;
    }
    setArchiving(null);
    toast.success(
      res.moved > 0
        ? `Archived “${list.name}” — ${res.moved} ${res.moved === 1 ? "task" : "tasks"} moved`
        : `Archived “${list.name}”`,
    );
    await refresh();
    void qc.invalidateQueries({ queryKey: ["tasks", propertyId] });
    if (onArchived) onArchived();
    else if (typeof window !== "undefined" && window.location.search.includes(`list=${list.id}`)) {
      router.push(`/p/${propertyId}/tasks`);
    }
  }

  const targets = catalog.lists.filter(
    (l) => !l.archived_at && l.id !== list.id,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            trigger ?? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${list.name} options`}
                className="size-6 text-muted-foreground hover:bg-accent"
              />
            )
          }
        >
          {trigger ? null : <MoreHorizontal className="size-3.5" />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-48">
          <DropdownMenuItem
            onClick={() => {
              setName(list.name);
              setRenaming(true);
            }}
          >
            <Pencil className="size-3.5" />
            Rename
          </DropdownMenuItem>
          {onOpenSettings ? (
            <DropdownMenuItem onClick={() => onOpenSettings("statuses")}>
              <Settings2 className="size-3.5" />
              Statuses…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <span className={cn("size-2.5 rounded-full", LABEL_DOT[list.color])} />
              Color
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {LABEL_COLORS.map((c) => (
                <DropdownMenuItem
                  key={c}
                  onClick={() => void recolor(c)}
                  className="gap-2 capitalize"
                >
                  <span className={cn("size-2.5 rounded-full", LABEL_DOT[c])} />
                  {c}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {!list.is_default ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => void archive()}
                className="text-destructive focus:text-destructive"
              >
                <Archive className="size-3.5" />
                Archive list
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={(o) => !busy && setRenaming(o)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-medium">Rename list</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void rename();
              }
            }}
            disabled={busy}
            className="h-9"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenaming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void rename()} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiving !== null} onOpenChange={(o) => !busy && !o && setArchiving(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-medium">
              Archive “{list.name}”?
            </DialogTitle>
            <DialogDescription>
              {archiving?.open ?? 0} open {archiving?.open === 1 ? "task" : "tasks"}{" "}
              still live here. Pick the list they move to — their statuses
              follow that list&apos;s pipeline by category.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {targets.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setMoveTo(l.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
                  moveTo === l.id && "bg-accent-pressed",
                )}
              >
                <span className={cn("size-2.5 shrink-0 rounded-full", LABEL_DOT[l.color])} />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                {l.is_default ? (
                  <span className="text-xs text-faint-foreground">default</span>
                ) : null}
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiving(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void archive(moveTo)}
              disabled={busy || !moveTo}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Move tasks and archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
