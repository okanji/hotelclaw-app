"use client";

import Link from "next/link";
import { useParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, FileText, MoreHorizontal, Plus } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { archiveDocument, createDocument } from "./actions";

type DocRow = {
  id: string;
  title: string;
  updated_at: string;
};

/**
 * Notion-style sidebar tree of documents for the current property.
 *
 * Fetches the active doc list on mount and subscribes to Supabase realtime
 * so creates/archives from other clients land here without a refresh.
 * Mirrors the pattern in `components/chat/channel-list/channel-list-section.tsx`
 * (Stream-side) but uses Supabase realtime since documents are Postgres-backed.
 *
 * Renames are NOT exposed here — the first heading inside the editor IS the
 * title (synced to `documents.title` via the editor's onUpdate handler), so a
 * separate sidebar rename would be overwritten on next edit.
 */
export function DocumentsTreeSection({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ documentId?: string }>();
  const activeId = params?.documentId;

  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const supabase = createBrowserClient();
    let cancelled = false;

    void supabase
      .from("documents")
      .select("id, title, updated_at")
      .eq("property_id", propertyId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (cancelled) return;
        setDocs((data ?? []) as DocRow[]);
        setLoaded(true);
      });

    const channel = supabase
      .channel(`documents:${propertyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "documents",
          filter: `property_id=eq.${propertyId}`,
        },
        (payload) => {
          setDocs((current) => reduce(current, payload as RealtimePayload));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [propertyId]);

  const onCreate = useCallback(async () => {
    const res = await createDocument(propertyId);
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    router.push(`/p/${propertyId}/documents/${res.id}`);
  }, [propertyId, router]);

  const onArchive = useCallback(
    async (doc: DocRow) => {
      const res = await archiveDocument(doc.id);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      if (activeId === doc.id) {
        router.push(`/p/${propertyId}/documents`);
      }
      toast.success(`Archived "${doc.title}"`);
    },
    [activeId, propertyId, router],
  );

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Documents</SidebarGroupLabel>
      <SidebarGroupAction onClick={onCreate} title="New document">
        <Plus />
      </SidebarGroupAction>
      <SidebarGroupContent>
        {!loaded ? null : docs.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            No documents yet
          </div>
        ) : (
          <SidebarMenu>
            {docs.map((d) => {
              const isActive =
                activeId === d.id ||
                pathname === `/p/${propertyId}/documents/${d.id}`;
              return (
                <SidebarMenuItem key={d.id}>
                  <SidebarMenuButton
                    render={<Link href={`/p/${propertyId}/documents/${d.id}`} />}
                    isActive={isActive}
                    tooltip={d.title}
                  >
                    <FileText />
                    <span className="truncate">{d.title}</span>
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <SidebarMenuAction
                          showOnHover
                          aria-label="Document actions"
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start">
                      <DropdownMenuItem onClick={() => void onArchive(d)}>
                        <Archive className="size-4" /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// Reducer for Supabase realtime payloads. Keeps the most-recently-updated
// active document at the top, drops archived rows.
type RealtimePayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<DocRow & { archived_at: string | null; property_id: string }> | null;
  old: { id?: string } | null;
};

function reduce(current: DocRow[], payload: RealtimePayload): DocRow[] {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id;
    if (!id) return current;
    return current.filter((d) => d.id !== id);
  }

  const row = payload.new;
  if (!row || !row.id) return current;
  const isArchived = !!row.archived_at;
  const without = current.filter((d) => d.id !== row.id);
  if (isArchived) return without;

  const next: DocRow = {
    id: row.id,
    title: row.title ?? "Untitled document",
    updated_at: row.updated_at ?? new Date().toISOString(),
  };
  return [next, ...without].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}
