import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
function base64ToUint8Array(str) {
	const data = atob(str);
	const size = data.length;
	const bytes = new Uint8Array(size);
	for (let i = 0; i < size; i++) bytes[i] = data.charCodeAt(i);
	return bytes;
}
export { base64ToUint8Array };
