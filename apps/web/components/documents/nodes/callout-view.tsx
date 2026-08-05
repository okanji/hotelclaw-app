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

/**
 * A callout is a FILL, not a bordered box (notion-spec §1 — surfaces separate
 * by fill, never a visible stroke). Tones come from the shared semantic ramp
 * so a callout can never drift from the app's other status colours.
 *
 * The untinted rung is the **chrome plane token** (`bg-background`, `#f9f8f7`)
 * — notion-spec-v2 §6 measured Notion's default callout as literally the same
 * fill as its sidebar, not a separate grey. Geometry is the SURFACE rung: 10px
 * radius (`rounded-card`) and 12px padding (`p-3`), not the 6px clickable rung.
 */
const VARIANT_STYLES: Record<CalloutVariant, string> = {
  info: "bg-info/10",
  success: "bg-success/10",
  warning: "bg-warning/10",
  danger: "bg-destructive/10",
  note: "bg-background",
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
        "callout my-2 flex gap-3 rounded-card p-3",
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
                className="flex size-7 shrink-0 select-none items-center justify-center rounded-md text-lg leading-none transition-colors hover:bg-accent"
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
            <div className="mb-2 px-1 text-xs leading-3 font-medium text-faint-foreground">
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
                    "flex size-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-accent",
                    icon === emoji && "bg-accent-pressed",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <div className="mb-2 px-1 text-xs leading-3 font-medium text-faint-foreground">
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
                    "flex size-8 items-center justify-center rounded-md",
                    VARIANT_STYLES[v],
                    variant === v && "shadow-focus",
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
      <NodeViewContent className="callout-content min-w-0 flex-1 self-center text-base leading-6" />
    </NodeViewWrapper>
  );
}
