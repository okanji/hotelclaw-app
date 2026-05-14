"use client";

import { useOthers, useSelf } from "@liveblocks/react/suspense";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MAX_VISIBLE = 4;

/**
 * Slack-style stacked avatars for every user currently connected to the
 * document's Liveblocks room. Self is rendered first; remaining "+N" pill
 * surfaces overflow.
 */
export function DocumentAvatars() {
  const self = useSelf();
  const others = useOthers();
  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <TooltipProvider delay={200}>
      <div className="flex items-center -space-x-2">
        {self ? <AvatarChip user={self} isSelf /> : null}
        {visible.map((other) => (
          <AvatarChip key={other.connectionId} user={other} />
        ))}
        {overflow > 0 ? (
          <span className="relative z-10 inline-flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-semibold text-muted-foreground">
            +{overflow}
          </span>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

type AvatarUser = {
  info?: { name?: string; avatar?: string };
};

function AvatarChip({ user, isSelf }: { user: AvatarUser; isSelf?: boolean }) {
  const name = user.info?.name ?? "User";
  const avatar = user.info?.avatar;
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <span {...props} className={cn("relative inline-block")}>
            <Avatar
              className={cn(
                "size-7 border-2 border-background",
                isSelf && "ring-1 ring-primary/40",
              )}
            >
              <AvatarImage src={avatar ?? undefined} alt={name} />
              <AvatarFallback className="text-[10px]">
                {initials || "?"}
              </AvatarFallback>
            </Avatar>
          </span>
        )}
      />
      <TooltipContent>{isSelf ? `${name} (you)` : name}</TooltipContent>
    </Tooltip>
  );
}
