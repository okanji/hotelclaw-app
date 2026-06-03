/**
 * URL → embed-target detection for the generic Embed block.
 *
 * Given any URL the user pastes, returns the rendering strategy we should
 * use for it: a known provider's iframe (YouTube, Vimeo, Loom, Figma,
 * Spotify, CodePen), a tweet id (so the client can mount the twitter
 * widget), or a generic bookmark fallback that fetches og:meta on insert.
 *
 * Detection is host + path based. We try to normalize each provider's
 * various URL shapes (watch / share / shortened) into the canonical embed
 * URL the provider's iframe expects.
 */

export type EmbedTarget =
  | { kind: "youtube"; embedUrl: string }
  | { kind: "vimeo"; embedUrl: string }
  | { kind: "loom"; embedUrl: string }
  | { kind: "figma"; embedUrl: string }
  | { kind: "twitter"; tweetId: string }
  | { kind: "spotify"; embedUrl: string }
  | { kind: "codepen"; embedUrl: string }
  | { kind: "bookmark"; url: string };

export function detectEmbed(input: string): EmbedTarget {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { kind: "bookmark", url: input };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  // YouTube — youtu.be/{id}, youtube.com/watch?v={id}, youtube.com/shorts/{id}
  if (host === "youtu.be") {
    const id = url.pathname.replace(/^\//, "");
    if (id) return { kind: "youtube", embedUrl: `https://www.youtube.com/embed/${id}` };
  }
  if (host.endsWith("youtube.com")) {
    const id = url.searchParams.get("v");
    if (id) return { kind: "youtube", embedUrl: `https://www.youtube.com/embed/${id}` };
    const shorts = url.pathname.match(/^\/shorts\/([^/]+)/);
    if (shorts) return { kind: "youtube", embedUrl: `https://www.youtube.com/embed/${shorts[1]}` };
  }

  // Vimeo — vimeo.com/{id}
  if (host.endsWith("vimeo.com")) {
    const id = url.pathname.replace(/^\//, "").split("/")[0];
    if (/^\d+$/.test(id)) {
      return { kind: "vimeo", embedUrl: `https://player.vimeo.com/video/${id}` };
    }
  }

  // Loom — loom.com/share/{id}
  if (host.endsWith("loom.com")) {
    const m = url.pathname.match(/^\/share\/([a-zA-Z0-9]+)/);
    if (m) return { kind: "loom", embedUrl: `https://www.loom.com/embed/${m[1]}` };
  }

  // Figma — figma.com/file/... or figma.com/design/...
  if (host.endsWith("figma.com")) {
    if (/^\/(file|design|board|proto)\//.test(url.pathname)) {
      return {
        kind: "figma",
        embedUrl: `https://www.figma.com/embed?embed_host=hotelclaw&url=${encodeURIComponent(input)}`,
      };
    }
  }

  // Twitter / X — twitter.com/{user}/status/{id} | x.com/...
  if (host === "twitter.com" || host === "x.com") {
    const m = url.pathname.match(/\/status\/(\d+)/);
    if (m) return { kind: "twitter", tweetId: m[1] };
  }

  // Spotify — open.spotify.com/{type}/{id}
  if (host === "open.spotify.com") {
    const m = url.pathname.match(/^\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);
    if (m) {
      return {
        kind: "spotify",
        embedUrl: `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
      };
    }
  }

  // CodePen — codepen.io/{user}/pen/{id}
  if (host === "codepen.io") {
    const m = url.pathname.match(/^\/([^/]+)\/(pen|details|full|embed)\/([a-zA-Z0-9]+)/);
    if (m) {
      return {
        kind: "codepen",
        embedUrl: `https://codepen.io/${m[1]}/embed/${m[3]}?default-tab=result`,
      };
    }
  }

  return { kind: "bookmark", url: input };
}
