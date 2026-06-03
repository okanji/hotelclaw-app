import { NextResponse, type NextRequest } from "next/server";

/**
 * og: metadata fetch for the bookmark-fallback embed.
 *
 *   GET /api/documents/og-preview?url=<https-url>
 *
 * Returns `{ title, description, image, siteName }` parsed from the
 * upstream page's <meta> tags. Best-effort: returns whatever it can
 * scrape, leaving fields undefined when the page doesn't provide them.
 *
 * No caching layer for v1 — the embed node stores the resolved metadata
 * in its own attrs after the first fetch, so callers only hit this once
 * per inserted bookmark. If we later want previews on hover, add a
 * Supabase Storage or KV cache here.
 *
 * Security: we only allow http(s) URLs and we don't proxy any response
 * body — just JSON-stringified metadata. The fetch is server-side so
 * the upstream host can't see the visitor's IP.
 */

function pickMeta(
  html: string,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}["'][^>]*content=["']([^"']+)["']`,
      "i",
    );
    const m = html.match(re);
    if (m) return decodeEntities(m[1]);
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return NextResponse.json({ error: "http(s) only" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HotelclawDocs/1.0; +https://hotelclaw.com)",
        accept: "text/html,application/xhtml+xml",
      },
      // Don't follow forever — most pages put og:meta in the first response.
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { url: raw, error: `upstream ${res.status}` },
        { status: 200 },
      );
    }
    const html = (await res.text()).slice(0, 256 * 1024); // cap at 256KB
    const title =
      pickMeta(html, "og:title", "twitter:title") ??
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const description = pickMeta(
      html,
      "og:description",
      "twitter:description",
      "description",
    );
    const image = pickMeta(html, "og:image", "twitter:image");
    const siteName = pickMeta(html, "og:site_name");

    return NextResponse.json({
      url: raw,
      title: title ? decodeEntities(title) : undefined,
      description,
      image,
      siteName,
    });
  } catch (err) {
    console.warn("[og-preview] fetch failed", err);
    return NextResponse.json({ url: raw }, { status: 200 });
  }
}
