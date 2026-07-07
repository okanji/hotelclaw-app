import "server-only";
import { headers } from "next/headers";

/**
 * The app's public origin, for links in emails and external surfaces.
 * `NEXT_PUBLIC_SITE_URL` wins (set it in prod — cron-invoked handlers see
 * Vercel's internal host header); falls back to the request's forwarded
 * host in dev.
 */
export async function getOrigin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/$/, "");
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
