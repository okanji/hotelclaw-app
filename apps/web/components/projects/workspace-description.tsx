"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function resizeToContent(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Linear-style subtitle — always editable, no box. Blur to save, like the title.
 */
export function WorkspaceDescription({
  value,
  onSave,
  placeholder = "Add description…",
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<{ error?: string } | void>;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  useEffect(() => {
    if (ref.current) resizeToContent(ref.current);
  }, [draft]);

  async function commit() {
    const trimmed = draft.trim();
    const next = trimmed || null;
    if (next === (value?.trim() || null)) {
      setDraft(value ?? "");
      return;
    }
    const res = await onSave(next);
    if (res && "error" in res && res.error) {
      toast.error(res.error);
      setDraft(value ?? "");
    }
  }

  return (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        resizeToContent(e.target);
      }}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDraft(value ?? "");
          e.currentTarget.blur();
        }
      }}
      rows={1}
      placeholder={placeholder}
      aria-label="Description"
      className={cn(
        "w-full resize-none border-0 bg-transparent p-0 outline-none",
        "text-base leading-relaxed tracking-tight text-foreground/85",
        "placeholder:text-muted-foreground/55",
        "focus-visible:outline-none",
      )}
    />
  );
}
