"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { groupRefs, type RefCandidate } from "@/lib/workflows/refs";

export type AvailableFieldsMode = "condition" | "template" | "both";

/**
 * Expandable catalog of fields this step/trigger can reference — with copyable
 * paths for JSONLogic conditions vs {{template}} strings.
 */
export function AvailableFieldsPanel({
  refs,
  mode = "both",
  defaultOpen = false,
  className,
}: {
  refs: RefCandidate[];
  mode?: AvailableFieldsMode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState<string | null>(null);
  const grouped = useMemo(() => groupRefs(refs), [refs]);

  if (grouped.length === 0) return null;

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      window.setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className={cn(
        "rounded-lg border border-border/60 bg-muted/[0.04]",
        className,
      )}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[0.8125rem] text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="font-medium">Field reference (for advanced editing)</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </summary>
      <div className="space-y-3 border-t border-border/60 px-3 py-3">
        {(mode === "condition" || mode === "both") && (
          <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
            Most people won’t need this — the builders above handle it for you. When editing a
            condition by hand, reference a field like:{" "}
            <code className="rounded bg-muted/60 px-1 font-mono text-[0.6875rem]">
              {`{ "var": "trigger.new.priority" }`}
            </code>
          </p>
        )}
        {(mode === "template" || mode === "both") && (
          <p className="text-[0.75rem] leading-relaxed text-muted-foreground">
            In <span className="font-medium text-foreground/80">text fields</span>, prefer the{" "}
            <span className="font-medium text-foreground/80">Insert data</span> button. To type a
            reference by hand, wrap the path:{" "}
            <code className="rounded bg-muted/60 px-1 font-mono text-[0.6875rem]">
              {`{{trigger.new.priority}}`}
            </code>{" "}
            or step output{" "}
            <code className="rounded bg-muted/60 px-1 font-mono text-[0.6875rem]">
              {`{{steps.my_step.output.label}}`}
            </code>
          </p>
        )}
        <div className="max-h-[220px] space-y-3 overflow-y-auto">
          {grouped.map(({ group, items }) => (
            <div key={group}>
              <p className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                {group}
              </p>
              <ul className="space-y-1">
                {items.map((item) => {
                  const conditionPath = item.path;
                  const templatePath = `{{${item.path}}}`;
                  const copyValue =
                    mode === "template"
                      ? templatePath
                      : mode === "condition"
                        ? conditionPath
                        : conditionPath;
                  return (
                    <li
                      key={item.path}
                      className="flex items-start justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <p className="text-[0.8125rem] text-foreground/90">{item.label}</p>
                        <code className="block truncate font-mono text-[0.6875rem] text-muted-foreground">
                          {mode === "template" ? templatePath : conditionPath}
                        </code>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Copy path"
                        onClick={() => copyText(copyValue)}
                      >
                        {copied === copyValue ? (
                          <Check className="size-3.5 text-emerald-600" aria-hidden />
                        ) : (
                          <Copy className="size-3.5" aria-hidden />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
