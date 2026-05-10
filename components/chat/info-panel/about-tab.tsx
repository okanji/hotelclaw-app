"use client";

import { useChannelStateContext } from "stream-chat-react";

export function AboutTab() {
  const { channel } = useChannelStateContext();
  const data = channel.data as
    | {
        name?: string;
        description?: string;
        is_private?: boolean;
        property_id?: string;
        created_at?: string;
      }
    | undefined;

  return (
    <dl className="space-y-3 text-sm">
      <Row label="Name" value={data?.name ?? channel.id ?? "—"} />
      <Row label="Type" value={channel.type} />
      <Row label="Privacy" value={data?.is_private ? "Private" : "Public"} />
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
