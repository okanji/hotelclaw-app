"use client";

import type React from "react";
import {
  Ban,
  CircleCheck,
  Circle,
  CircleSlash,
  Clock,
  LoaderCircle,
  CircleX,
  type LucideIcon,
} from "lucide-react";
import { Gi } from "@/components/gr8r/icon";

/**
 * gr8r atoms shared by the Workflows surface (list, runs, inspector,
 * automations dialog): one run-status vocabulary drawn as gr8r's `.badge`
 * tones + a leading glyph tinted with gr8r's status tokens.
 */
export type RunStatusMeta = {
  label: string;
  icon: LucideIcon;
  /** gr8r `.badge` tone class. */
  badge: "green" | "red" | "accent" | "amber" | "gray";
  /** Glyph colour (a gr8r token). */
  color: string;
  spin?: boolean;
};

export const RUN_STATUS_G8: Record<string, RunStatusMeta> = {
  succeeded: { label: "Succeeded", icon: CircleCheck, badge: "green", color: "var(--g8-green)" },
  failed: { label: "Failed", icon: CircleX, badge: "red", color: "var(--g8-red)" },
  running: {
    label: "Running",
    icon: LoaderCircle,
    badge: "accent",
    color: "var(--g8-accent)",
    spin: true,
  },
  waiting: { label: "Waiting", icon: Clock, badge: "amber", color: "var(--g8-amber)" },
  queued: { label: "Queued", icon: Circle, badge: "gray", color: "var(--g8-text-3)" },
  filtered: { label: "Filtered", icon: CircleSlash, badge: "gray", color: "var(--g8-text-3)" },
  cancelled: { label: "Cancelled", icon: Ban, badge: "gray", color: "var(--g8-text-3)" },
};

export function runStatusG8(status: string | null | undefined): RunStatusMeta | null {
  return status ? (RUN_STATUS_G8[status] ?? null) : null;
}

/** `.badge <tone>` with its dot. */
export function RunBadge({ status, label }: { status: string; label?: string }) {
  const meta = runStatusG8(status);
  return (
    <span className={`badge ${meta?.badge ?? "gray"}`}>
      <span className="dot" />
      {label ?? meta?.label ?? status}
    </span>
  );
}

/** The leading status glyph of a run / workflow row. */
export function RunGlyph({
  status,
  muted,
  size = 16,
}: {
  status: string | null | undefined;
  muted?: boolean;
  size?: number;
}) {
  const meta = runStatusG8(status);
  const Icon = meta?.icon ?? Circle;
  return (
    <span
      style={{
        display: "inline-grid",
        placeItems: "center",
        flexShrink: 0,
        color: muted || !meta ? "var(--g8-text-4)" : meta.color,
      }}
    >
      <Gi icon={Icon} size={size} className={meta?.spin && !muted ? "animate-spin" : undefined} />
    </span>
  );
}

export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * The gr8r page body every Workflows view shares: a scroll pane holding
 * `.page` (wide unless `narrow`), its `.ph` header (h1 + lede + `.acts`),
 * then optional route tabs and the view.
 */
export function WfPage({
  title,
  lede,
  acts,
  tabs,
  narrow,
  children,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  acts?: React.ReactNode;
  tabs?: React.ReactNode;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={narrow ? "page" : "page wide"} style={narrow ? { maxWidth: 820 } : undefined}>
        <div className="ph">
          <div style={{ minWidth: 0 }}>
            <h1>{title}</h1>
            {lede ? <p>{lede}</p> : null}
          </div>
          {acts ? <div className="acts">{acts}</div> : null}
        </div>
        {tabs}
        {children}
      </div>
    </div>
  );
}

/** gr8r `.empty-state` inside a `.panel`. */
export function WfEmpty({
  icon,
  title,
  children,
  actions,
}: {
  icon: LucideIcon;
  title?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="empty-state">
        <div className="glyph">
          <Gi icon={icon} />
        </div>
        {title ? <p className="es-h">{title}</p> : null}
        {children ? <p>{children}</p> : null}
        {actions ? <div className="row" style={{ justifyContent: "center" }}>{actions}</div> : null}
      </div>
    </div>
  );
}
