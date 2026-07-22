"use client";

import { useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import {
  channelCreationQueryOptions,
  type ChannelCreationPolicy,
} from "@/lib/query/chat-queries";
import { setChannelCreationPolicy } from "./actions";

type Props = {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const POLICIES: { value: ChannelCreationPolicy; label: string; hint: string }[] =
  [
    {
      value: "everyone",
      label: "Everyone",
      hint: "Any member can create channels",
    },
    {
      value: "management",
      label: "Managers only",
      hint: "Only owners and managers can create channels",
    },
  ];

/** Owner/manager-only workspace chat settings (who can create channels). */
export function ChannelPolicyDialog({ propertyId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { data: policy } = useQuery(channelCreationQueryOptions(propertyId));
  const [pending, startTransition] = useTransition();

  function onChange(value: string) {
    const next = value as ChannelCreationPolicy;
    startTransition(async () => {
      const result = await setChannelCreationPolicy({ propertyId, policy: next });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["channel-creation-policy", propertyId],
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Channel settings</DialogTitle>
          <DialogDescription>Who can create channels?</DialogDescription>
        </DialogHeader>
        <RadioGroup
          value={policy ?? "everyone"}
          onValueChange={onChange}
          disabled={pending}
          className="gap-3"
        >
          {POLICIES.map((p) => (
            <div key={p.value} className="flex items-start gap-3">
              <RadioGroupItem value={p.value} id={`chan-policy-${p.value}`} />
              <div className="grid gap-0.5">
                <Label htmlFor={`chan-policy-${p.value}`}>{p.label}</Label>
                <p className="text-xs text-muted-foreground">{p.hint}</p>
              </div>
            </div>
          ))}
        </RadioGroup>
      </DialogContent>
    </Dialog>
  );
}
