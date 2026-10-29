import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Guest-role drift guard (ClickUp parity, migration 0118).
 *
 * A guest holds a real membership row, so RLS lets them INTO the property —
 * but a route that reaches for the service client bypasses RLS entirely and
 * would act on the whole property on a guest's behalf. Every such route
 * under `/api/properties/[propertyId]/**` must therefore pass an explicit
 * role gate (`requireFullMember` / `requireManagement` from lib/auth/session)
 * or carry a `// guest-safe:` comment explaining why not.
 *
 * `BASELINE` lists the routes that predate the rule. It only ever shrinks:
 * removing a route from it once gated is the whole audit (Phase 5b of the
 * plan); adding a NEW ungated service-client route fails this test.
 */

const webRoot = join(__dirname, "..", "..", "..");
const apiRoot = join(webRoot, "app", "api", "properties", "[propertyId]");

// Emptied by the 0118 audit (2026-10-29): every service-client property
// route is now gated or carries a guest-safe note. Keep it empty.
const BASELINE = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

const GATE_RX = /\b(requireFullMember|requireManagement)\(/;
const MARKER_RX = /\/\/\s*guest-safe:/;

describe("service-client property routes are role-gated", () => {
  const routes = walk(apiRoot)
    .filter((f) => readFileSync(f, "utf8").includes("createServiceClient"))
    .map((f) => ({ rel: relative(apiRoot, f), src: readFileSync(f, "utf8") }));

  it("found the routes it is guarding", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  for (const { rel, src } of routes) {
    it(`${rel} is gated, marked guest-safe, or in the baseline`, () => {
      const gated = GATE_RX.test(src) || MARKER_RX.test(src);
      expect(
        gated || BASELINE.has(rel),
        `${rel} uses the service client without requireFullMember/requireManagement or a "// guest-safe:" marker`,
      ).toBe(true);
    });
  }

  it("the baseline only shrinks", () => {
    const present = new Set(routes.map((r) => r.rel));
    for (const rel of BASELINE) {
      const src = routes.find((r) => r.rel === rel)?.src;
      const stillUngated = src ? !(GATE_RX.test(src) || MARKER_RX.test(src)) : false;
      expect(
        present.has(rel) && stillUngated,
        `${rel} is gated (or gone) — remove it from BASELINE so the list keeps shrinking`,
      ).toBe(true);
    }
  });
});
