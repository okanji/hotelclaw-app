"use client";

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

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
