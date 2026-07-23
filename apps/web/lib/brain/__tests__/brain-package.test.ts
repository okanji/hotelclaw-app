import { describe, it, expect } from "vitest";
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
