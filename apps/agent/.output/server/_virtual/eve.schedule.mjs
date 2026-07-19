import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
__eveDirname(__eveFileURLToPath(import.meta.url));
import { I as dispatchScheduleTask } from "../_libs/eve.mjs";
//#region #eve-schedule-task/eve.schedule.c2NoZWR1bGVzL21vcm5pbmdfb3BzLm1k
const config = { "kind": "production" };
var eve_schedule_default = {
	meta: { description: "Run eve schedule \"morning_ops\" from \"schedules/morning_ops.md\"." },
	async run(event) {
		return { result: await dispatchScheduleTask(event.name, config) };
	}
};
//#endregion
export { eve_schedule_default as default };
