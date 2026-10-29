"use client";

import { useState } from "react";
import { useChannelStateContext, useChatContext } from "stream-chat-react";
import { Settings } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
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
    <div className="stack" style={{ gap: 14, padding: "4px 4px 0" }}>
      <dl className="kv">
        <dt>Name</dt>
        <dd className="trunc">{data?.name ?? channel.id ?? "—"}</dd>
        <dt>Type</dt>
        <dd>{channel.type === "messaging" ? "Direct message" : "Channel"}</dd>
        <dt>Privacy</dt>
        <dd>{data?.is_private ? "Private" : "Public"}</dd>
        <dt>Members</dt>
        <dd className="num">
          {(data as { member_count?: number } | undefined)?.member_count ??
            Object.keys(channel.state.members ?? {}).length}
        </dd>
        <dt>Created</dt>
        <dd>
          {data?.created_at
            ? new Date(data.created_at).toLocaleDateString()
            : "—"}
        </dd>
      </dl>
      {data?.description ? (
        <div>
          <div className="label" style={{ marginBottom: 4 }}>
            Description
          </div>
          <p
            className="muted"
            style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "var(--g8-fs-sm)" }}
          >
            {data.description}
          </p>
        </div>
      ) : null}

      {isTeamChannel && canEdit ? (
        <div style={{ borderTop: "1px solid var(--g8-divider)", paddingTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setOpen(true)}
          >
            <Gi icon={Settings} size={14} />
            Channel settings
          </button>
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
