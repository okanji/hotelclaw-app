"use client";

import { useEffect, useRef } from "react";
import type { PropertyChannel } from "@/lib/chat/channels";
import { WorkflowSelect } from "@/components/workflows/builder/workflow-select";
import { TemplateField } from "@/components/workflows/builder/config/template-field";
import type { RefCandidate } from "@/lib/workflows/refs";

const TRIGGER_CHANNEL_REF = "{{trigger.channel.id}}";

function pureRefPath(value: string): string | null {
  const m = (value ?? "").match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  return m ? m[1]!.trim() : null;
}

function defaultChannelValue(
  channels: PropertyChannel[],
  triggerEventType?: string,
): string | null {
  if (channels.length === 0) return null;
  if (triggerEventType?.startsWith("chat.")) return TRIGGER_CHANNEL_REF;
  return channels[0]!.streamChannelId;
}

export function ChannelField({
  value,
  onChange,
  channels,
  channelsLoading,
  triggerEventType,
  refs,
}: {
  value: string;
  onChange: (next: string) => void;
  channels: PropertyChannel[];
  channelsLoading?: boolean;
  triggerEventType?: string;
  refs: RefCandidate[];
}) {
  const didPrefill = useRef(false);

  useEffect(() => {
    didPrefill.current = false;
  }, [triggerEventType, channels.map((c) => c.streamChannelId).join(",")]);

  useEffect(() => {
    if (didPrefill.current) return;
    if (channelsLoading) return;
    const cur = (value ?? "").trim();
    if (cur) return;
    const next = defaultChannelValue(channels, triggerEventType);
    if (!next) return;
    didPrefill.current = true;
    onChange(next);
  }, [value, channels, channelsLoading, triggerEventType, onChange]);

  const isTriggerChannel = value === TRIGGER_CHANNEL_REF;
  const bound = pureRefPath(value);
  const knownId = channels.some((c) => c.streamChannelId === value);

  if (
    (bound && !isTriggerChannel) ||
    (!knownId && !isTriggerChannel && value.trim() !== "") ||
    channels.length === 0
  ) {
    return (
      <TemplateField
        value={value}
        onChange={onChange}
        placeholder={
          channels[0] ? `e.g. ${channels[0].name}` : "front-desk"
        }
        mono
        refs={refs}
      />
    );
  }

  const chatTrigger = triggerEventType?.startsWith("chat.");

  return (
    <WorkflowSelect
      ariaLabel="Channel"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={channelsLoading}
    >
      {chatTrigger && (
        <option value={TRIGGER_CHANNEL_REF}>Same channel as trigger</option>
      )}
      {channels.map((c) => (
        <option key={c.streamChannelId} value={c.streamChannelId}>
          #{c.name}
        </option>
      ))}
    </WorkflowSelect>
  );
}
