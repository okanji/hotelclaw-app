import type { TintTone } from "@/components/ui/tint-card";

/**
 * Row shapes for the Assistant section. Everything here is personal to one
 * user inside one property (migration 0102) — the queries never filter by
 * user themselves; RLS does, so a missed filter fails closed.
 */

export type AssistantChat = {
  id: string;
  title: string;
  project_id: string | null;
  eve_session_id: string | null;
  continuation_token: string | null;
  pinned: boolean;
  /** 'scheduled' rows were produced by an action.assistant.run workflow step —
   *  the UI badges them so a brief that appeared on its own is recognisable as
   *  something you set up, not something you forgot writing. */
  source: "user" | "scheduled";
  workflow_id: string | null;
  last_message_at: string;
  created_at: string;
};

export type AssistantProject = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  memory: string | null;
  emoji: string;
  tint: string;
  pinned: boolean;
  updated_at: string;
  created_at: string;
};

export type AssistantProjectResource = {
  id: string;
  kind: "document" | "text";
  document_id: string | null;
  title: string;
  body: string | null;
  created_at: string;
};

/** Tint keys the project editor offers, in the house cycle order. */
export const PROJECT_TINTS: TintTone[] = [
  "lavender",
  "blue",
  "sage",
  "coral",
  "honey",
];

export function asTint(value: string): TintTone {
  return (PROJECT_TINTS as string[]).includes(value)
    ? (value as TintTone)
    : "lavender";
}

/** Pasted context is capped so one essay can't eat a session's window. */
export const TEXT_RESOURCE_MAX = 20_000;

/**
 * Starter prompts on the empty state. Deliberately spread across the four
 * things this surface can do that a channel reply can't: span the whole
 * workspace, write something long, act, and remember.
 */
export const STARTER_PROMPTS = [
  "What needs my attention today?",
  "Summarise everything that changed in my projects this week",
  "Draft an SOP for guest late checkout and save it as a document",
  "Which of my tasks are likely to slip?",
];
