import "server-only";
/**
 * `render_ui` — lets a chat-surface bot attach rich UI (tables, cards,
 * stats) to its reply instead of emitting markdown tables that Stream
 * can't render.
 *
 * The tool doesn't post anything itself: it validates the spec against
 * the chat-UI catalog and hands it to the caller through `sink`. The
 * caller (channel bot's `generateAndPostReply`) attaches the collected
 * spec to the final Stream message as `{ type: "ai_ui", spec }`, which
 * `SlackAttachment` renders client-side.
 *
 * Deep links: the model supplies entity refs (`Card.props.link`,
 * `DataTable.props.rowLinks` — `{kind, id}` copied from tool results),
 * NEVER hrefs. Each ref is validated against this property's rows
 * (batched per kind, service client) and rewritten into a real
 * `/p/<propertyId>/<section>/<id>` path; unknown or cross-tenant ids
 * are silently dropped — the insights-brief deep-link pattern.
 *
 * Invalid specs return `{ ok: false, error }` so the model can repair
 * and retry within its tool-step budget.
 */
import { tool } from "ai";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import {
  CHAT_UI_TOOL_DESCRIPTION,
  ChatUiLinkRef,
  chatUiPathFor,
  validateChatUiSpec,
  type ChatUiLinkKind,
  type ChatUiLinkRefType,
  type ChatUiSpec,
} from "@/lib/ai/chat-ui/catalog";

export type RenderUiSink = { spec: ChatUiSpec | null };

const LINK_TABLES: Record<ChatUiLinkKind, string> = {
  task: "tasks",
  project: "projects",
  document: "documents",
  meeting: "meetings",
  form: "forms",
  space: "spaces",
};

type RawElement = {
  type?: unknown;
  props?: Record<string, unknown>;
  children?: unknown;
};

/**
 * Collect every link ref in the raw spec, verify each id belongs to this
 * property (one query per kind), and rewrite props in place: `link` →
 * `href`, `rowLinks` → `rowHrefs`. Refs that don't parse or don't
 * resolve become null/omitted — never an error, so one bad id can't
 * sink an otherwise-good spec.
 */
async function resolveLinkRefs(
  elements: Record<string, RawElement>,
  propertyId: string,
): Promise<void> {
  const refs: ChatUiLinkRefType[] = [];
  const collect = (value: unknown): ChatUiLinkRefType | null => {
    const parsed = ChatUiLinkRef.safeParse(value);
    if (!parsed.success) return null;
    refs.push(parsed.data);
    return parsed.data;
  };

  // First pass: parse refs out of props (keeping positions).
  const cardRefs = new Map<string, ChatUiLinkRefType | null>();
  const rowRefs = new Map<string, (ChatUiLinkRefType | null)[]>();
  for (const [key, el] of Object.entries(elements)) {
    const props = el.props;
    if (!props) continue;
    if (el.type === "Card" && "link" in props) {
      cardRefs.set(key, collect(props.link));
      delete props.link;
    }
    if (el.type === "DataTable" && "rowLinks" in props) {
      const list = Array.isArray(props.rowLinks) ? props.rowLinks : [];
      rowRefs.set(key, list.map((r) => (r === null ? null : collect(r))));
      delete props.rowLinks;
    }
  }
  if (refs.length === 0) return;

  // Second pass: batched existence check per kind, scoped to the property.
  const supabase = createServiceClient();
  const byKind = new Map<ChatUiLinkKind, Set<string>>();
  for (const r of refs) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, new Set());
    byKind.get(r.kind)!.add(r.id);
  }
  const validIds = new Set<string>();
  await Promise.all(
    [...byKind.entries()].map(async ([kind, ids]) => {
      const { data, error } = await supabase
        .from(LINK_TABLES[kind])
        .select("id")
        .eq("property_id", propertyId)
        .in("id", [...ids]);
      if (error) {
        console.error("[render-ui] link validation query failed", {
          kind,
          error: error.message,
        });
        return; // fail-soft: links for this kind drop, spec still renders
      }
      // Dynamic table name defeats supabase's generated row types.
      for (const row of (data ?? []) as { id: string }[]) {
        validIds.add(`${kind}:${row.id}`);
      }
    }),
  );
  const hrefFor = (ref: ChatUiLinkRefType | null): string | null =>
    ref && validIds.has(`${ref.kind}:${ref.id}`)
      ? chatUiPathFor(propertyId, ref)
      : null;

  // Third pass: write resolved hrefs back into props.
  for (const [key, ref] of cardRefs) {
    const href = hrefFor(ref);
    if (href) elements[key].props!.href = href;
  }
  for (const [key, list] of rowRefs) {
    const hrefs = list.map(hrefFor);
    if (hrefs.some((h) => h !== null)) {
      elements[key].props!.rowHrefs = hrefs;
    }
  }
}

export function buildRenderUiTool(propertyId: string, sink: RenderUiSink) {
  return {
    render_ui: tool({
      description: CHAT_UI_TOOL_DESCRIPTION,
      inputSchema: z.object({
        spec: z.object({
          root: z.string().describe("Key of the root element."),
          elements: z.record(
            z.string(),
            z.object({
              type: z.string(),
              props: z.record(z.string(), z.unknown()).optional(),
              children: z.array(z.string()).optional(),
            }),
          ),
        }),
      }),
      execute: async ({ spec }) => {
        try {
          await resolveLinkRefs(
            spec.elements as Record<string, RawElement>,
            propertyId,
          );
        } catch (err) {
          console.error("[render-ui] link resolution failed", err);
        }
        const result = validateChatUiSpec(spec);
        if (!result.ok) return { ok: false, error: result.error };
        sink.spec = result.spec;
        return {
          ok: true,
          note: "UI attached — it renders beneath your reply. Keep your text to a one-line lead-in and do not repeat the data.",
        };
      },
    }),
  };
}
