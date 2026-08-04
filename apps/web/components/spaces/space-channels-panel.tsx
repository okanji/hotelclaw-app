"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Hash, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleCreate();
            }
          }}
          placeholder="new-channel-name"
          disabled={busy}
          className="h-9 max-w-xs"
        />
        <Button
          type="button"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={busy || !name.trim()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          New channel
        </Button>
      </div>

      {isPending ? (
        <p className="text-sm text-muted-foreground">Loading channels…</p>
      ) : channels.length === 0 ? (
        <p className="py-2 text-sm text-pretty text-muted-foreground">
          No channels for this space yet. Create one above to give the
          department a home for chat.
        </p>
      ) : (
        <ul
          role="list"
          className="flex flex-col divide-y divide-border border-t border-border"
        >
          {channels.map((c) => (
            <li key={c.id}>
              <Link
                href={channelHref(propertyId, c.stream_channel_type, c.stream_channel_id)}
                className="flex items-center gap-3 rounded-md px-1 min-h-[34px] py-1.5 transition-colors hover:bg-accent"
              >
                <Hash className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                  {c.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
