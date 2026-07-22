---
description: Answering "what do we have / what do we know about X" — SOPs, policies, procedures, docs, forms, past tasks, meeting history, guest feedback, anything the property might already know. Load BEFORE answering any knowledge, listing, or history question.
---

# Knowledge lookup procedure

You are answering a question about what this property knows or has. Follow
this ladder — do not improvise the order, and do not stop at the first
empty source.

## 1. Pick the surfaces that could hold the answer

- **Authored knowledge** (SOPs, policies, runbooks, notes, plans):
  `list_documents` (enumeration) and `search_documents` (content match —
  covers extracted text of attached PDFs too).
- **Institutional memory** (past incidents, fixes, suppliers, guest
  history, decisions — plus a `documents/` mirror of the docs):
  `brain_search`, then `brain_get` on promising slugs; `brain_list` with a
  prefix for enumeration; `brain_think` only for hard synthesis questions.
- **Live records**: `search_tasks` (all statuses, incl. done),
  `list_meetings` (past + future), `list_bookings`, `list_forms` +
  `get_form_response_summaries`, `guest_conversation_insights`,
  `search_chat_messages`, `get_org_chart`.
- **Management surfaces** (only if the requester is an owner/manager — the
  tool refuses otherwise; relay the refusal politely):
  `get_insight_brief`, `get_weekly_report`, `list_handovers`.

## 2. Query in the right order

1. Cheap keyword first: `search_documents` / `brain_search` /
   `search_tasks` with the user's own words, then one retry with an
   obvious synonym ("SOP" ↔ "standard operating procedure").
2. Enumeration questions ("what X do we have", "list our…") use LISTING
   tools — `list_documents` (title filter), `brain_list` (prefix) — not
   just keyword search.
3. Chunks are not pages: after a `brain_search` hit, `brain_get` the slug
   before quoting details.
4. `brain_think` is the expensive last resort for judgment questions
   spanning many pages — never for simple lookups.

## 3. Compose the answer

- Say which surfaces you checked when coverage differs: "Documents has 5
  SOPs; the brain has no incident history on this."
- Cite: documents by title (with their app link from the tool result),
  brain findings as [brain: <source>/<slug>].
- A record-set answer (lists of docs/tasks/meetings) goes through
  `render_ui` with real link refs — keep the text to a one-line lead-in.
- **Absence protocol**: an empty result speaks only for the source that
  returned it. Only after EVERY relevant surface above returned empty may
  you say the property has none — and name what you checked. If a surface
  you'd need isn't available to you, say you can't see it.
- End partial answers with an explicit gap note ("I couldn't check X").
