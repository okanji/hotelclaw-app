"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "react-qr-code";
import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Chip } from "@/components/ui/chip";
import {
  regenerateChatbotSlug,
  setChannelDeployments,
  updateChatbot,
} from "./actions";
import type { ChannelOption } from "./chatbot-detail";

/**
 * Deploy panel — the guest link + a printable QR code. The QR is rendered
 * client-side (react-qr-code, SVG) and downloaded by serializing the SVG;
 * an optional room number is encoded as ?room=N so in-room codes identify
 * the guest's location automatically.
 */
export function DeployPanel({
  chatbotId,
  propertyId,
  publicSlug,
  status,
  allowedDomains = [],
  twilioNumber = null,
  channels = [],
  deployedChannelIds = [],
}: {
  chatbotId: string;
  propertyId: string;
  publicSlug: string;
  status: "draft" | "published" | "paused";
  allowedDomains?: string[];
  twilioNumber?: string | null;
  channels?: ChannelOption[];
  deployedChannelIds?: string[];
}) {
  const router = useRouter();
  const [room, setRoom] = useState("");
  const [regenerating, startRegenerate] = useTransition();
  const qrRef = useRef<HTMLDivElement>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const guestUrl = `${origin}/g/${publicSlug}${room.trim() ? `?room=${encodeURIComponent(room.trim())}` : ""}`;

  function copy() {
    void navigator.clipboard
      .writeText(guestUrl)
      .then(() => toast.success("Guest link copied"));
  }

  function downloadQr() {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chatbot-qr${room.trim() ? `-room-${room.trim()}` : ""}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function regenerate() {
    startRegenerate(async () => {
      const result = await regenerateChatbotSlug(chatbotId);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("New link generated — old links and QR codes are dead");
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-border p-4">
      <div>
        <p className="text-sm font-medium">Share with guests</p>
        <p className="text-xs text-muted-foreground">
          {status === "published"
            ? "Print the QR for rooms and tables, or put the link in pre-arrival messages."
            : "The guest page returns 404 until the bot is published."}
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex-1 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Guest link</Label>
            <div className="flex gap-2">
              <Input readOnly value={guestUrl} className="font-mono text-xs" />
              <Button variant="outline" size="icon" aria-label="Copy link" onClick={copy}>
                <Copy className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Open guest page"
                onClick={() => window.open(guestUrl, "_blank")}
              >
                <ExternalLink className="size-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qr-room" className="text-xs">
              Room / table number (optional)
            </Label>
            <Input
              id="qr-room"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="204"
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Encoded in the QR so the bot already knows where the guest is.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={regenerating}
          >
            <RefreshCw data-slot="icon" className={regenerating ? "animate-spin" : undefined} />
            Regenerate link
          </Button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <div ref={qrRef} className="rounded-lg border border-border bg-white p-3">
            <QRCode value={guestUrl} size={132} />
          </div>
          <Button variant="ghost" size="sm" onClick={downloadQr}>
            <Download data-slot="icon" />
            Download SVG
          </Button>
        </div>
      </div>

      <EmbedSection
        chatbotId={chatbotId}
        publicSlug={publicSlug}
        allowedDomains={allowedDomains}
        origin={origin}
      />
      <TwilioSection chatbotId={chatbotId} twilioNumber={twilioNumber} />
      <ChannelDeploySection
        chatbotId={chatbotId}
        propertyId={propertyId}
        channels={channels}
        deployedChannelIds={deployedChannelIds}
      />
    </section>
  );
}

/* --------------------------- Staff channels ------------------------------ */

function ChannelDeploySection({
  chatbotId,
  propertyId,
  channels,
  deployedChannelIds,
}: {
  chatbotId: string;
  propertyId: string;
  channels: ChannelOption[];
  deployedChannelIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(deployedChannelIds),
  );
  const [saving, startSaving] = useTransition();

  const dirty =
    selected.size !== deployedChannelIds.length ||
    deployedChannelIds.some((id) => !selected.has(id));

  function toggle(streamChannelId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(streamChannelId)) next.delete(streamChannelId);
      else next.add(streamChannelId);
      return next;
    });
  }

  function save() {
    startSaving(async () => {
      const result = await setChannelDeployments({
        chatbotId,
        propertyId,
        streamChannelIds: [...selected],
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Channel deployments updated");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div>
        <p className="text-sm font-medium">Deploy into staff channels</p>
        <p className="text-xs text-muted-foreground">
          In these channels the team assistant answers with THIS bot&apos;s
          persona, knowledge base, and API actions (plus the usual workspace
          tools). One bot per channel.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {channels.map((c) => {
          const active = selected.has(c.stream_channel_id);
          return (
            <Chip
              key={c.id}
              size="sm"
              selected={active}
              onClick={() => toggle(c.stream_channel_id)}
            >
              #{c.name}
            </Chip>
          );
        })}
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">No channels yet.</p>
        ) : null}
      </div>
      {dirty ? (
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save channel deployments"}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------ Widget embed ----------------------------- */

function EmbedSection({
  chatbotId,
  publicSlug,
  allowedDomains,
  origin,
}: {
  chatbotId: string;
  publicSlug: string;
  allowedDomains: string[];
  origin: string;
}) {
  const router = useRouter();
  const [domains, setDomains] = useState(allowedDomains.join("\n"));

  const snippet = `<script src="${origin}/chatbot-widget.js" data-chatbot="${publicSlug}" async></script>`;
  const domainList = domains
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);

  function saveDomains() {
    if (domainList.join("\n") === allowedDomains.join("\n")) return;
    void updateChatbot({
      chatbotId,
      patch: { allowed_domains: domainList },
    }).then((result) => {
      if ("error" in result) toast.error(result.error);
      else {
        toast.success("Embed domains updated");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div>
        <p className="text-sm font-medium">Embed on your website</p>
        <p className="text-xs text-muted-foreground">
          A floating chat bubble on your own site. Paste the snippet before
          <code className="mx-1 font-mono">&lt;/body&gt;</code>— it only works
          on the domains you list below.
        </p>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={snippet} className="font-mono text-xs" />
        <Button
          variant="outline"
          size="icon"
          aria-label="Copy embed snippet"
          onClick={() =>
            void navigator.clipboard
              .writeText(snippet)
              .then(() => toast.success("Embed snippet copied"))
          }
        >
          <Copy className="size-4" />
        </Button>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="embed-domains" className="text-xs">
          Allowed website domains (one per line — empty disables embedding)
        </Label>
        <Textarea
          id="embed-domains"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          onBlur={saveDomains}
          rows={2}
          placeholder={"https://yourhotel.com\nhttps://www.yourhotel.com"}
          className="font-mono text-xs"
        />
      </div>
    </div>
  );
}

/* ------------------------------ WhatsApp / SMS --------------------------- */

function TwilioSection({
  chatbotId,
  twilioNumber,
}: {
  chatbotId: string;
  twilioNumber: string | null;
}) {
  const router = useRouter();
  const [number, setNumber] = useState(twilioNumber ?? "");
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  function saveNumber() {
    const next = number.trim() || null;
    if (next === twilioNumber) return;
    void updateChatbot({
      chatbotId,
      patch: { twilio_number: next },
    }).then((result) => {
      if ("error" in result) toast.error(result.error);
      else {
        toast.success(next ? "Number connected" : "Number removed");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 border-t border-border/60 pt-4">
      <div>
        <p className="text-sm font-medium">WhatsApp / SMS (via Twilio)</p>
        <p className="text-xs text-muted-foreground">
          Guests text this bot directly. Enter your Twilio number (E.164, or
          <code className="mx-1 font-mono">whatsapp:+1…</code>for WhatsApp) and
          point its incoming-message webhook at
          <code className="mx-1 font-mono">{origin}/api/guest/channels/twilio</code>.
        </p>
      </div>
      <Input
        value={number}
        onChange={(e) => setNumber(e.target.value)}
        onBlur={saveNumber}
        name="twilioNumber"
        aria-label="Twilio number"
        placeholder="whatsapp:+14155550100"
        className="w-72 font-mono text-xs"
      />
    </div>
  );
}
