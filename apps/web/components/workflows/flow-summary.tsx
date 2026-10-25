"use client";

import {
  ArrowRight,
  Bot,
  CalendarCheck,
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
import { cn } from "@/lib/utils";

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
  { prefix: "booking.", icon: CalendarCheck },
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
      <p className={cn("text-xs text-faint-foreground", className)}>
        Draft — no trigger set up yet
      </p>
    );
  }
  const Icon = TRIGGER_ICONS.find((t) => trigger.startsWith(t.prefix))?.icon ?? Zap;
  const action = primaryAction(stepTypes);
  return (
    <p
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{triggerLabel(trigger)}</span>
      {action ? (
        <>
          <ArrowRight className="size-3 shrink-0 text-faint-foreground" aria-hidden />
          <span className="truncate">{action.label}</span>
          {action.more > 0 ? (
            <span className="shrink-0 text-faint-foreground">+{action.more}</span>
          ) : null}
        </>
      ) : null}
    </p>
  );
}
