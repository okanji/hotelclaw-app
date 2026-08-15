"use client";

import { createContext, useContext, useState } from "react";

type ArtifactTarget = {
  kind: "document" | "sheet";
  documentId: string;
  title: string;
};

type ArtifactPanelContextValue = {
  target: ArtifactTarget | null;
  open: (target: ArtifactTarget) => void;
  openDocument: (documentId: string, title: string) => void;
  close: () => void;
};

const Ctx = createContext<ArtifactPanelContextValue | null>(null);

/**
 * Open/close state for the chat's split-screen artifact panel — the
 * Claude-style side view that shows the LIVE record the AI is working on
 * (bot document writes are transactional Liveblocks edits and sheet writes
 * are storage mutations, so an open panel renders them as they stream in).
 * Mirrors InfoPanelProvider.
 */
export function ArtifactPanelProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<ArtifactTarget | null>(null);
  return (
    <Ctx.Provider
      value={{
        target,
        open: setTarget,
        openDocument: (documentId, title) =>
          setTarget({ kind: "document", documentId, title }),
        close: () => setTarget(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useArtifactPanel() {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useArtifactPanel must be used inside ArtifactPanelProvider");
  }
  return v;
}

/**
 * Same context, but null outside the provider — for surfaces that render
 * chat attachments and should degrade to plain links when no split panel
 * is mounted.
 */
export function useOptionalArtifactPanel() {
  return useContext(Ctx);
}
