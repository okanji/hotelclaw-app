import type { Database } from "@/lib/db/types";

/**
 * Single source of truth for Fleet status treatments. Every fleet surface
 * (bot cards, session rows, approvals, brain card, sidebar badges) derives
 * its StatusBadge tone + label from these maps — never re-pick colors
 * inline (house rule, see lib/bookings/status-colors.ts).
 *
 * Conventions: lavender is the AI-family accent (TintIcon), violet =
 * actively running, amber/warning = awaiting a human, danger = broken.
 */

type ClientStatus = Database["public"]["Tables"]["clients"]["Row"]["status"];
type SessionStatus = Database["public"]["Tables"]["bot_chat_sessions"]["Row"]["status"];

export type FleetTone =
  | "neutral"
  | "success"
  | "warning"
  | "info"
  | "danger"
  | "violet";

export const CLIENT_STATUS_UI: Record<
  ClientStatus,
  { tone: FleetTone; label: string }
> = {
  active: { tone: "success", label: "Active" },
  paused: { tone: "warning", label: "Paused" },
  offboarded: { tone: "neutral", label: "Offboarded" },
};

export const SESSION_STATUS_UI: Record<
  SessionStatus,
  { tone: FleetTone; label: string }
> = {
  idle: { tone: "neutral", label: "Idle" },
  awaiting_approval: { tone: "warning", label: "Awaiting approval" },
};

export const MODEL_TIER_UI: Record<
  "standard" | "advanced",
  { tone: FleetTone; label: string }
> = {
  standard: { tone: "neutral", label: "Standard (Haiku)" },
  advanced: { tone: "violet", label: "Advanced (Sonnet)" },
};

export const BRAIN_HEALTH_UI = {
  ok: { tone: "success" as FleetTone, label: "Healthy" },
  unreachable: { tone: "danger" as FleetTone, label: "Unreachable" },
  unconfigured: { tone: "neutral" as FleetTone, label: "Not configured" },
};
