"use client";

import { useState, useTransition } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { createTeam } from "./actions";

/**
 * Create a team from the org chart. `parentId` sets where it lands: null =
 * top level (under the property), a team id = a sub-team of that team. Opened
 * by the "+ add team" placeholders in the diagram.
 */
export function AddTeamDialog({
  propertyId,
  parentId,
  parentName,
  open,
  onOpenChange,
}: {
  propertyId: string;
  parentId: string | null;
  parentName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    start(async () => {
      const res = await createTeam(propertyId, trimmed, parentId);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success(`Added ${trimmed}`);
      setName("");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["org-chart", propertyId] });
      qc.invalidateQueries({ queryKey: ["spaces", propertyId] });
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName("");
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{parentId ? "New sub-team" : "New team"}</DialogTitle>
          <DialogDescription>
            {parentId
              ? `A team reporting into ${parentName ?? "the selected team"}.`
              : "A top-level department reporting into the property."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-team-name">Name</Label>
            <Input
              id="new-team-name"
              name="teamName"
              autoFocus
              required
              maxLength={60}
              placeholder="e.g. Valet, Kitchen, Night Audit"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "Adding…" : "Add team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
