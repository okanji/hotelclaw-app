"use client";

import { Button } from "@/components/ui/button";
import { ChevronDown, Headphones, PhoneOff } from "lucide-react";
import { useHuddle } from "@/lib/stream/huddle-context";

/**
 * Channel-header trigger for huddles. Three states:
 *   - In a huddle for this channel  → red "Leave"
 *   - In a huddle elsewhere         → button shows "Huddle" but joining
 *                                     auto-leaves the other call (handled in
 *                                     the context's `join` method)
 *   - Not in any huddle             → "Huddle"
 */
export function HuddleButton({ channelId }: { channelId: string }) {
  const { call, channelId: activeChannel, joining, videoReady, join, leave } =
    useHuddle();
  const isHere = !!call && activeChannel === channelId;

  if (isHere) {
    return (
      <Button
        variant="ghost"
        size="default"
        title="Leave huddle"
        aria-label="Leave huddle"
        className="gap-1 px-2.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => void leave()}
      >
        <PhoneOff className="size-4" />
        <span>Leave</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="default"
      title={videoReady ? "Start huddle" : "Voice not ready"}
      aria-label="Start huddle"
      className="gap-1 px-2.5"
      disabled={!videoReady || joining}
      onClick={() => void join(channelId)}
    >
      <Headphones className="size-4" />
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </Button>
  );
}
