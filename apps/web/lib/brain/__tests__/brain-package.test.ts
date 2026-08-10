import { describe, it, expect, vi, afterEach } from "vitest";
import {
  BRAIN_CITATION_FORMAT,
  KNOWLEDGE_DISCIPLINE,
  DOC_BRAIN_PREFIX,
  DOC_SYNC_INGESTED_VIA,
  STREAM_CHUNK_LIMIT,
  STREAM_MAX_CHUNKS,
  brainToolDescriptions,
  brainToolSchemas,
  chunkStreamText,
  decryptBrainSecretWith,
  documentBrainSlug,
  encryptBrainSecretWith,
  captureEvidence,
  getBrainPageMarkdown,
  matchRelatedEntities,
  BRAIN_ENTITY_PREFIXES,
  normalizeListPages,
  operatorReviewPage,
  renderDocumentBrainPage,
} from "@hotelclaw/brain";

describe("brain secret crypto (AES-256-GCM, shared derivation)", () => {
  const material = "test-secret-material";

  it("roundtrips a secret", () => {
    const ciphertext = encryptBrainSecretWith(material, "gbrain_cl_abc:supersecret");
    expect(ciphertext.startsWith("v1.")).toBe(true);
    expect(decryptBrainSecretWith(material, ciphertext)).toBe(
      "gbrain_cl_abc:supersecret",
    );
  });

  it("returns null (never throws) on tampering", () => {
    const ciphertext = encryptBrainSecretWith(material, "payload");
    const parts = ciphertext.split(".");
    // Flip a character in the auth tag.
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith("A") ? "BB" : "AA");
    expect(decryptBrainSecretWith(material, parts.join("."))).toBeNull();
  });

  it("returns null on wrong key material", () => {
    const ciphertext = encryptBrainSecretWith(material, "payload");
    expect(decryptBrainSecretWith("different-material", ciphertext)).toBeNull();
  });

  it("returns null on malformed input", () => {
    expect(decryptBrainSecretWith(material, "not-a-ciphertext")).toBeNull();
    expect(decryptBrainSecretWith(material, "v2.a.b.c")).toBeNull();
    expect(decryptBrainSecretWith(material, "")).toBeNull();
  });
});

describe("document → brain mirror helpers", () => {
  it("slugs documents under the documents/ prefix", () => {
    expect(documentBrainSlug("abc-123")).toBe(`${DOC_BRAIN_PREFIX}abc-123`);
  });

  it("renders the mirror page with title, canonical link, and body", () => {
    const page = renderDocumentBrainPage({
      title: "SOP: Walk-in freezer",
      href: "/p/pid/documents/did",
      bodyText: "Keep below -18C.",
      updatedAt: "2026-07-22T10:00:00Z",
    });
    expect(page).toContain("# SOP: Walk-in freezer");
    expect(page).toContain("/p/pid/documents/did");
    expect(page).toContain("Keep below -18C.");
    expect(page).toContain("2026-07-22T10:00:00Z");
    expect(page).toContain("mirrored automatically");
  });

  it("marks empty bodies instead of rendering nothing", () => {
    const page = renderDocumentBrainPage({
      title: "Stub",
      href: "/p/p/documents/d",
      bodyText: "   ",
      updatedAt: null,
    });
    expect(page).toContain("no body text yet");
  });

  it("truncates giant bodies with an explicit marker", () => {
    const page = renderDocumentBrainPage({
      title: "Big",
      href: "/p/p/documents/d",
      bodyText: "x".repeat(100_000),
      updatedAt: null,
    });
    expect(page.length).toBeLessThan(70_000);
    expect(page).toContain("[truncated — full text in the app]");
  });

  it("keeps the sync provenance label stable (stored in brain pages)", () => {
    expect(DOC_SYNC_INGESTED_VIA).toBe("hotelclaw-doc-sync");
  });
});

describe("chunkStreamText (Stream silently discards >5KB messages)", () => {
  it("passes short text through as one chunk", () => {
    expect(chunkStreamText("hello")).toEqual(["hello"]);
  });

  it("keeps every chunk within the limit", () => {
    const text = Array.from({ length: 600 }, (_, i) => `line ${i} of the report`).join("\n");
    const chunks = chunkStreamText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      // The truncation marker may push the final chunk slightly past.
      expect(c.length).toBeLessThanOrEqual(STREAM_CHUNK_LIMIT + 50);
    }
  });

  it("prefers newline boundaries", () => {
    const text = Array.from({ length: 600 }, (_, i) => `line ${i} of the report`).join("\n");
    const chunks = chunkStreamText(text);
    for (const c of chunks.slice(0, -1)) {
      expect(c.endsWith("report")).toBe(true);
    }
  });

  it("preserves all content when under the chunk cap", () => {
    const text = Array.from({ length: 600 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkStreamText(text);
    const rejoined = chunks.join("\n");
    expect(rejoined.replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("hard-splits pathological no-newline text instead of looping", () => {
    const chunks = chunkStreamText("x".repeat(20_000));
    expect(chunks.length).toBe(5);
    expect(chunks[0].length).toBe(STREAM_CHUNK_LIMIT);
  });

  it("truncates past the chunk cap with an explicit marker", () => {
    const text = "y".repeat(STREAM_CHUNK_LIMIT * (STREAM_MAX_CHUNKS + 3));
    const chunks = chunkStreamText(text);
    expect(chunks.length).toBe(STREAM_MAX_CHUNKS);
    expect(chunks[chunks.length - 1]).toContain("truncated");
  });
});

describe("curated tool surface", () => {
  it("covers the full read ladder + one write", () => {
    expect(Object.keys(brainToolDescriptions).sort()).toEqual(
      ["brain_capture", "brain_get", "brain_list", "brain_search", "brain_think"].sort(),
    );
    expect(Object.keys(brainToolSchemas).sort()).toEqual(
      Object.keys(brainToolDescriptions).sort(),
    );
  });

  it("capture slug schema rejects traversal/uppercase/junk", () => {
    const slug = (s: string) =>
      brainToolSchemas.brain_capture.safeParse({
        slug: s,
        page_title: "Title",
        observation: "An observation that is long enough.",
        source: "test",
      }).success;
    expect(slug("systems/pool")).toBe(true);
    expect(slug("suppliers/acme-pool-services")).toBe(true);
    expect(slug("Systems/Pool")).toBe(false);
    expect(slug("../etc/passwd")).toBe(false);
    expect(slug("a")).toBe(false);
  });

  it("normalizeListPages handles both array and {pages} shapes", () => {
    expect(normalizeListPages([{ slug: "a", title: "A", updated_at: "t" }])).toEqual({
      count: 1,
      pages: [{ slug: "a", title: "A", updated: "t" }],
    });
    expect(
      normalizeListPages({ pages: [{ path: "b", updated: "u" }] }).pages[0],
    ).toEqual({ slug: "b", title: null, updated: "u" });
    expect(normalizeListPages("garbage")).toEqual({ count: 0, pages: [] });
    expect(normalizeListPages(null)).toEqual({ count: 0, pages: [] });
  });

  it("operator-review pages carry the review marker", () => {
    expect(operatorReviewPage("Pool pump")).toContain("OPERATOR REVIEW");
    expect(operatorReviewPage("Pool pump")).toContain("# Pool pump");
  });
});

describe("KNOWLEDGE_DISCIPLINE standing rules (every bot tier injects this)", () => {
  it("states the three-source boundary", () => {
    expect(KNOWLEDGE_DISCIPLINE).toContain("Documents");
    expect(KNOWLEDGE_DISCIPLINE).toContain("knowledge brain");
    expect(KNOWLEDGE_DISCIPLINE).toContain("live app data");
  });

  it("states the absence protocol", () => {
    expect(KNOWLEDGE_DISCIPLINE).toContain(
      "NEVER state that something doesn't exist",
    );
    expect(KNOWLEDGE_DISCIPLINE).toContain("empty result speaks ONLY for the source");
  });

  it("mandates the citation format", () => {
    expect(KNOWLEDGE_DISCIPLINE).toContain(BRAIN_CITATION_FORMAT);
  });

  it("routes enumeration questions to listing tools", () => {
    expect(KNOWLEDGE_DISCIPLINE).toContain("list_documents");
    expect(KNOWLEDGE_DISCIPLINE).toContain("brain_list");
  });
});

describe("get_page body extraction (the field gbrain actually returns)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub the serve: token exchange, then one tools/call reply. */
  function stubServe(getPageResult: unknown, onCall?: (tool: string) => void) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (String(url).endsWith("/token")) {
          return new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        const tool = JSON.parse(init?.body ?? "{}").params?.name ?? "";
        calls.push(tool);
        onCall?.(tool);
        const payload =
          tool === "get_page"
            ? getPageResult
            : { ok: true };
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { content: [{ type: "text", text: JSON.stringify(payload) }] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    return calls;
  }

  const cred = { clientId: "gbrain_cl_x", clientSecret: "gbrain_cs_y" };
  // The real shape, verified against the live serve 2026-08-10. There is NO
  // `content` or `markdown` key — the body is `compiled_truth`.
  const REAL_PAGE = {
    id: 280,
    slug: "systems/pool",
    type: "concept",
    title: "Pool",
    compiled_truth: "# Pool\n\nGoes green after heavy rain.",
    timeline: [],
    frontmatter: {},
  };

  it("reads the body out of compiled_truth", async () => {
    stubServe(REAL_PAGE);
    const md = await getBrainPageMarkdown("https://brain.test/mcp", cred, "systems/pool");
    expect(md).toContain("Goes green after heavy rain");
  });

  it("does NOT treat an existing page as missing — captureEvidence must not re-stub it", async () => {
    // The 2026-08-10 bug: getBrainPageMarkdown looked for content/markdown,
    // got null for every real page, so captureEvidence concluded "missing"
    // and put_page'd the OPERATOR REVIEW stub over the compiled truth on
    // EVERY capture. The guard is that put_page is never called for a page
    // that already exists.
    const calls = stubServe(REAL_PAGE);
    await captureEvidence("https://brain.test/mcp", cred, {
      slug: "systems/pool",
      pageTitle: "Pool",
      summary: "chlorine feeder replaced",
      source: "test",
    });
    expect(calls).not.toContain("put_page");
    expect(calls).toContain("add_timeline_entry");
  });

  it("still creates the page when it genuinely does not exist", async () => {
    const calls = stubServe({ error: "page_not_found" });
    await captureEvidence("https://brain.test/mcp", cred, {
      slug: "systems/new-thing",
      pageTitle: "New Thing",
      summary: "first observation",
      source: "test",
    });
    expect(calls).toContain("put_page");
    expect(calls).toContain("add_timeline_entry");
  });
});

describe("doc mirror entity cross-linking (the knowledge-graph feed)", () => {
  const candidates = [
    { slug: "companies/acme-pool-services", title: "Acme Pool Services" },
    { slug: "people/isabel-cruz", title: "Isabel Cruz" },
    { slug: "concepts/walk-in-freezer", title: "Walk-in Freezer" },
    // NOT graph-visible dirs — must never be linked even when mentioned.
    { slug: "systems/pool", title: "Pool System" },
    { slug: "operations/outlets", title: "Outlets" },
    // Too-short title: word-boundary false positives.
    { slug: "concepts/ac", title: "AC" },
  ];

  it("links entities whose title appears word-bounded in the text", () => {
    const hits = matchRelatedEntities(
      "Call Acme Pool Services when the walk-in freezer trips. Isabel Cruz owns the checklist.",
      candidates,
    );
    expect(hits.map((h) => h.slug).sort()).toEqual([
      "companies/acme-pool-services",
      "concepts/walk-in-freezer",
      "people/isabel-cruz",
    ]);
  });

  it("requires word boundaries — substrings do not match", () => {
    expect(
      matchRelatedEntities("The Isabelline finish on the walls…", [
        { slug: "people/isabel", title: "Isabel" },
      ]),
    ).toEqual([]);
  });

  it("never links pages outside the graph-visible prefixes", () => {
    const hits = matchRelatedEntities("Pool System and Outlets are both mentioned.", candidates);
    expect(hits).toEqual([]);
  });

  it("renders the Related section as [Title](slug) markdown links", () => {
    const page = renderDocumentBrainPage({
      title: "Vendor List",
      href: "/p/x/documents/y",
      bodyText: "Approved: Acme Pool Services.",
      updatedAt: null,
      related: [{ slug: "companies/acme-pool-services", title: "Acme Pool Services" }],
    });
    expect(page).toContain("## Related");
    expect(page).toContain("- [Acme Pool Services](companies/acme-pool-services)");
  });

  it("omits the section entirely with no related entities (pre-linking mirrors unchanged)", () => {
    const page = renderDocumentBrainPage({
      title: "T",
      href: "/h",
      bodyText: "body",
      updatedAt: null,
    });
    expect(page).not.toContain("## Related");
  });

  it("prefix list stays graph-visible only", () => {
    expect([...BRAIN_ENTITY_PREFIXES]).toEqual([
      "companies/",
      "people/",
      "concepts/",
      "meetings/",
      "projects/",
    ]);
  });
});
