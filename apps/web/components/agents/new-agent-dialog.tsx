"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { EMPTY_AGENT_CONFIG } from "@/lib/agents/schema";
import { createAgent } from "./actions";

/** Minimal create flow: name + optional purpose, then straight into the
 *  editor where the real shaping (instructions, tools, skills) happens. */
export function NewAgentDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!name.trim()) {
      toast.error("Give the agent a name");
      return;
    }
    startTransition(async () => {
      const result = await createAgent({
        propertyId,
        name: name.trim(),
        config: {
          ...EMPTY_AGENT_CONFIG,
          description: purpose.trim(),
          instructions: purpose.trim()
            ? `You are ${name.trim()}, an internal assistant for the property team. Your purpose: ${purpose.trim()}`
            : "",
        },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      setName("");
      setPurpose("");
      router.push(`/p/${propertyId}/agents/${result.agentId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New agent</DialogTitle>
          <DialogDescription>
            Name it and say what it&apos;s for — you&apos;ll shape its
            instructions, tools, and skills next.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Agent name — e.g. Duty Manager"
            maxLength={120}
            autoFocus
          />
          <Textarea
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="What should it do? e.g. Help the duty manager spot risks across tasks and tonight's bookings."
            rows={3}
            maxLength={300}
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
          <Button type="button" onClick={submit} disabled={pending}>
            {pending ? "Creating…" : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
