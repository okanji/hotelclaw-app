"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Announces a silent session swap. When an email link (invite, recovery) is
 * opened in a browser already signed in as someone else, /auth/confirm
 * replaces the session and drops a one-shot `account_switched` cookie —
 * this turns it into a toast so the swap is never invisible. Mounted once
 * in the root layout.
 */
export function AccountSwitchNotice() {
  useEffect(() => {
    const raw = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("account_switched="));
    if (!raw) return;
    document.cookie =
      "account_switched=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    try {
      const { from, to } = JSON.parse(
        decodeURIComponent(raw.slice("account_switched=".length)),
      ) as { from?: string; to?: string };
      if (!to) return;
      toast.info(`You're now signed in as ${to}`, {
        description: from
          ? `This replaced your ${from} session — one browser holds one account at a time.`
          : undefined,
        duration: 10000,
      });
    } catch {
      // Malformed cookie — already cleared, nothing to show.
    }
  }, []);

  return null;
}
