"use client";

import {
  ArrowRight,
  Bot,
  CalendarClock,
  ClipboardList,
  Clock,
  Database,
  FileText,
  ListChecks,
  MessageSquare,
  Mic,
  Play,
  Webhook,
  Zap,
} from "lucide-react";
import { primaryAction, triggerLabel } from "@/lib/workflows/summary";
import { Gi } from "@/components/gr8r/icon";

// The row's second line answers "what does this do?" the way Linear's loop
// cards do: the TRIGGER (the cause) → the first real ACTION (the outcome). We
// deliberately don't surface the engine's instant/durable mode — it's
// internal and reads as "fires only once" for a recurring workflow. Icon is
// keyed on the trigger family; labels come from the catalog so they match the
// builder's vocabulary.
const TRIGGER_ICONS: { prefix: string; icon: typeof Clock }[] = [
  { prefix: "task.", icon: ListChecks },
  { prefix: "chat.", icon: MessageSquare },
  { prefix: "doc.", icon: FileText },
  { prefix: "meeting.", icon: Mic },
  { prefix: "calendar.", icon: CalendarClock },
  { prefix: "entity.", icon: Database },
  { prefix: "schedule.", icon: Clock },
  { prefix: "manual.", icon: Play },
  { prefix: "webhook.", icon: Webhook },
  { prefix: "form.", icon: ClipboardList },
  { prefix: "chatbot.", icon: Bot },
];

export function FlowSummary({
  trigger,
  stepTypes,
  className,
}: {
  trigger: string | null;
  stepTypes: readonly string[];
  className?: string;
}) {
  if (!trigger) {
    return (
      <span className={className ? `faint ${className}` : "faint"} style={{ fontSize: 12 }}>
        Draft — no trigger set up yet
      </span>
    );
  }
  const Icon = TRIGGER_ICONS.find((t) => trigger.startsWith(t.prefix))?.icon ?? Zap;
  const action = primaryAction(stepTypes);
  // gr8r row: muted 12px line, faint arrow + "+N".
  return (
    <span
      className={className ? `row muted ${className}` : "row muted"}
      style={{ gap: 6, fontSize: 12, minWidth: 0 }}
    >
      <Gi icon={Icon} size={13} />
      <span className="trunc">{triggerLabel(trigger)}</span>
      {action ? (
        <>
          <span className="faint" style={{ display: "inline-flex" }}>
            <Gi icon={ArrowRight} size={12} />
          </span>
          <span className="trunc">{action.label}</span>
          {action.more > 0 ? (
            <span className="faint" style={{ flexShrink: 0 }}>
              +{action.more}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
