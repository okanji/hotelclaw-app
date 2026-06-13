import "server-only";
/**
 * Executor for user-defined HTTP actions (the Chatbase "Custom Action"
 * pattern). The model collects typed params; we substitute them into the
 * URL/body template, attach the decrypted headers, and call out — behind a
 * hard security envelope:
 *
 *   • HTTPS only, and the hostname's RESOLVED address must be public
 *     (blocks SSRF at both the name and IP layer; DNS-pinning TOCTOU is
 *     accepted for v1)
 *   • 10s timeout, no redirects (a redirect could hop to an internal host)
 *   • responses must be JSON and ≤ 20KB
 *   • the model only sees response fields on the action's allowlist
 *     (Chatbase "Limited Data Access") — empty allowlist = full response
 */
import { lookup } from "dns/promises";
import { isIP } from "net";
import { decryptSecret } from "@/lib/chatbots/crypto";
import type { Database } from "@/lib/db/types";

export type CustomActionRow =
  Database["public"]["Tables"]["chatbot_custom_actions"]["Row"];

const RESPONSE_CAP_BYTES = 20_000;
const TIMEOUT_MS = 10_000;

function isPrivateAddress(addr: string): boolean {
  if (addr.includes(":")) {
    // IPv6: loopback, link-local, unique-local, v4-mapped private.
    const a = addr.toLowerCase();
    return (
      a === "::1" ||
      a.startsWith("fe80:") ||
      a.startsWith("fc") ||
      a.startsWith("fd") ||
      a.startsWith("::ffff:127.") ||
      a.startsWith("::ffff:10.") ||
      a.startsWith("::ffff:192.168.")
    );
  }
  return (
    /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(addr) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(addr)
  );
}

/** Throws with a staff-readable reason when the URL must not be fetched. */
export async function assertFetchableUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "https:") throw new Error("Only https:// URLs are allowed");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Internal hostnames are not allowed");
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private IP addresses are not allowed");
    return url;
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true });
  } catch {
    throw new Error("Hostname does not resolve");
  }
  if (resolved.length === 0 || resolved.some((r) => isPrivateAddress(r.address))) {
    throw new Error("Hostname resolves to a private address");
  }
  return url;
}

function substitute(template: string, params: Record<string, unknown>, encode: boolean): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return "";
    const s = String(value);
    return encode ? encodeURIComponent(s) : s;
  });
}

/** Project an object down to the allowlisted dot-paths. */
export function applyAllowlist(data: unknown, allowlist: string[]): unknown {
  if (allowlist.length === 0) return data;
  const out: Record<string, unknown> = {};
  for (const path of allowlist) {
    const segments = path.split(".");
    let cursor: unknown = data;
    for (const segment of segments) {
      if (cursor !== null && typeof cursor === "object" && segment in (cursor as object)) {
        cursor = (cursor as Record<string, unknown>)[segment];
      } else {
        cursor = undefined;
        break;
      }
    }
    if (cursor !== undefined) out[path] = cursor;
  }
  return out;
}

export type CustomActionResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; error: string };

export async function executeCustomAction(
  action: Pick<
    CustomActionRow,
    "method" | "url" | "headers" | "body_template" | "param_schema" | "response_allowlist"
  >,
  params: Record<string, unknown>,
): Promise<CustomActionResult> {
  try {
    // Substitute {{param}} into the URL (encoded); unreferenced params on a
    // GET become query string entries.
    const referenced = new Set(
      [...action.url.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), ...(action.body_template?.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) ?? [])].map((m) => m[1]),
    );
    const url = await assertFetchableUrl(substitute(action.url, params, true));
    if (action.method === "GET") {
      for (const field of action.param_schema) {
        if (!referenced.has(field.name) && params[field.name] !== undefined) {
          url.searchParams.set(field.name, String(params[field.name]));
        }
      }
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    for (const h of action.headers) {
      const value = decryptSecret(h.value_encrypted);
      if (value !== null) headers[h.name] = value;
    }

    let body: string | undefined;
    if (action.method !== "GET") {
      headers["Content-Type"] = "application/json";
      body = action.body_template
        ? substitute(action.body_template, params, false)
        : JSON.stringify(params);
      // A body template must still be valid JSON after substitution.
      try {
        JSON.parse(body);
      } catch {
        return { ok: false, error: "Body template did not produce valid JSON" };
      }
    }

    const res = await fetch(url, {
      method: action.method,
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const raw = await res.text();
    if (raw.length > RESPONSE_CAP_BYTES) {
      return { ok: false, error: `Response too large (> ${RESPONSE_CAP_BYTES / 1000}KB)` };
    }
    let data: unknown;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      return { ok: false, error: "Response was not JSON" };
    }
    return {
      ok: true,
      status: res.status,
      data: applyAllowlist(data, action.response_allowlist),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Request failed",
    };
  }
}
