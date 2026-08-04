"use client";

/**
 * Share button + popover for the document header strip.
 *
 * Scope (v1): show who has access (current property members) and let the
 * user copy a direct link to the doc. Per-doc permission overrides and
 * public/external sharing are deferred — they'd need a `document_shares`
 * table and a separate RLS path, which is its own plan.
 *
 * Access is property-membership today (RLS in 0009_documents.sql), so the
 * member list is just `property_members` for the current propertyId.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Lock, Share2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { createClient as createBrowserClient } from "@/lib/supabase/client";

type Member = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
};

export function DocumentShare({
  propertyId,
  documentId,
}: {
  propertyId: string;
  documentId: string;
}) {
  const supabase = createBrowserClient();
  const [open, setOpen] = useState(false);

  const { data: members } = useQuery({
    queryKey: ["doc-share-members", propertyId],
    enabled: open, // only fetch when the popover opens
    queryFn: async (): Promise<Member[]> => {
      // Two-step lookup: memberships → profiles. Same pattern the bots use
      // because memberships.user_id FKs to auth.users, not to profiles.
      const { data: ms, error } = await supabase
        .from("memberships")
        .select("user_id, role")
        .eq("property_id", propertyId);
      if (error) throw error;
      const rows = ms ?? [];
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      const profById = new Map(
        (profiles ?? []).map((p) => [p.id, p]),
      );
      return rows.map((r) => {
        const prof = profById.get(r.user_id);
        return {
          user_id: r.user_id,
          full_name: prof?.full_name ?? null,
          avatar_url: prof?.avatar_url ?? null,
          role: r.role ?? null,
        };
      });
    },
  });

  async function copyLink() {
    const url = `${window.location.origin}/p/${propertyId}/documents/${documentId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Share2 className="size-3.5" />
            Share
          </button>
        )}
      />
      <PopoverContent align="end" sideOffset={6} className="!w-[340px] !p-3">
        <header className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium text-foreground">
            Share document
          </div>
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
            title="Copy link"
          >
            <Copy className="size-3.5" />
            Copy link
          </button>
        </header>

        <div className="mb-3 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" />
          <span>
            Anyone in this property has access. External and per-doc sharing
            isn't available yet.
          </span>
        </div>

        <div className="mb-1 px-1 text-xs leading-3 font-medium text-faint-foreground">
          People with access
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {(members ?? []).map((m) => {
            const initials = (m.full_name ?? "?")
              .split(/\s+/)
              .slice(0, 2)
              .map((s) => s[0]?.toUpperCase() ?? "")
              .join("");
            return (
              <li
                key={m.user_id}
                className="flex min-h-[30px] items-center gap-2 rounded-md px-1.5 py-1"
              >
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.avatar_url}
                    alt=""
                    className="size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                    {initials}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-foreground">
                    {m.full_name ?? "Member"}
                  </div>
                </div>
                <span className="shrink-0 text-xs capitalize text-faint-foreground">
                  {m.role ?? "Member"}
                </span>
              </li>
            );
          })}
          {(members ?? []).length === 0 ? (
            <li className="px-1.5 py-2 text-sm text-muted-foreground">
              No members yet.
            </li>
          ) : null}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
