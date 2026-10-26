"use client";

import { contextUsage, formatTokens, type TurnUsage } from "@hotelclaw/chat-ui/turn";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Progress } from "@/components/ui/progress";

/**
 * Context meter for one reply — the shadcn/ui AI Elements "Context"
 * pattern (ui.shadcn.com/docs/ai-elements/base/context): a Hover Card on a
 * small button that reads "N% context", with a Progress bar and the token
 * breakdown inside. The arithmetic (window from the model id, the last
 * step's input as "how full") is `contextUsage` in `@hotelclaw/chat-ui/turn`,
 * shared with the phone.
 */
export function TurnUsageMeter({ usage }: { usage: TurnUsage }) {
  const context = contextUsage(usage);

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={10}
        closeDelay={100}
        render={
          <Button
            variant="ghost"
            size="xs"
            className="text-faint-foreground hover:text-foreground"
          />
        }
      >
        {context.percent}% context
      </HoverCardTrigger>
      <HoverCardContent className="flex w-64 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">Context</span>
          <span className="text-muted-foreground">
            {formatTokens(context.used)} / {formatTokens(context.limit)}
          </span>
        </div>
        <Progress value={context.percent} aria-label="Context used" />
        <div className="flex flex-col gap-1 text-sm">
          {context.rows.map((row) => (
            <div key={row.label} className="flex justify-between gap-3">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="tabular-nums">{row.value}</span>
            </div>
          ))}
        </div>
        {context.footer ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
            <span className="min-w-0 truncate font-mono">{context.model ?? "model"}</span>
            <span className="tabular-nums">{context.footer}</span>
          </div>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
