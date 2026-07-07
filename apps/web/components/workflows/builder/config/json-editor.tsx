"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// Raw-JSON escape hatch shared by the step config "Advanced" section and the
// condition builder's JSON mode. Commits on blur; surfaces parse errors inline.
export function JsonEditor({
  value,
  onChange,
  hint,
}: {
  value: unknown;
  onChange: (next: unknown) => void;
  hint?: string;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2));
    setError(null);
  }, [value]);

  function commit() {
    try {
      const parsed = JSON.parse(text || "{}");
      onChange(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  return (
    <div className="space-y-1">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        rows={Math.min(20, Math.max(5, text.split("\n").length))}
        className="font-mono text-xs"
      />
      {error ? (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="size-3" /> {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
