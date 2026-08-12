import { describe, expect, it } from "vitest";
import {
  buildFieldTriggerFilterExpr,
  extractFieldTriggerFilter,
  stripFieldTriggerFilter,
} from "@/lib/workflows/trigger-filter";
import { evaluatePredicate } from "@/lib/workflows/predicate";
import type { ResolutionScope } from "@/lib/workflows/resolve";

// The 2026-08-12 fix: "becomes X" clauses must match the ENRICHED payload
// (to_label / to_labels from migration 0101), never the raw stored value —
// the raw `to` is an option id (select), an id array (multi_select), or a
// real boolean (checkbox), none of which equals the label the picker stores.

function scope(trigger: Record<string, unknown>): ResolutionScope {
  return { trigger } as unknown as ResolutionScope;
}

describe("field trigger filter", () => {
  it("select: matches on to_label, not the stored option id", () => {
    const expr = buildFieldTriggerFilterExpr({
      fieldName: "Material status",
      toValue: "LPO created",
    });
    const payload = {
      field_name: "Material status",
      to: "lpo-created",
      to_label: "LPO created",
    };
    expect(evaluatePredicate(expr, scope(payload))).toBe(true);
    expect(
      evaluatePredicate(expr, scope({ ...payload, to_label: "Quoting" })),
    ).toBe(false);
  });

  it("multi_select: membership in to_labels, so extra labels still match", () => {
    const expr = buildFieldTriggerFilterExpr({
      fieldName: "Urgency tag",
      toValue: "VIP",
      multi: true,
    });
    const hit = {
      field_name: "Urgency tag",
      to: ["vip", "rush"],
      to_labels: ["VIP", "Rush"],
    };
    expect(evaluatePredicate(expr, scope(hit))).toBe(true);
    expect(
      evaluatePredicate(
        expr,
        scope({ ...hit, to_labels: ["Rush"] }),
      ),
    ).toBe(false);
  });

  it("checkbox: 'true'/'false' strings compare against to_label text", () => {
    const expr = buildFieldTriggerFilterExpr({
      fieldName: "Sign-off",
      toValue: "true",
    });
    expect(
      evaluatePredicate(
        expr,
        scope({ field_name: "Sign-off", to: true, to_label: "true" }),
      ),
    ).toBe(true);
  });

  it("round-trips through extract, including the multi flag", () => {
    const expr = buildFieldTriggerFilterExpr({
      fieldName: "Urgency tag",
      toValue: "VIP",
      multi: true,
    });
    const back = extractFieldTriggerFilter(expr);
    expect(back).toEqual({ fieldName: "Urgency tag", toValue: "VIP", multi: true });
  });

  it("reads pre-0101 filters that pointed at trigger.to", () => {
    const legacy = {
      and: [
        { "==": [{ var: "trigger.field_name" }, "Material status"] },
        { "==": [{ var: "trigger.to" }, "LPO created"] },
      ],
    };
    const back = extractFieldTriggerFilter(legacy);
    expect(back.fieldName).toBe("Material status");
    expect(back.toValue).toBe("LPO created");
    expect(stripFieldTriggerFilter(legacy)).toBeUndefined();
  });
});
