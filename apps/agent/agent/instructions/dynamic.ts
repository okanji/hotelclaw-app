import { defineDynamic, defineInstructions } from "eve/instructions";
import { serviceClient } from "../lib/supabase";
import { tenantCallerOrNull } from "../lib/tenant";
import { resolveSessionAgent } from "../lib/agent-config";
import { resolvePodContext } from "../lib/pods";
import { getBrainPage } from "../lib/gbrain-http";

// Per-session instructions, resolved in priority order:
//   1. Pod bot (fleet spec): persona from the pod brain's compiled playbook
//      (playbooks/<property>/<bot>) when reachable, else the bot row's
//      persona_fallback — degradation, not outage.
//   2. Custom agent (Agents section): the stored config's instructions.
//   3. Bare session: generic runtime persona.
// What staff configure is exactly what lands here — the transparency contract.

const DISCIPLINE = [
  "## Operating discipline",
  "- Brain-first lookup: for property/guest/supplier/client questions AND general hospitality know-how, query the knowledge brain (brain_query) before answering — ONE call searches both this client's knowledge and the shared hotelclaw expertise (federated). App tools are the live truth for transactional numbers (availability, rates, balances) — never quote those from memory or brain pages.",
  "- Cite brain knowledge as [brain: <source_id>/<page-path>] — results carry a source_id: this client's own experience vs the shared hotelclaw playbook (master). Never blend uncited claims.",
  "- Never invent data. If neither brain nor tools answer, say so and offer to create a task or escalate.",
  "- Money-moving or irreversible actions go through approval-gated tools; never work around a gate.",
  "- Tenancy: you serve exactly one property in one client workspace per session. Never reference other clients' data.",
].join("\n");

export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const caller = tenantCallerOrNull(ctx);
      if (!caller) return null;

      const { data: property } = await serviceClient()
        .from("properties")
        .select("name")
        .eq("id", caller.propertyId)
        .maybeSingle();
      const propertyName = property?.name ?? "this property";

      // 1. Pod bot.
      const pod = await resolvePodContext(ctx);
      if (pod?.bot) {
        const playbook = await getBrainPage(
          pod.brainUrl,
          pod.brainTokenRef,
          `playbooks/${pod.propertySlug}/${pod.bot.botSlug}`,
        );
        const persona =
          playbook ??
          pod.bot.personaFallback ??
          `You are ${pod.bot.displayName}, an assistant for the property team.`;
        return defineInstructions({
          markdown: [
            `# ${pod.bot.displayName} — ${propertyName}`,
            "",
            persona.trim(),
            "",
            "## Context",
            `- Property: ${propertyName} (client workspace: ${pod.clientSlug}).`,
            `- You are speaking with a ${caller.role} member of staff.`,
            playbook
              ? "- Persona source: the pod brain's compiled playbook for this bot."
              : "- Persona source: fallback config (knowledge brain unreachable or playbook unseeded).",
            "",
            DISCIPLINE,
          ].join("\n"),
        });
      }

      // 2. Custom agent (Agents section).
      const resolved = await resolveSessionAgent(ctx);
      if (resolved) {
        return defineInstructions({
          markdown: [
            `# ${resolved.name}`,
            "",
            resolved.config.instructions.trim() ||
              "You are a helpful internal assistant for the property team.",
            "",
            "## Context",
            `- Property: ${propertyName}.`,
            `- You are speaking with a ${caller.role} member of the property's staff.`,
            "- Never invent data: answer from your tools, skills, and attached resources.",
            "- If asked what you can do, describe your granted tools and skills honestly.",
          ].join("\n"),
        });
      }

      // 3. Bare session.
      return defineInstructions({
        markdown: [
          `You are the internal AI agent runtime for ${propertyName}.`,
          `You are speaking with a ${caller.role} member of that property.`,
          "Answer tersely. Never invent data — use your tools.",
        ].join("\n"),
      });
    },
  },
});
