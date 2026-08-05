"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Version = {
  id: string;
  version: number;
  notes: string | null;
  created_at: string;
  is_current: boolean;
};

function relTime(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function VersionHistoryDialog({
  propertyId,
  workflowId,
  open,
  onClose,
}: {
  propertyId: string;
  workflowId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [restoring, setRestoring] = useState<number | null>(null);

  const { data: versions = [], isLoading: loading } = useQuery({
    queryKey: ["workflow-versions", propertyId, workflowId],
    enabled: open,
    queryFn: async () => {
      const r = await fetch(`/api/properties/${propertyId}/workflows/${workflowId}/versions`);
      if (!r.ok) throw new Error("Couldn't load version history");
      return ((await r.json()) as { versions?: Version[] }).versions ?? [];
    },
  });

  async function restore(version: number) {
    if (restoring) return;
    setRestoring(version);
    try {
      const res = await fetch(
        `/api/properties/${propertyId}/workflows/${workflowId}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version }),
        },
      );
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? `HTTP ${res.status}`);
      toast.success(`Restored version ${version}`);
      // Reload so the builder picks up the restored spec + fresh base version.
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't restore");
      setRestoring(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              No saved versions yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md px-3 py-2",
                    v.is_current ? "bg-accent-pressed" : "bg-muted",
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      Version {v.version}
                      {v.is_current ? (
                        <Badge variant="info">Current</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {relTime(v.created_at)}
                      {v.notes ? ` · ${v.notes}` : ""}
                    </p>
                  </div>
                  {!v.is_current ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => restore(v.version)}
                      disabled={restoring !== null}
                    >
                      <RotateCcw data-icon="inline-start" aria-hidden />
                      {restoring === v.version ? "Restoring…" : "Restore"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
