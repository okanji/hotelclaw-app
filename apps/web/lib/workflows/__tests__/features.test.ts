import { describe, expect, it } from "vitest";
import { STEPS, TRIGGERS } from "@/lib/workflows/catalog";
import type { Surface } from "@/lib/workflows/catalog/types";
import {
  AUTOMATION_FEATURES,
  builderPrefillHref,
  featureMeta,
  featureRole,
  featureStepIds,
  featureTriggerIds,
  workflowTouchesFeature,
  type AutomationFeature,
} from "@/lib/workflows/features";

/**
 * Guards for the feature lens behind the per-feature Automations modal
 * (components/workflows/automations-button.tsx). The lens is pure metadata
 * over the catalog, so every failure here is a real drift between what the
 * engine can do and what a feature page claims it can do.
 */

describe("automation features", () => {
  it("every feature matches at least one real catalog entry", () => {
    // A feature that matches nothing renders a lightning button whose modal is
    // permanently empty — the failure mode when a catalog surface gets renamed
    // out from under features.ts.
    for (const feature of AUTOMATION_FEATURES) {
      const total = featureTriggerIds(feature).length + featureStepIds(feature).length;
      expect(total, `feature "${feature}" matches no catalog entries`).toBeGreaterThan(0);
    }
  });

  it("claims only surfaces the catalog actually defines", () => {
    const known = new Set<Surface>([
      ...TRIGGERS.map((t) => t.surface),
      ...STEPS.map((s) => s.surface),
    ]);
    for (const feature of AUTOMATION_FEATURES) {
      for (const surface of featureMeta(feature).surfaces) {
        expect(known.has(surface), `feature "${feature}" claims unknown surface "${surface}"`).toBe(
          true,
        );
      }
    }
  });

  it("does not let two features claim the same surface", () => {
    // Overlapping claims mean one automation shows up under two unrelated
    // lightning buttons, which reads as a bug to the user.
    const owner = new Map<Surface, AutomationFeature>();
    for (const feature of AUTOMATION_FEATURES) {
      for (const surface of featureMeta(feature).surfaces) {
        expect(
          owner.get(surface),
          `surface "${surface}" claimed by both "${owner.get(surface)}" and "${feature}"`,
        ).toBeUndefined();
        owner.set(surface, feature);
      }
    }
  });

  it("matches a workflow by its trigger and by its steps", () => {
    const w = {
      trigger_event_type: "task.created",
      step_types: ["action.chat.post_message"],
    };
    expect(workflowTouchesFeature(w, "tasks")).toBe(true);
    expect(workflowTouchesFeature(w, "chat")).toBe(true);
    expect(workflowTouchesFeature(w, "docs")).toBe(false);

    expect(featureRole(w, "tasks")).toBe("trigger");
    expect(featureRole(w, "chat")).toBe("action");
    expect(featureRole(w, "docs")).toBeNull();
  });

  it("a spec-less draft workflow matches nothing", () => {
    const draft = { trigger_event_type: null, step_types: [] };
    for (const feature of AUTOMATION_FEATURES) {
      expect(workflowTouchesFeature(draft, feature)).toBe(false);
    }
  });

  it("keeps chatbots off the external surface", () => {
    // chatbot.* triggers are filed under `external` alongside webhooks. The
    // Chatbots feature must match them by id WITHOUT dragging in a plain
    // webhook workflow — the reason features exist separately from surfaces.
    const chatbot = { trigger_event_type: "chatbot.escalated", step_types: [] };
    const webhook = { trigger_event_type: "webhook.received", step_types: [] };
    expect(workflowTouchesFeature(chatbot, "chatbots")).toBe(true);
    expect(workflowTouchesFeature(webhook, "chatbots")).toBe(false);
  });

  it("round-trips a non-ASCII goal through the builder prefill", () => {
    // btoa() throws on non-Latin1, so an en dash in a suggestion title used to
    // break the link entirely. Mirror the decoder in new-workflow-client.tsx.
    const goal = "When a booking is cancelled — alert the front-desk café";
    const href = builderPrefillHref("prop-1", goal, { source: "test" });
    const raw = decodeURIComponent(href.split("prefill=")[1]);
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      goal: string;
      source: string;
    };
    expect(parsed.goal).toBe(goal);
    expect(parsed.source).toBe("test");
  });
});
