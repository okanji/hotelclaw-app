import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Drift guard: server secrets never reach the browser.
 *
 * Next only inlines `NEXT_PUBLIC_*` into client bundles, so a secret read
 * from a client component doesn't LEAK — it silently reads `undefined`,
 * which is a bug of its own. The ways a secret actually ships to a visitor
 * are: naming it `NEXT_PUBLIC_*`, an `env:` block in next.config, or a
 * server module that reads a secret being imported into a client graph
 * without `server-only` (then a later refactor can pass the value down as a
 * prop with no error). This reads SOURCE TEXT — a cheap tripwire, not a
 * proof. The empirical check is grepping `.next/static` for the values.
 */

const webRoot = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["app", "components", "hooks", "lib"];
const SKIP_DIRS = new Set(["node_modules", "__tests__", ".next"]);

/** Server-only env names, by construction (an unprefixed API key is a
 *  provider secret: Anthropic, OpenAI, Resend, xAI). */
const SECRET_NAME =
  /(SECRET|SERVICE_ROLE|API_KEY|_TOKEN$|_TOKEN_|PASSWORD|ENCRYPTION_KEY|CLIENT_SECRET)/;
/** Words that must never appear in a NEXT_PUBLIC_ name. `API_KEY` is allowed
 *  there on purpose: Stream's public API key is an app id, not a credential
 *  (the secret is STREAM_API_SECRET), and Supabase's browser key says
 *  PUBLISHABLE in its name. */
const NEVER_PUBLIC = /(SECRET|SERVICE_ROLE|TOKEN|PASSWORD|ENCRYPTION_KEY|PRIVATE)/;
/** Non-secret, non-public names a client file may legitimately read. */
const CLIENT_SAFE = new Set(["NODE_ENV"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(join(webRoot, d))).map((full) => ({
  path: relative(webRoot, full),
  src: readFileSync(full, "utf8"),
}));

const envReads = (src: string) =>
  [...src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);

const isClientModule = (src: string) => /^\s*["']use client["']/m.test(src);

describe("secret env boundary", () => {
  it("client components read only NEXT_PUBLIC_* env", () => {
    const offenders = files
      .filter((f) => isClientModule(f.src))
      .flatMap((f) =>
        envReads(f.src)
          .filter((n) => !n.startsWith("NEXT_PUBLIC_") && !CLIENT_SAFE.has(n))
          .map((n) => `${f.path} reads ${n}`),
      );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no NEXT_PUBLIC_* name is a secret", () => {
    const publicNames = new Set(
      files.flatMap((f) => envReads(f.src)).filter((n) => n.startsWith("NEXT_PUBLIC_")),
    );
    const offenders = [...publicNames].filter((n) => NEVER_PUBLIC.test(n));
    expect(offenders, `inlined into the browser bundle: ${offenders.join(", ")}`).toEqual([]);
  });

  it("every lib/ or components/ module that reads a secret imports server-only", () => {
    const offenders = files
      .filter((f) => f.path.startsWith("lib/") || f.path.startsWith("components/"))
      .filter((f) =>
        envReads(f.src).some((n) => !n.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(n)),
      )
      .filter((f) => !/import\s+["']server-only["']/.test(f.src))
      .map((f) => f.path);
    expect(
      offenders,
      `add \`import "server-only"\` so a client import fails at build:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("next.config does not forward env to the client", () => {
    const cfg = readFileSync(join(webRoot, "next.config.ts"), "utf8");
    expect(/^\s*env\s*:/m.test(cfg), "next.config `env:` block inlines values into the bundle").toBe(false);
  });
});
