"use client";

import { useMemo } from "react";
import { Braces } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { JsonEditor } from "@/components/workflows/builder/config/json-editor";
import {
  AvailableFieldsPanel,
  type AvailableFieldsMode,
} from "@/components/workflows/builder/config/available-fields-panel";
import type { RefCandidate } from "@/lib/workflows/refs";
import { validatePredicateExpr } from "@/lib/workflows/predicate-vars";
import type { WorkflowSpec } from "@/lib/workflows/spec";

export function InspectorAdvancedSection({
  draftId,
  onDraftIdChange,
  onDraftIdCommit,
  rawJson,
  refs,
  spec,
  stepId,
  renameError,
}: {
  draftId: string;
  onDraftIdChange: (next: string) => void;
  onDraftIdCommit: () => void;
  /** When set, shows raw config JSON below the identifier field. */
  rawJson?: {
    value: unknown;
    onChange: (next: unknown) => void;
    hint?: string;
    /** Validate `expr` var paths and show inline errors. */
    validateExpr?: boolean;
    /** Show the field path catalog (for raw JSON / JSONLogic editing). */
    showFieldCatalog?: boolean;
    fieldCatalogMode?: AvailableFieldsMode;
  };
  refs?: RefCandidate[];
  spec?: WorkflowSpec;
  stepId?: string;
  renameError?: string | null;
}) {
  const exprErrors = useMemo(() => {
    if (!spec || !rawJson?.validateExpr) return [];
    const expr = (rawJson.value as { expr?: unknown } | undefined)?.expr;
    if (expr === undefined) return [];
    return validatePredicateExpr(expr, stepId ?? null, spec);
  }, [spec, rawJson, stepId]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label className="text-sm text-muted-foreground">Reference name</Label>
        <Input
          value={draftId}
          onChange={(e) => onDraftIdChange(e.target.value.replace(/[^a-z0-9_]/gi, "_"))}
          onBlur={onDraftIdCommit}
          className="text-sm"
          placeholder="my_step"
          aria-invalid={Boolean(renameError)}
        />
        {renameError ? (
          <p className="text-sm text-destructive">{renameError}</p>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            A short name later steps use to pull in this step’s results. Changing it updates
            those references automatically.
          </p>
        )}
      </div>

      {rawJson?.showFieldCatalog !== false &&
      refs &&
      refs.length > 0 &&
      (rawJson?.showFieldCatalog || rawJson?.validateExpr) ? (
        <AvailableFieldsPanel
          refs={refs}
          mode={rawJson?.fieldCatalogMode ?? (rawJson?.validateExpr ? "condition" : "both")}
        />
      ) : null}

      {rawJson ? (
        <details className="rounded-lg bg-muted/[0.04]">
          <summary className="flex cursor-pointer items-center gap-1.5 px-3 py-2.5 text-sm text-muted-foreground select-none hover:text-foreground">
            <Braces className="size-3.5" aria-hidden />
            <span>Advanced settings</span>
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            {exprErrors.length > 0 ? (
              <ul className="space-y-1 rounded-md bg-destructive/10 px-2.5 py-2">
                {exprErrors.map((msg) => (
                  <li key={msg} className="text-xs leading-relaxed text-destructive">
                    {msg}
                  </li>
                ))}
              </ul>
            ) : null}
            <JsonEditor
              value={rawJson.value}
              onChange={rawJson.onChange}
              hint={
                rawJson.hint ??
                "For power users — edit the raw settings directly. The fields above cover almost everything."
              }
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}
