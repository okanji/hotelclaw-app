"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Row / header actions shared by the workflows list and the builder, so "Run
// now" and "Duplicate" behave the same wherever they're offered.

/** Runs a manual / scheduled workflow immediately; resolves to the run id. */
export async function runWorkflowNowRequest(
  propertyId: string,
  workflowId: string,
): Promise<string | null> {
  const res = await fetch(`/api/properties/${propertyId}/workflows/${workflowId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runNow: true }),
  });
  const data = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
  if (!res.ok) {
    toast.error(data.error ?? "Couldn't start the run");
    return null;
  }
  toast.success("Run started");
  return data.runId ?? null;
}

/** Copies the workflow's current version into a new, switched-off workflow. */
export async function duplicateWorkflowRequest(
  propertyId: string,
  workflowId: string,
): Promise<string | null> {
  try {
    const detail = await fetch(`/api/properties/${propertyId}/workflows/${workflowId}`);
    if (!detail.ok) throw new Error();
    const { workflow, spec } = (await detail.json()) as {
      workflow: { name: string; description: string | null };
      spec: Record<string, unknown> | null;
    };
    const res = await fetch(`/api/properties/${propertyId}/workflows`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `${workflow.name} (copy)`.slice(0, 200),
        description: workflow.description ?? undefined,
        spec: spec ?? undefined,
        enabled: false,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !data.id) throw new Error(data.error);
    toast.success("Copy created — it starts turned off.");
    return data.id;
  } catch (err) {
    toast.error(err instanceof Error && err.message ? err.message : "Couldn't duplicate");
    return null;
  }
}

export function DeleteWorkflowDialog({
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription>
            It stops running immediately and leaves this list. Past runs stay in
            the run log. To keep it around, turn it off instead.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Deleting…" : "Delete workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
