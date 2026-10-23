globalThis.__nitro_main__ = import.meta.url;
import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
await import("./_libs/_8.mjs");
var instrumentation_entry_default = (await import("./_chunks/node-server.mjs")).default;
export { instrumentation_entry_default as default };
