"use client";

import { createContext, useCallback, useContext, useState } from "react";

type UserProfilePanelContextValue = {
  userId: string | null;
  open: (userId: string) => void;
  close: () => void;
};

const Ctx = createContext<UserProfilePanelContextValue | null>(null);

/**
 * Tracks which user (if any) is being viewed in the right-side profile panel.
 * Mounted once at the property layout so any chat surface (channels, DMs,
 * threads, mentions, members list) can open the panel on avatar click.
 */
export function UserProfilePanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [userId, setUserId] = useState<string | null>(null);

  const open = useCallback((id: string) => setUserId(id), []);
  const close = useCallback(() => setUserId(null), []);

  return (
    <Ctx.Provider value={{ userId, open, close }}>{children}</Ctx.Provider>
  );
}

export function useUserProfilePanel() {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error(
      "useUserProfilePanel must be used inside UserProfilePanelProvider",
    );
  }
  return v;
}
