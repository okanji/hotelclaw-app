"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Copy,
  ExternalLink,
  MoreHorizontal,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TintIcon } from "@/components/ui/tint-card";
import { parseChatbotConfig, type ChatbotTemplate } from "@/lib/chatbots/schema";
import { NewChatbotDialog } from "./new-chatbot-dialog";
import { deleteChatbot } from "./actions";
import { EmptyState } from "@/components/ui/empty-state";
import { PageShell } from "@/components/ui/page-shell";

export type ChatbotListItem = {
  id: string;
  name: string;
  public_slug: string;
  template: ChatbotTemplate;
  config: unknown;
  status: "draft" | "published" | "paused";
  daily_message_cap: number;
  session_message_cap: number;
  last_trained_at: string | null;
  created_at: string;
  updated_at: string;
};

const TEMPLATE_LABELS: Record<ChatbotTemplate, string> = {
  front_desk: "Front desk",
  room_service: "Room service",
  restaurant: "Restaurant",
  custom: "Custom",
};

export function ChatbotStatusBadge({
  status,
}: {
  status: ChatbotListItem["status"];
}) {
  if (status === "published") {
    return <StatusBadge tone="success">Live</StatusBadge>;
  }
  if (status === "paused") {
    return <StatusBadge tone="warning">Paused</StatusBadge>;
  }
  return <StatusBadge tone="neutral">Draft</StatusBadge>;
}

/** Chatbots index — cards for every bot, plus the template-gallery entry
 *  point. The sidebar's "New chatbot" link lands here with ?new=1. */
export function ChatbotsList({
  propertyId,
  chatbots,
  usageToday,
}: {
  propertyId: string;
  chatbots: ChatbotListItem[];
  usageToday: Record<string, number>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Sidebar "New chatbot" navigates to ?new=1 — open the dialog on arrival
  // and clean the param so closing it doesn't reopen on refresh.
  const wantsNew = params.get("new") === "1";
  const [newOpen, setNewOpen] = useState(wantsNew);
  const [deleting, setDeleting] = useState<ChatbotListItem | null>(null);
  const base = `/p/${propertyId}/chatbots`;
  const view = params.get("view") ?? "all";

  useEffect(() => {
    if (wantsNew) router.replace(base);
  }, [wantsNew, router, base]);

  // Adjust-state-during-render (house pattern, see shell-section-context):
  // a later in-page navigation to ?new=1 reopens the dialog without an effect.
  const [prevWantsNew, setPrevWantsNew] = useState(wantsNew);
  if (wantsNew !== prevWantsNew) {
    setPrevWantsNew(wantsNew);
    if (wantsNew) setNewOpen(true);
  }

  const visible = chatbots.filter((bot) => {
    if (view === "published") return bot.status === "published";
    if (view === "drafts") return bot.status === "draft";
    return true;
  });

  return (
    <PageShell className="flex h-full flex-col overflow-y-auto px-8 pt-12 pb-16 sm:px-14 sm:pt-16">
      <SectionHeader
        size="page"
        className="flex-wrap gap-y-3"
        title="Chatbots"
        description="Build AI chatbots your guests talk to — a front desk that answers questions, room service that takes orders, a restaurant that books tables. They act on real requests: tickets for your team, channel pings, human handoff."
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Plus data-slot="icon" />
            New chatbot
          </Button>
        }
      />

      {/* Masthead and content separate by WHITESPACE. The full-width rule
          that used to sit here read as a seam under a 720px document
          column (notion-spec-v2 §1/§3). */}
      <div className="h-10" />

      {visible.length === 0 ? (
        <ChatbotsEmpty onCreate={() => setNewOpen(true)} filtered={view !== "all"} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((bot) => (
            <ChatbotCard
              key={bot.id}
              bot={bot}
              href={`${base}/${bot.id}`}
              messagesToday={usageToday[bot.id] ?? 0}
              onDelete={() => setDeleting(bot)}
            />
          ))}
        </div>
      )}

      <NewChatbotDialog
        propertyId={propertyId}
        open={newOpen}
        onOpenChange={setNewOpen}
      />
      <DeleteChatbotDialog
        bot={deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        onDeleted={() => {
          setDeleting(null);
          router.refresh();
        }}
      />
    </PageShell>
  );
}

function ChatbotCard({
  bot,
  href,
  messagesToday,
  onDelete,
}: {
  bot: ChatbotListItem;
  href: string;
  messagesToday: number;
  onDelete: () => void;
}) {
  const router = useRouter();
  const config = parseChatbotConfig(bot.config);
  const guestPath = `/g/${bot.public_slug}`;
  const usagePct = Math.min(
    100,
    Math.round((messagesToday / Math.max(1, bot.daily_message_cap)) * 100),
  );

  function copyGuestLink() {
    navigator.clipboard.writeText(`${window.location.origin}${guestPath}`);
    toast.success("Guest link copied");
  }

  return (
    <div className="group relative flex flex-col gap-3 rounded-card bg-card p-4 shadow-card transition-colors hover:bg-accent">
      <Link href={href} className="absolute inset-0" aria-label={bot.name} />
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <TintIcon tone="lavender" className="text-base">
            {config.appearance.avatarEmoji || <Bot />}
          </TintIcon>
          <div className="min-w-0">
            <p className="truncate text-base leading-6 font-normal">{bot.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {TEMPLATE_LABELS[bot.template]}
            </p>
          </div>
        </div>
        <div className="relative z-10 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                  aria-label="Chatbot actions"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => router.push(href)}>
                <PenLine data-slot="icon" />
                Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={copyGuestLink}>
                <Copy data-slot="icon" />
                Copy guest link
              </DropdownMenuItem>
              {bot.status === "published" ? (
                <DropdownMenuItem
                  onClick={() => window.open(guestPath, "_blank")}
                >
                  <ExternalLink data-slot="icon" />
                  Open guest page
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 data-slot="icon" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <ChatbotStatusBadge status={bot.status} />
        <span className="tabular-nums">
          {messagesToday}/{bot.daily_message_cap} today
        </span>
        {/* Tiny cap meter — fills as today's replies approach the budget. */}
        <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
          <span
            className={
              usagePct >= 100
                ? "block h-full rounded-full bg-destructive"
                : usagePct >= 80
                  ? "block h-full rounded-full bg-warning"
                  : "block h-full rounded-full bg-success"
            }
            style={{ width: `${usagePct}%` }}
          />
        </span>
      </div>
    </div>
  );
}

function ChatbotsEmpty({
  onCreate,
  filtered,
}: {
  onCreate: () => void;
  filtered: boolean;
}) {
  return (
    <EmptyState
      icon={Bot}
      title={filtered ? "Nothing here" : "No chatbots yet"}
      action={
        <Button onClick={onCreate}>
          <Plus data-slot="icon" />
          New chatbot
        </Button>
      }
    >
      {filtered
        ? "No chatbots match this view."
        : "Start from a template — front desk, room service, restaurant — or describe your own and let AI draft it."}
    </EmptyState>
  );
}

function DeleteChatbotDialog({
  bot,
  onOpenChange,
  onDeleted,
}: {
  bot: ChatbotListItem | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function confirm() {
    if (!bot) return;
    startTransition(async () => {
      const result = await deleteChatbot(bot.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Chatbot deleted");
      onDeleted();
    });
  }

  return (
    <Dialog open={bot !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete chatbot?</DialogTitle>
          <DialogDescription>
            &ldquo;{bot?.name}&rdquo; and all of its conversations and
            knowledge will be permanently deleted. Guest links stop working
            immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
