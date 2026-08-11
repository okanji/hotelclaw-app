"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChannelSkeleton } from "./channel-skeleton";

/**
 * Client-side replacement for the chat index's old server `redirect()`.
 *
 * A hard load of `/chat` used to `redirect()` from the RSC page while the
 * property layout's heavy client providers (Stream, Liveblocks, video) were
 * still hydrating. The mid-stream tree swap reproducibly killed the page in
 * dev — Next's Router threw "Rendered more hooks than during the previous
 * render" (global error page, no app boundary catches it) and the Stream
 * client was torn down with a `queryChannels` still in flight ("Call
 * connectUser or connectAnonymousUser before creating a channel").
 * Navigating after mount lets hydration finish first; the skeleton keeps the
 * pane from flashing empty. Direct channel URLs never had the problem.
 */
export function ChatIndexRedirect({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [router, href]);

  return <ChannelSkeleton />;
}
