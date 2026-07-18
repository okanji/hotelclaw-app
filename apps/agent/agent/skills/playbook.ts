import { defineDynamic, defineSkill } from "eve/skills";
import { resolvePodContext } from "../lib/pods";
import { getBrainPage } from "../lib/gbrain-http";

// Pod-bot operating playbook as a load-on-demand skill (fleet spec M2):
// the pod brain's compiled truth for this property+bot beyond the persona —
// procedures the model pulls in only when a task calls for them. Null on
// brain miss/outage (fail-soft; the persona fallback still stands).
export default defineDynamic({
  events: {
    "session.started": async (_event, ctx) => {
      const pod = await resolvePodContext(ctx);
      if (!pod?.bot) return null;

      const markdown = await getBrainPage(
        pod.brainUrl,
        pod.brainTokenRef,
        `playbooks/${pod.propertySlug}/${pod.bot.botSlug}-procedures`,
      );
      if (!markdown) return null;

      return defineSkill({
        description: `Detailed operating procedures for ${pod.bot.displayName} at this property. Use when a request needs the step-by-step playbook rather than a quick answer.`,
        markdown,
      });
    },
  },
});
