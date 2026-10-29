"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Loader2, Plus } from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { G8Empty } from "@/components/gr8r/members-shared";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { channelHref } from "@/lib/chat/channel-href";
import { createChannel } from "@/components/chat/actions";

type SpaceChannel = {
  id: string;
  name: string;
  stream_channel_id: string;
  stream_channel_type: string;
};

function spaceChannelsQuery(spaceId: string) {
  return {
    queryKey: ["space-channels", spaceId] as const,
    queryFn: async (): Promise<SpaceChannel[]> => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase
        .from("chat_channels")
        .select("id, name, stream_channel_id, stream_channel_type")
        .eq("space_id", spaceId)
        .is("archived_at", null)
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as SpaceChannel[];
    },
  };
}

/** A space's home channel(s) — list + create, scoped to this space. */
export function SpaceChannelsPanel({
  propertyId,
  spaceId,
}: {
  propertyId: string;
  spaceId: string;
}) {
  const qc = useQueryClient();
  const { data: channels = [], isPending } = useQuery(
    spaceChannelsQuery(spaceId),
  );
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const res = await createChannel({ propertyId, name: trimmed, spaceId });
    setBusy(false);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    setName("");
    void qc.invalidateQueries({ queryKey: ["space-channels", spaceId] });
    toast.success("Channel created");
  }

  return (
    <section className="panel">
      <div className="panel-h">
        <h2>Channels</h2>
        {!isPending ? <span className="faint">{channels.length}</span> : null}
        <span className="sp" />
        <input
          className="input"
          style={{ height: 28, width: 200, fontSize: 12.5 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleCreate();
            }
          }}
          placeholder="new-channel-name"
          aria-label="New channel name"
          disabled={busy}
        />
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void handleCreate()}
          disabled={busy || !name.trim()}
        >
          <Gi icon={busy ? Loader2 : Plus} size={14} className={busy ? "animate-spin" : undefined} />
          New channel
        </button>
      </div>
      {isPending ? (
        <div className="panel-b faint">Loading channels…</div>
      ) : channels.length === 0 ? (
        <G8Empty
          icon={Hash}
          title="No channels yet"
          text="Create one above to give the team a home for chat."
          sm
        />
      ) : (
        channels.map((c) => (
          <Link
            key={c.id}
            href={channelHref(propertyId, c.stream_channel_type, c.stream_channel_id)}
            className="mini"
          >
            <Gi icon={Hash} size={14} />
            <span className="tt">{c.name}</span>
          </Link>
        ))
      )}
    </section>
  );
}
