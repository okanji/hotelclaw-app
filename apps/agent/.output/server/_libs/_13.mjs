import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
export { w as APIError, Wt as Command, Gt as CommandFinished, ee as DEFAULT_SANDBOX_REGION, Cn as Drive, dn as FileSystem, xn as Sandbox, mn as SandboxUser, pn as SandboxUserAlreadyExistsError, Yt as Session, qt as Snapshot, T as StreamError, oi as defineSandboxProxy } from "./eve.mjs";
