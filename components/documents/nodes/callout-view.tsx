"use client";

import { useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CalloutVariant } from "@/lib/documents/nodes/callout";

const VARIANT_STYLES: Record<CalloutVariant, string> = {
  info: "border-sky-500/30 bg-sky-500/10",
  success: "border-emerald-500/30 bg-emerald-500/10",
  warning: "border-amber-500/30 bg-amber-500/10",
  danger: "border-rose-500/30 bg-rose-500/10",
  note: "border-border bg-muted/40",
};

const VARIANT_LABEL: Record<CalloutVariant, string> = {
  info: "Info",
  success: "Success",
  warning: "Warning",
  danger: "Danger",
  note: "Note",
};

const QUICK_ICONS = ["💡", "ℹ️", "⚠️", "✅", "❌", "📌", "🔥", "🎯", "📝", "🚀"];

export function CalloutView({ node, updateAttributes, editor }: NodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) ?? "info";
  const icon = (node.attrs.icon as string) ?? "💡";
  const [open, setOpen] = useState(false);
  const editable = editor.isEditable;

  return (
    <NodeViewWrapper
      data-type="callout"
      className={cn(
        "callout my-2 flex gap-3 rounded-lg border px-3 py-2.5",
        VARIANT_STYLES[variant],
      )}
    >
      {editable ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={(props) => (
              <button
                {...props}
                type="button"
                contentEditable={false}
                className="flex size-7 shrink-0 select-none items-center justify-center rounded text-lg leading-none hover:bg-foreground/5"
                title="Change icon or color"
              >
                {icon}
              </button>
            )}
          />
          <PopoverContent
            align="start"
            sideOffset={6}
            className="!w-64 !p-2"
          >
            <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Icon
            </div>
            <div className="mb-3 grid grid-cols-5 gap-1">
              {QUICK_ICONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    updateAttributes({ icon: emoji });
                  }}
                  className={cn(
                    "flex size-9 items-center justify-center rounded text-lg hover:bg-muted",
                    icon === emoji && "bg-muted",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Tone
            </div>
            <div className="grid grid-cols-5 gap-1">
              {(Object.keys(VARIANT_STYLES) as CalloutVariant[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => updateAttributes({ variant: v })}
                  title={VARIANT_LABEL[v]}
                  className={cn(
                    "flex size-9 items-center justify-center rounded border",
                    VARIANT_STYLES[v],
                    variant === v && "ring-2 ring-foreground/50",
                  )}
                >
                  <span className="sr-only">{VARIANT_LABEL[v]}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      ) : (
        <span
          contentEditable={false}
          className="flex size-7 shrink-0 select-none items-center justify-center text-lg leading-none"
        >
          {icon}
        </span>
      )}
      <NodeViewContent className="callout-content min-w-0 flex-1 self-center text-[15px] leading-relaxed" />
    </NodeViewWrapper>
  );
}
