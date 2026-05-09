"use client";

import { useEffect, useState } from "react";
import { StreamChat, type User } from "stream-chat";
import { Chat } from "stream-chat-react";

type Props = {
  userId: string;
  userName: string;
  avatarUrl: string | null;
  children: React.ReactNode;
};

export function StreamProvider({
  userId,
  userName,
  avatarUrl,
  children,
}: Props) {
  const [client, setClient] = useState<StreamChat | null>(null);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_STREAM_API_KEY;
    if (!apiKey) {
      console.warn("NEXT_PUBLIC_STREAM_API_KEY not set; chat is disabled.");
      return;
    }
    // Bump default 3s axios timeout — same fix as on the server. 3s is too tight
    // for cross-region calls; channel.watch() and connectUser were intermittently
    // exceeding it.
    const c = StreamChat.getInstance(apiKey, { timeout: 15000 });
    let cancelled = false;

    async function connect() {
      const res = await fetch("/api/stream/token", { cache: "no-store" });
      if (!res.ok) {
        console.error("Stream token request failed", res.status);
        return;
      }
      const { token } = (await res.json()) as { token: string };
      const user: User = {
        id: userId,
        name: userName,
        image: avatarUrl ?? undefined,
      };
      await c.connectUser(user, token);
      if (!cancelled) setClient(c);
    }

    connect();
    return () => {
      cancelled = true;
      c.disconnectUser().catch(() => {});
    };
  }, [userId, userName, avatarUrl]);

  if (!client) {
    return <>{children}</>;
  }

  return <Chat client={client}>{children}</Chat>;
}
