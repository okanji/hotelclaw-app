/**
 * Human-readable citations for brain results.
 *
 * Every active document is mirrored into the brain as page `documents/<id>`
 * (lib/brain/doc-sync.ts), so brain hits on app documents come back with a
 * slug like `documents/5cc6e91f-8975-4aa8-ba33-e75a72783870`. Cited verbatim
 * that reads as `[brain: documents/5cc6e91f-…]` — a correct machine trace and
 * a meaningless one for a human, which is exactly what evaluation caught.
 *
 * This resolves those slugs to the document's real title and app link so the
 * model can cite "the Walk-in Freezer SOP" and deep-link it. Lives in lib/ (a
 * plain module import) rather than inside the dynamic-tool module, because
 * eve's build transform cannot serialize a helper closed over by an executor —
 * imported functions are fine, resolver-scope ones are not.
 */
import { serviceClient } from "./supabase";

/** Brain slug for a mirrored app document. Kept in sync with
 *  `documentBrainSlug` in @hotelclaw/brain. */
const DOC_SLUG_RX = /documents\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export type BrainSource = {
  slug: string;
  title: string;
  link: string;
};

/**
 * Scan a brain tool result for mirrored-document slugs and resolve each to
 * {title, link}. Tenant-scoped: a slug whose document doesn't belong to this
 * property is dropped rather than resolved, so a citation can never leak a
 * title across properties.
 *
 * Fail-soft by design — on any error the caller still gets its content, just
 * without the friendly source list.
 */
export async function resolveBrainSources(
  propertyId: string,
  content: unknown,
): Promise<BrainSource[]> {
  try {
    const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
    if (!text) return [];
    const ids = [...new Set([...text.matchAll(DOC_SLUG_RX)].map((m) => m[1].toLowerCase()))];
    if (ids.length === 0) return [];

    const { data } = await serviceClient()
      .from("documents")
      .select("id, title")
      .eq("property_id", propertyId)
      .in("id", ids.slice(0, 25));

    return (data ?? []).map((doc) => ({
      slug: `documents/${doc.id}`,
      title: doc.title || "Untitled document",
      link: `/p/${propertyId}/documents/${doc.id}`,
    }));
  } catch {
    return [];
  }
}
