import { describe, it, expect, afterAll } from "vitest";

/**
 * Integration test for the AI-write undo safety net (migration 0094):
 * replace-mode writes stash the prior snapshot into document_ai_revisions
 * before overwriting, capped at 10 per document. Runs against the real dev
 * Supabase + Liveblocks; self-skips without env:
 *
 *   node --env-file=.env.local node_modules/.bin/vitest run lib/documents
 */
const hasEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.LIVEBLOCKS_SECRET_KEY;

const PROPERTY = "d58fc73b-9077-404d-9f2b-6eb56902d91a";

describe.skipIf(!hasEnv)("document AI write revisions (0094)", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let sb: any;
  let docId: string;

  it("seeds a scratch doc and performs the first write (no revision yet)", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data: created } = await sb
      .from("documents")
      .insert({
        property_id: PROPERTY,
        title: `revision-test-${crypto.randomUUID().slice(0, 8)}`,
      })
      .select("id")
      .single();
    docId = created.id;

    const { writeDocumentBody } = await import("@/lib/documents/write-body");
    const first = await writeDocumentBody({
      propertyId: PROPERTY,
      documentId: docId,
      html: "<h1>Version one</h1><p>This is the original body content that should be preserved by the revision system when replaced.</p>",
      mode: "replace",
    });
    expect(first.ok).toBe(true);

    // First write replaced an empty/trivial stub — no revision expected.
    const { data: revs } = await sb
      .from("document_ai_revisions")
      .select("id")
      .eq("document_id", docId);
    expect(revs).toHaveLength(0);
  }, 60_000);

  it("replace over real content stashes the prior snapshot", async () => {
    const { writeDocumentBody } = await import("@/lib/documents/write-body");
    const second = await writeDocumentBody({
      propertyId: PROPERTY,
      documentId: docId,
      html: "<h1>Version two</h1><p>Completely different content replacing version one.</p>",
      mode: "replace",
    });
    expect(second.ok).toBe(true);

    const { data: revs } = await sb
      .from("document_ai_revisions")
      .select("body_text, note")
      .eq("document_id", docId);
    expect(revs).toHaveLength(1);
    expect(revs[0].body_text).toContain("Version one");
    expect(revs[0].note).toContain("pre-replace");
  }, 60_000);

  it("append mode never creates revisions", async () => {
    const { writeDocumentBody } = await import("@/lib/documents/write-body");
    const appended = await writeDocumentBody({
      propertyId: PROPERTY,
      documentId: docId,
      html: "<p>An appended paragraph.</p>",
      mode: "append",
    });
    expect(appended.ok).toBe(true);
    const { data: revs } = await sb
      .from("document_ai_revisions")
      .select("id")
      .eq("document_id", docId);
    expect(revs).toHaveLength(1);
  }, 60_000);

  afterAll(async () => {
    if (!sb || !docId) return;
    await sb.from("document_ai_revisions").delete().eq("document_id", docId);
    await sb.from("documents").delete().eq("id", docId);
  });
});
