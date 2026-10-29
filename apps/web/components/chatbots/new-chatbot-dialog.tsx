"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Sparkles } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** gr8r palette, rotated across the template tiles. */
const TILE_G8 = [
  "var(--g8-blue)",
  "var(--g8-amber)",
  "var(--g8-green)",
  "var(--g8-violet)",
  "var(--g8-teal)",
  "var(--g8-rose)",
];
const tileAt = (i: number) => TILE_G8[i % TILE_G8.length];
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
      {/* Portaled out of the shell — `g8 g8-port` for gr8r classes. */}
      <DialogContent className="g8 g8-port sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New chatbot</DialogTitle>
          <DialogDescription>
            Start from a template, or describe the bot you need and AI will
            draft its instructions and actions.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="stack" style={{ gap: 14 }}>
          <div className="tmpls" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {CHATBOT_TEMPLATE_DEFS.map((def, i) => (
              <TemplateCard
                key={def.template}
                selected={pick === def.template}
                emoji={def.emoji}
                tone={tileAt(i)}
                title={def.name}
                tagline={def.tagline}
                onClick={() => setPick(def.template)}
              />
            ))}
            <TemplateCard
              selected={pick === "custom"}
              emoji="🧩"
              tone={tileAt(CHATBOT_TEMPLATE_DEFS.length)}
              title="Custom"
              tagline="A blank bot — write your own instructions"
              onClick={() => setPick("custom")}
            />
            <TemplateCard
              selected={pick === "describe"}
              icon={<Gi icon={Sparkles} size={15} />}
              tone={tileAt(CHATBOT_TEMPLATE_DEFS.length + 1)}
              title="Describe it"
              tagline="Tell AI what the bot should do"
              onClick={() => setPick("describe")}
            />
          </div>

          {needsDescription ? (
            <label className="field" htmlFor="new-bot-description">
              <span className="label">What should it do?</span>
              <textarea
                className="textarea"
                id="new-bot-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="A poolside bar bot that answers drink-menu questions and takes orders with the guest's sunbed number…"
                rows={3}
                disabled={pending}
                required
              />
            </label>
          ) : null}

          <label className="field" htmlFor="new-bot-name">
            <span className="label">Name</span>
            <input
              className="input"
              id="new-bot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                needsDescription ? "Poolside Bar" : "Front Desk Assistant"
              }
              disabled={pending}
              required
            />
          </label>

          <DialogFooter>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={
                pending || !name.trim() || (needsDescription && !description.trim())
              }
            >
              {pending
                ? needsDescription
                  ? "Drafting…"
                  : "Creating…"
                : "Create chatbot"}
            </button>
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
  tone,
  title,
  tagline,
  onClick,
}: {
  selected: boolean;
  emoji?: string;
  icon?: React.ReactNode;
  /** gr8r palette token for the tile. */
  tone: string;
  title: string;
  tagline: string;
  onClick: () => void;
}) {
  // gr8r `.tcard` (settings' theme tiles): bordered, accent ring when on.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={selected ? "tcard on" : "tcard"}
      style={{ padding: 10, gap: 6 }}
    >
      <span className="picon" style={{ "--g8-c": tone } as React.CSSProperties}>
        {emoji ? <span style={{ fontSize: 15, lineHeight: 1 }}>{emoji}</span> : (icon ?? <Gi icon={Bot} size={15} />)}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{title}</span>
      <span className="muted" style={{ fontSize: 12, lineHeight: 1.35 }}>
        {tagline}
      </span>
    </button>
  );
}
