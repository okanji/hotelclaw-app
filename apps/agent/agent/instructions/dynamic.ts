import { defineDynamic, defineInstructions } from "eve/instructions";
import { KNOWLEDGE_DISCIPLINE } from "@hotelclaw/brain";
import { serviceClient } from "../lib/supabase";
import { tenantCallerOrNull } from "../lib/tenant";
import { CHANNEL_BOT_SLUG, resolveSessionAgent } from "../lib/agent-config";
import { resolvePodContext } from "../lib/pods";
import { getBrainPage } from "../lib/gbrain-http";
import { resolvePropertyBrainBinding } from "../lib/property-brain";

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
  "- The brain is ONE surface, not the whole ladder: authored documents live in the app (search_docs / read_doc) — check them too before answering knowledge/policy questions, and never state something doesn't exist until brain AND docs both returned empty. An empty result speaks only for the source that returned it.",
  "- Cite brain knowledge as [brain: <source_id>/<page-path>] — results carry a source_id: this client's own experience vs the shared hotelclaw playbook (master). Never blend uncited claims.",
  "- Never invent data. If neither brain nor tools answer, say so — name what you checked — and offer to create a task or escalate.",
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

      // 2. Custom agent (Agents section) — also serves the virtual default
      //    channel bot, which additionally gets an honest per-property
      //    knowledge-brain section (the brain tools in tools/channel-brain.ts
      //    mount only when a binding resolves; the instructions must match).
      const resolved = await resolveSessionAgent(ctx);
      if (resolved) {
        // Property profile (onboarding answers) — makes the "bots are
        // property-aware" claim true: type/size/departments/priorities
        // land in every session's context.
        const { data: profile } = await serviceClient()
          .from("property_profiles")
          .select("property_type, team_size, departments, priorities")
          .eq("property_id", caller.propertyId)
          .maybeSingle();
        const profileBits: string[] = [];
        if (profile?.property_type) profileBits.push(`type: ${profile.property_type}`);
        if (profile?.team_size) profileBits.push(`team size: ${profile.team_size}`);
        if (Array.isArray(profile?.departments) && profile.departments.length > 0) {
          profileBits.push(`departments: ${(profile.departments as string[]).join(", ")}`);
        }
        if (Array.isArray(profile?.priorities) && profile.priorities.length > 0) {
          profileBits.push(`priorities: ${(profile.priorities as string[]).join(", ")}`);
        }

        const markdown = [
          `# ${resolved.name}`,
          "",
          resolved.config.instructions.trim() ||
            "You are a helpful internal assistant for the property team.",
          "",
          "## Context",
          `- Property: ${propertyName}${profileBits.length > 0 ? ` (${profileBits.join("; ")})` : ""}.`,
          `- You are speaking with a ${caller.role} member of the property's staff.`,
          "- Never invent data: answer from your tools, skills, and attached resources.",
          "- If asked what you can do, describe your granted tools and skills honestly.",
          "",
          KNOWLEDGE_DISCIPLINE,
        ];
        if (resolved.agentId === `virtual:${CHANNEL_BOT_SLUG}`) {
          const binding = await resolvePropertyBrainBinding(caller.propertyId);
          markdown.push(
            "",
            "## Knowledge brain",
            binding
              ? [
                  "- This property has a shared knowledge brain — your brain_search, brain_get, brain_list, brain_think, and brain_capture tools.",
                  "- The brain holds captured institutional memory PLUS an automatic mirror of the property's documents under documents/ (may lag edits by minutes — the Documents tools are the authoritative copy).",
                  "- Cite brain knowledge as [brain: <page-path>].",
                ].join("\n")
              : "- No knowledge brain is provisioned for this property: you have NO brain tools and no memory beyond this channel's session. If asked about the brain or remembered knowledge, say so plainly — never claim brain access. Documents/tasks/meetings tools still work — check them before saying anything doesn't exist.",
          );
        }
        return defineInstructions({ markdown: markdown.join("\n") });
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
