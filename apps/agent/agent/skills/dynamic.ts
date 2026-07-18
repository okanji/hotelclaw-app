import { defineDynamic, defineSkill } from "eve/skills";
import { resolveSessionAgent } from "../lib/agent-config";

// The selected agent's stored skills (SKILL.md-format markdown, edited in
// the Agents builder). eve advertises each description; the model loads a
// skill's full body only when the turn calls for it.
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const resolved = await resolveSessionAgent(ctx);
      if (!resolved || resolved.config.skills.length === 0) return null;

      return Object.fromEntries(
        resolved.config.skills.map((skill) => [
          skill.id,
          defineSkill({
            description: skill.description,
            markdown: `# ${skill.name}\n\n${skill.markdown}`,
          }),
        ]),
      );
    },
  },
});
