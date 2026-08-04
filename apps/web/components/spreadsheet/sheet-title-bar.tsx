"use client";

/**
 * Title input for a spreadsheet doc. Single source of truth is
 * `documents.title` — mirrored via the same `renameDocument` server action
 * the rich-text editor uses. Debounced so we don't write on every keystroke.
 */

import { useEffect, useRef, useState } from "react";
import { renameDocument } from "../documents/actions";

const DEBOUNCE_MS = 600;
const TITLE_MAX_LENGTH = 200;

export function SheetTitleBar({
  documentId,
  initialTitle,
}: {
  documentId: string;
  initialTitle: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const lastSentRef = useRef(initialTitle);
  // Don't fight the user mid-type: only sync external changes when the field
  // has been idle.
  useEffect(() => {
    if (initialTitle !== lastSentRef.current) {
      setTitle(initialTitle);
      lastSentRef.current = initialTitle;
    }
  }, [initialTitle]);

  useEffect(() => {
    const trimmed = title.trim().slice(0, TITLE_MAX_LENGTH) || "Untitled sheet";
    if (trimmed === lastSentRef.current) return;
    const t = setTimeout(async () => {
      lastSentRef.current = trimmed;
      const res = await renameDocument(documentId, trimmed);
      if ("error" in res) {
        console.warn("sheet title sync failed:", res.error);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [title, documentId]);

  return (
    <input
      type="text"
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      placeholder="Untitled sheet"
      maxLength={TITLE_MAX_LENGTH}
      className="w-72 max-w-full bg-transparent text-base leading-6 font-semibold text-foreground outline-none placeholder:text-faint-foreground"
    />
  );
}
