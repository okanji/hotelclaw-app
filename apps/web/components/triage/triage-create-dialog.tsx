"use client";

import { useState, useTransition } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitToTriage } from "./actions";

/**
 * "Create triage issue" — files a task that waits in the queue instead of
 * landing on the board (same `createTaskFor` write path, `triage: true`).
 * Team defaults to the creator's home team, exactly like a normal create,
 * and the intake triage bot still drafts its suggestions in the background.
 */
export function TriageCreateDialog({
  propertyId,
  open,
  onOpenChange,
  onCreated,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (taskId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await submitToTriage({
        propertyId,
        title: trimmed,
        description: description.trim() || undefined,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Submitted to triage");
      setTitle("");
      setDescription("");
      onOpenChange(false);
      onCreated(result.taskId);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create triage issue</DialogTitle>
            <DialogDescription>
              It waits here until a teammate accepts it onto the board.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Issue title"
            aria-label="Issue title"
            maxLength={200}
            autoFocus
          />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add description…"
            aria-label="Description"
            maxLength={5000}
            rows={4}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !title.trim()}>
              Submit to triage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
