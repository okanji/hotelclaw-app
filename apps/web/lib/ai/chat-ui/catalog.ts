/**
 * Chat UI catalog — the component vocabulary the channel bot can render
 * inside a Stream message (custom attachment type `"ai_ui"`).
 *
 * Built on @json-render (core + react, pinned — pre-1.0): we use its spec
 * format ({ root, elements } flat map), its structural `validateSpec`, and
 * the client-side `defineRegistry`/`Renderer` machinery, but we OWN the
 * component catalog and validate every element's props with the zod
 * schemas below before a spec is accepted. We deliberately do NOT use
 * `catalog.prompt()` (it's a 14KB JSONL-patch streaming prompt aimed at
 * `useUIStream`) — the bot supplies a complete spec as a tool argument,
 * documented compactly in `CHAT_UI_TOOL_DESCRIPTION`.
 *
 * Display-only by design: no state, no actions, no visibility conditions.
 * Anything interactive (fill a form, confirm a booking) should be a real
 * custom attachment with a real handler, like the `form` attachment.
 *
 * Shared by the server tool (`lib/ai/tools/render-ui.ts`) and the client
 * renderer (`components/chat/ai-ui-attachment.tsx`) — keep it free of
 * "server-only" and React imports.
 */
import { validateSpec, defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/** Element types that take children. Everything else is a leaf. */
const CONTAINER_TYPES = new Set(["Stack", "CardGrid", "StatRow"]);

const Tone = z.enum(["neutral", "success", "warning", "info", "destructive"]);
export type ChatUiTone = z.infer<typeof Tone>;

/**
 * Deep links. The model NEVER writes hrefs — it supplies entity refs
 * (`link` / `rowLinks` in the tool input), and the render_ui tool
 * validates each id against the property and rewrites refs into real
 * `/p/<propertyId>/<section>/<id>` paths before the spec is stored
 * (the insights-brief deep-link pattern). Stored specs therefore only
 * carry `href` strings, which must match this shape — so a hand-crafted
 * attachment can at worst point somewhere else INSIDE the app, never at
 * an external or javascript: URL.
 */
export const INTERNAL_HREF_RX = /^\/p\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[a-z][a-z0-9/?=&-]*$/i;

export const CHAT_UI_LINK_KINDS = [
  "task",
  "project",
  "document",
  "meeting",
  "form",
  "space",
] as const;
export type ChatUiLinkKind = (typeof CHAT_UI_LINK_KINDS)[number];

export const ChatUiLinkRef = z.object({
  kind: z.enum(CHAT_UI_LINK_KINDS),
  id: z.string().uuid(),
});
export type ChatUiLinkRefType = z.infer<typeof ChatUiLinkRef>;

/** Route section per link kind — all detail routes are /p/<pid>/<section>/<id>. */
const LINK_SECTIONS: Record<ChatUiLinkKind, string> = {
  task: "tasks",
  project: "projects",
  document: "documents",
  meeting: "meetings",
  form: "forms",
  space: "spaces",
};

export function chatUiPathFor(
  propertyId: string,
  ref: ChatUiLinkRefType,
): string {
  return `/p/${propertyId}/${LINK_SECTIONS[ref.kind]}/${ref.id}`;
}

const InternalHref = z.string().regex(INTERNAL_HREF_RX);

/**
 * Prop schemas per component. Caps keep specs within Stream's custom-data
 * budget (~5KB/message) and keep the rendered UI scannable in a chat column.
 */
export const CHAT_UI_PROPS = {
  Stack: z.object({}),
  DataTable: z.object({
    title: z.string().max(120).optional(),
    columns: z.array(z.string().max(60)).min(1).max(6),
    rows: z.array(z.array(z.string().max(160))).max(20),
    /** Per-row deep link, aligned with `rows`. Written by the server, never the model. */
    rowHrefs: z.array(InternalHref.nullable()).max(20).optional(),
  }),
  CardGrid: z.object({}),
  Card: z.object({
    title: z.string().max(120),
    subtitle: z.string().max(160).optional(),
    /** Deep link for the whole card. Written by the server, never the model. */
    href: InternalHref.optional(),
    badge: z
      .object({ label: z.string().max(40), tone: Tone.optional() })
      .optional(),
    fields: z
      .array(
        z.object({ label: z.string().max(60), value: z.string().max(160) }),
      )
      .max(8)
      .optional(),
  }),
  StatRow: z.object({}),
  Stat: z.object({
    label: z.string().max(60),
    value: z.string().max(40),
    hint: z.string().max(80).optional(),
  }),
} as const;

export type ChatUiComponentType = keyof typeof CHAT_UI_PROPS;

/**
 * json-render catalog — feeds `defineRegistry` on the client so component
 * implementations stay type-checked against the prop schemas above.
 */
export const chatUiCatalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: CHAT_UI_PROPS.Stack,
      slots: ["default"],
      description: "Vertical container; use as root for multiple blocks.",
    },
    DataTable: {
      props: CHAT_UI_PROPS.DataTable,
      description: "Tabular data with a header row.",
    },
    CardGrid: {
      props: CHAT_UI_PROPS.CardGrid,
      slots: ["default"],
      description: "Responsive grid of Card children.",
    },
    Card: {
      props: CHAT_UI_PROPS.Card,
      description: "A record card: title, optional badge and label/value fields.",
    },
    StatRow: {
      props: CHAT_UI_PROPS.StatRow,
      slots: ["default"],
      description: "Divider-separated strip of Stat children.",
    },
    Stat: {
      props: CHAT_UI_PROPS.Stat,
      description: "One headline metric.",
    },
  },
  actions: {},
});

export type ChatUiElement = {
  type: ChatUiComponentType;
  props: Record<string, unknown>;
  children?: string[];
};

export type ChatUiSpec = {
  root: string;
  elements: Record<string, ChatUiElement>;
};

/** The custom Stream attachment shape carrying a spec. */
export type AiUiAttachmentPayload = {
  type: "ai_ui";
  spec: ChatUiSpec;
};

export function isAiUiAttachment(a: unknown): a is AiUiAttachmentPayload {
  return (
    typeof a === "object" &&
    a !== null &&
    (a as { type?: unknown }).type === "ai_ui" &&
    typeof (a as { spec?: unknown }).spec === "object" &&
    (a as { spec?: unknown }).spec !== null
  );
}

const MAX_ELEMENTS = 40;
const MAX_SPEC_JSON_CHARS = 4000;

export type ChatUiValidation =
  | { ok: true; spec: ChatUiSpec }
  | { ok: false; error: string };

/**
 * Validate + sanitize a model-supplied spec. Returns a rebuilt spec
 * containing only known element types, parsed props (unknown keys
 * stripped), and children references that resolve — or a message the
 * model can act on (it gets one shot at repair within the tool-step
 * budget).
 *
 * The client runs this too before rendering, so a hand-crafted or
 * version-drifted attachment degrades to nothing instead of crashing
 * the message list.
 */
export function validateChatUiSpec(input: unknown): ChatUiValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "spec must be an object with root + elements" };
  }
  const raw = input as { root?: unknown; elements?: unknown };
  if (typeof raw.root !== "string" || typeof raw.elements !== "object" || raw.elements === null) {
    return { ok: false, error: "spec must be { root: string, elements: Record<key, element> }" };
  }

  const structural = validateSpec(raw as Parameters<typeof validateSpec>[0]);
  if (!structural.valid) {
    return {
      ok: false,
      error: structural.issues.map((i) => i.message).join("; "),
    };
  }

  const entries = Object.entries(raw.elements as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: "elements is empty" };
  if (entries.length > MAX_ELEMENTS) {
    return { ok: false, error: `too many elements (max ${MAX_ELEMENTS})` };
  }

  const elements: Record<string, ChatUiElement> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "object" || value === null) {
      return { ok: false, error: `element "${key}" must be an object` };
    }
    const el = value as { type?: unknown; props?: unknown; children?: unknown };
    const type = el.type as ChatUiComponentType;
    if (typeof type !== "string" || !(type in CHAT_UI_PROPS)) {
      return {
        ok: false,
        error: `element "${key}" has unknown type "${String(el.type)}" — allowed: ${Object.keys(CHAT_UI_PROPS).join(", ")}`,
      };
    }
    const parsed = CHAT_UI_PROPS[type].safeParse(el.props ?? {});
    if (parsed.success && type === "DataTable") {
      // rowHrefs aligns with rows by index — trim any excess rather than
      // rejecting a spec over a harmless tail.
      const p = parsed.data as {
        rows: string[][];
        rowHrefs?: (string | null)[];
      };
      if (p.rowHrefs && p.rowHrefs.length > p.rows.length) {
        p.rowHrefs = p.rowHrefs.slice(0, p.rows.length);
      }
    }
    if (!parsed.success) {
      return {
        ok: false,
        error: `element "${key}" (${type}) has invalid props: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      };
    }
    const children = Array.isArray(el.children)
      ? el.children.filter((c): c is string => typeof c === "string")
      : [];
    if (children.length > 0 && !CONTAINER_TYPES.has(type)) {
      return { ok: false, error: `element "${key}" (${type}) cannot have children` };
    }
    for (const c of children) {
      if (!(c in (raw.elements as Record<string, unknown>))) {
        return { ok: false, error: `element "${key}" references missing child "${c}"` };
      }
    }
    elements[key] = {
      type,
      props: parsed.data as Record<string, unknown>,
      ...(children.length > 0 ? { children } : {}),
    };
  }

  if (!(raw.root in elements)) {
    return { ok: false, error: `root "${raw.root}" not found in elements` };
  }

  const spec: ChatUiSpec = { root: raw.root, elements };
  const size = JSON.stringify(spec).length;
  if (size > MAX_SPEC_JSON_CHARS) {
    return {
      ok: false,
      error: `spec too large (${size} chars, max ${MAX_SPEC_JSON_CHARS}) — trim rows or summarize`,
    };
  }
  return { ok: true, spec };
}

/**
 * Compact tool description — the model's entire manual for the spec
 * format. Kept in the shared file next to the schemas it documents.
 */
export const CHAT_UI_TOOL_DESCRIPTION = [
  "Render rich UI beneath your chat reply. USE THIS whenever your answer is structured data — task lists, schedules, workload breakdowns, comparisons, metrics — instead of writing a markdown table (chat CANNOT render markdown tables).",
  'Pass spec = { root: "<key>", elements: { "<key>": { type, props, children? } } }. children is an array of element keys, only valid on container types.',
  "Component types:",
  '- Stack — container; props {}; use as root when combining blocks.',
  '- DataTable — props { title?, columns: string[] (1-6), rows: string[][] (≤20 rows, cells ≤160 chars), rowLinks?: ({kind,id}|null)[] aligned with rows }.',
  '- CardGrid — container for Card children; props {}.',
  '- Card — props { title, subtitle?, link?: {kind,id}, badge?: { label, tone?: "neutral"|"success"|"warning"|"info"|"destructive" }, fields?: [{ label, value }] (≤8) }.',
  '- StatRow — container for Stat children; props {}.',
  '- Stat — props { label, value, hint? } — one headline number.',
  'Deep links: when a row or card corresponds to a record the user can open, ALWAYS attach a link ref { kind: "task"|"project"|"document"|"meeting"|"form"|"space", id: "<uuid>" }. The id MUST be a real id copied from a tool result in this conversation — never invented. Invalid ids are silently dropped; valid ones become clickable rows/cards.',
  "Example: {\"root\":\"t\",\"elements\":{\"t\":{\"type\":\"DataTable\",\"props\":{\"columns\":[\"Task\",\"Status\"],\"rows\":[[\"Fix fridge\",\"In progress\"]],\"rowLinks\":[{\"kind\":\"task\",\"id\":\"<uuid from tool result>\"}]}}}}",
  "Call at most once per reply — a second call replaces the first. After calling, keep your text to a one-line lead-in; never repeat the data in text.",
].join("\n");
