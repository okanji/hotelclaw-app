import type { PropertyChannel } from "@/lib/chat/channels";
import type { RefCandidate } from "./refs";

const LABEL_PATHS = new Set(["trigger.added_labels", "trigger.new.labels"]);

/** Inject live property data into ref candidates (dropdowns / chip pickers). */
export function enrichRefsWithPropertyData(
  refs: RefCandidate[],
  data: { taskLabels?: string[]; channels?: PropertyChannel[] },
): RefCandidate[] {
  const labels = data.taskLabels?.filter(Boolean);
  const channels = data.channels?.filter((c) => c.name && c.streamChannelId);

  return refs.map((r) => {
    if (LABEL_PATHS.has(r.path) && labels?.length) {
      return { ...r, options: labels, type: "string[]" as const };
    }
    if (r.path === "trigger.channel.id" && channels?.length) {
      return {
        ...r,
        options: channels.map((c) => c.streamChannelId),
        sample: channels[0]!.name,
      };
    }
    return r;
  });
}
