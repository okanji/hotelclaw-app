import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
import { finalizeInstrumentationProviders, seedInstrumentationProviders, shutdownInstrumentationProviders } from "../_libs/eve.mjs";
seedInstrumentationProviders();
finalizeInstrumentationProviders({ serviceName: "agent" });
function installInstrumentationPlugin(nitroApp) {
	nitroApp?.hooks?.hook("close", async () => {
		await shutdownInstrumentationProviders();
	});
}
export { installInstrumentationPlugin };
