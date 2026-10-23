import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
import { dispatchScheduleTask } from "../_libs/eve.mjs";
const config = {
	"kind": "production",
	"sandboxScope": "c259e567acae5c1e"
};
var eve_schedule_default = {
	meta: { description: "Run eve schedule \"morning_ops\" from \"schedules/morning_ops.md\"." },
	async run(event) {
		return { result: await dispatchScheduleTask(event.name, config) };
	}
};
export { eve_schedule_default as default };
