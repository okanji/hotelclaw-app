"use client";

import { useRouter } from "next/navigation";

import { createContext, useContext, useEffect, useState } from "react";

type Ctx = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
};

const CommandPaletteCtx = createContext<Ctx | null>(null);

/**
 * Holds the open state so both the keyboard shortcut (Cmd+K) and any
 * visible "Search" trigger in the sidebar can drive the same palette
 * instance.
 */
export function CommandPaletteProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // `N` → new task (gr8r / Linear convention). Bare key only: never while
      // typing, never with a modifier, and only inside a property.
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const el = document.activeElement as HTMLElement | null;
        const typing =
          !!el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.tagName === "SELECT" ||
            el.isContentEditable);
        if (typing) return;
        const m = window.location.pathname.match(/^\/p\/([^/]+)/);
        if (!m) return;
        e.preventDefault();
        router.push(`/p/${m[1]}/tasks/new`);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  return (
    <CommandPaletteCtx.Provider
      value={{ open, setOpen, toggle: () => setOpen((o) => !o) }}
    >
      {children}
    </CommandPaletteCtx.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteCtx);
  if (!ctx) {
    throw new Error(
      "useCommandPalette must be used inside CommandPaletteProvider",
    );
  }
  return ctx;
}
