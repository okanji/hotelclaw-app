"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CHATBOT_TEMPLATE_DEFS } from "@/lib/chatbots/templates";
import type { ChatbotTemplate } from "@/lib/chatbots/schema";
import { createChatbot } from "./actions";

type Pick = ChatbotTemplate | "describe";

/**
 * Template gallery for a new chatbot: the three flagship presets, a blank
 * custom bot, or "describe it" — a prompt sent to the Haiku generate route
 * which drafts the full config (forms/generate pattern).
 */
export function NewChatbotDialog({
  propertyId,
  open,
  onOpenChange,
}: {
  propertyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<Pick>("front_desk");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  const needsDescription = pick === "describe";

  function create(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      let config: unknown;
      if (needsDescription) {
        const res = await fetch(
          `/api/properties/${propertyId}/chatbots/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ description }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          toast.error(body?.error ?? "Couldn't draft that chatbot — try again");
          return;
        }
        const drafted = await res.json();
        config = drafted.config;
      }

      const result = await createChatbot({
        propertyId,
        name: name.trim(),
        template: needsDescription ? "custom" : pick,
        config,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setName("");
      setDescription("");
      onOpenChange(false);
      router.push(`/p/${propertyId}/chatbots/${result.chatbotId}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New chatbot</DialogTitle>
          <DialogDescription>
            Start from a template, or describe the bot you need and AI will
            draft its instructions and actions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {CHATBOT_TEMPLATE_DEFS.map((def) => (
              <TemplateCard
                key={def.template}
                selected={pick === def.template}
                emoji={def.emoji}
                title={def.name}
                tagline={def.tagline}
                onClick={() => setPick(def.template)}
              />
            ))}
            <TemplateCard
              selected={pick === "custom"}
              emoji="🧩"
              title="Custom"
              tagline="A blank bot — write your own instructions"
              onClick={() => setPick("custom")}
            />
            <TemplateCard
              selected={pick === "describe"}
              icon={<Sparkles className="size-4" />}
              title="Describe it"
              tagline="Tell AI what the bot should do"
              onClick={() => setPick("describe")}
            />
          </div>

          {needsDescription ? (
            <div className="space-y-2">
              <Label htmlFor="new-bot-description">What should it do?</Label>
              <Textarea
                id="new-bot-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A poolside bar bot that answers drink-menu questions and takes orders with the guest's sunbed number…"
                rows={3}
                disabled={pending}
                required
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="new-bot-name">Name</Label>
            <Input
              id="new-bot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                needsDescription ? "Poolside Bar" : "Front Desk Assistant"
              }
              disabled={pending}
              required
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
            <Button
              type="submit"
              disabled={
                pending || !name.trim() || (needsDescription && !description.trim())
              }
            >
              {pending
                ? needsDescription
                  ? "Drafting…"
                  : "Creating…"
                : "Create chatbot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TemplateCard({
  selected,
  emoji,
  icon,
  title,
  tagline,
  onClick,
}: {
  selected: boolean;
  emoji?: string;
  icon?: React.ReactNode;
  title: string;
  tagline: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-foreground/40 bg-muted/50"
          : "border-border bg-background hover:bg-muted/30",
      )}
    >
      <span className="flex size-7 items-center justify-center rounded-md border border-border bg-muted/50 text-sm">
        {emoji ?? icon ?? <Bot className="size-4" />}
      </span>
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs leading-snug text-muted-foreground">
        {tagline}
      </span>
    </button>
  );
}
