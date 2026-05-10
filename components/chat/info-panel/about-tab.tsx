"use client";

import { useState } from "react";
import { useChannelStateContext, useChatContext } from "stream-chat-react";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { ChannelSettingsDialog } from "./channel-settings-dialog";
import { useMyRole } from "./use-my-role";

export function AboutTab({ propertyId }: { propertyId: string }) {
  const { channel } = useChannelStateContext();
  const { client } = useChatContext();
  const role = useMyRole(propertyId, client?.user?.id);
  const canEdit = role === "owner" || role === "manager";
  const [open, setOpen] = useState(false);

  const data = channel.data as
    | {
        name?: string;
        description?: string;
        is_private?: boolean;
        property_id?: string;
        created_at?: string;
      }
    | undefined;

  // Only team channels are admin-able for now. DMs don't have settings.
  const isTeamChannel = channel.type === "team";

  return (
    <div className="space-y-4">
      <dl className="space-y-3 text-sm">
        <Row label="Name" value={data?.name ?? channel.id ?? "—"} />
        <Row label="Type" value={channel.type} />
        <Row
          label="Privacy"
          value={data?.is_private ? "Private" : "Public"}
        />
        <Row
          label="Members"
          value={String(
            (data as { member_count?: number } | undefined)?.member_count ??
              Object.keys(channel.state.members ?? {}).length,
          )}
        />
        <Row
          label="Created"
          value={
            data?.created_at
              ? new Date(data.created_at).toLocaleDateString()
              : "—"
          }
        />
        {data?.description ? (
          <div className="space-y-1 pt-2">
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Description
            </dt>
            <dd className="whitespace-pre-wrap text-sm">{data.description}</dd>
          </div>
        ) : null}
      </dl>

      {isTeamChannel && canEdit ? (
        <div className="border-t pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            <Settings className="size-4" />
            Channel settings
          </Button>
          <ChannelSettingsDialog
            propertyId={propertyId}
            open={open}
            onOpenChange={setOpen}
          />
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
