"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Bot,
  Copy,
  Ellipsis,
  ExternalLink,
  MessagesSquare,
  PenLine,
  Plus,
  Trash2,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";
import { AutomationsButton } from "@/components/workflows/automations-button";
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
import { parseChatbotConfig, type ChatbotTemplate } from "@/lib/chatbots/schema";
import { NewChatbotDialog } from "./new-chatbot-dialog";
import { deleteChatbot } from "./actions";
import { PageHeader } from "@/components/shell/page-header";

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

/** gr8r `.badge` with its dot: Live green · Paused amber · Draft gray. */
export function ChatbotStatusBadge({
  status,
}: {
  status: ChatbotListItem["status"];
}) {
  const [tone, label] =
    status === "published"
      ? ["green", "Live"]
      : status === "paused"
        ? ["amber", "Paused"]
        : ["gray", "Draft"];
  return (
    <span className={`badge ${tone}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

const VIEWS = [
  { id: "all", label: "All" },
  { id: "published", label: "Live" },
  { id: "drafts", label: "Drafts" },
] as const;

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

  const live = chatbots.filter((b) => b.status === "published").length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Chatbots" icon={<Bot />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="page wide">
          <div className="ph">
            <div>
              <h1>Chatbots</h1>
              <p>
                {chatbots.length > 0
                  ? `${chatbots.length} ${chatbots.length === 1 ? "chatbot" : "chatbots"} · ${live} live`
                  : "Agentic chatbots for your guests — front desk, room service, restaurant orders."}
              </p>
            </div>
            <div className="acts">
              <AutomationsButton propertyId={propertyId} feature="chatbots" variant="outline" />
              <Link href={`${base}/conversations`} className="btn btn-secondary">
                <Gi icon={MessagesSquare} size={14} />
                Conversations
              </Link>
              <button type="button" className="btn btn-primary" onClick={() => setNewOpen(true)}>
                <Gi icon={Plus} size={14} />
                New chatbot
              </button>
            </div>
          </div>

          {chatbots.length > 0 ? (
            <div className="seg" role="group" aria-label="Filter chatbots" style={{ marginBottom: 14 }}>
              {VIEWS.map((v) => (
                <Link
                  key={v.id}
                  href={v.id === "all" ? base : `${base}?view=${v.id}`}
                  className={view === v.id ? "on" : ""}
                  aria-current={view === v.id ? "page" : undefined}
                >
                  {v.label}
                </Link>
              ))}
            </div>
          ) : null}

          {visible.length === 0 ? (
            <ChatbotsEmpty onCreate={() => setNewOpen(true)} filtered={view !== "all"} />
          ) : (
            <div className="pgrid">
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
        </div>
      </div>
    </div>
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

  const meterTone =
    usagePct >= 100 ? "var(--g8-red)" : usagePct >= 80 ? "var(--g8-amber)" : "var(--g8-green)";

  return (
    <div className="pcard">
      <Link href={href} className="absolute inset-0" aria-label={bot.name} />
      <div className="row" style={{ gap: 10 }}>
        <span className="picon lg" style={{ "--g8-c": "var(--g8-violet)" } as React.CSSProperties}>
          {config.appearance.avatarEmoji ? (
            <span style={{ fontSize: 17, lineHeight: 1 }}>{config.appearance.avatarEmoji}</span>
          ) : (
            <Gi icon={Bot} size={17} />
          )}
        </span>
        <div className="col grow" style={{ gap: 1 }}>
          <span className="trunc" style={{ fontWeight: 600 }}>
            {bot.name}
          </span>
          <span className="trunc muted" style={{ fontSize: 12 }}>
            {TEMPLATE_LABELS[bot.template]}
          </span>
        </div>
      </div>
      <div className="more" style={{ zIndex: 1 }}>
        <DropdownMenu>
          <DropdownMenuTrigger className="ibtn ibtn-sm" aria-label="Chatbot actions">
            <Gi icon={Ellipsis} size={15} />
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
      <div className="foot">
        <ChatbotStatusBadge status={bot.status} />
        <span className="num">
          {messagesToday}/{bot.daily_message_cap} today
        </span>
        {/* Tiny cap meter — fills as today's replies approach the budget. */}
        <span className="meter" style={{ width: 64, marginLeft: "auto" }}>
          <i style={{ width: `${usagePct}%`, background: meterTone }} />
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
    <div className="panel">
      <div className="empty-state">
        <div className="glyph">
          <Gi icon={Bot} />
        </div>
        <p className="es-h">{filtered ? "Nothing here" : "No chatbots yet"}</p>
        <p>
          {filtered
            ? "No chatbots match this view."
            : "Start from a template — front desk, room service, restaurant — or describe your own and let AI draft it."}
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={onCreate}>
          <Gi icon={Plus} size={14} />
          New chatbot
        </button>
      </div>
    </div>
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
      {/* Portaled out of the shell — `g8 g8-port` for gr8r's .btn classes. */}
      <DialogContent className="g8 g8-port">
        <DialogHeader>
          <DialogTitle>Delete chatbot?</DialogTitle>
          <DialogDescription>
            &ldquo;{bot?.name}&rdquo; and all of its conversations and
            knowledge will be permanently deleted. Guest links stop working
            immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={confirm}
            disabled={pending}
          >
            {pending ? "Deleting…" : "Delete"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
