import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
__eveDirname(__eveFileURLToPath(import.meta.url));
import { t as createClient } from "../_libs/supabase__supabase-js.mjs";
//#region agent/lib/supabase.ts
let cached = null;
function serviceClient() {
	if (cached) return cached;
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) throw new Error("Supabase env missing: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
	cached = createClient(url, key, { auth: { persistSession: false } });
	return cached;
}
//#endregion
export { serviceClient as t };
