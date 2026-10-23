import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
import { createStorage, prefixStorage } from "../_libs/unstorage.mjs";
const _assets = {
	["eve-skill-index:skills.json"]: {
		import: () => import("../_virtual/skills.json.mjs").then((r) => r.default || r),
		meta: {
			"type": "application/json",
			"etag": "\"f1-2FGwQLudRo66a+xgVdMHdOAEbz4\"",
			"mtime": "1970-01-01T00:00:00.000Z"
		}
	},
	["eve-skills:907d289166dabb51a72f245b3b104c237fa95cbb02ce981bfddf55ef79f1f14d.bin"]: {
		import: () => import("../_virtual/907d289166dabb51a72f245b3b104c237fa95cbb02ce981bfddf55ef79f1f14d.bin.mjs").then((r) => r.default || r),
		meta: {
			"type": "application/octet-stream",
			"etag": "\"8ef-lqR13p3nk0sNTW4x+32tHYCQhck\"",
			"mtime": "1970-01-01T00:00:00.000Z"
		}
	},
	["eve-skills:a43c1f83178c1d74c3eb98c688804dea69967cde985cb4419dba4b5dd50be266.bin"]: {
		import: () => import("../_virtual/a43c1f83178c1d74c3eb98c688804dea69967cde985cb4419dba4b5dd50be266.bin.mjs").then((r) => r.default || r),
		meta: {
			"type": "application/octet-stream",
			"etag": "\"10c7-Nn5I+9fNhTa7Yrq9YXbi9hRoeW4\"",
			"mtime": "1970-01-01T00:00:00.000Z"
		}
	}
};
const normalizeKey = function normalizeKey(key) {
	if (!key) return "";
	return key.split("?")[0]?.replace(/[/\\]/g, ":").replace(/:+/g, ":").replace(/^:|:$/g, "") || "";
};
const assets = {
	getKeys() {
		return Promise.resolve(Object.keys(_assets));
	},
	hasItem(id) {
		id = normalizeKey(id);
		return Promise.resolve(id in _assets);
	},
	getItem(id) {
		id = normalizeKey(id);
		return Promise.resolve(_assets[id] ? _assets[id].import() : null);
	},
	getMeta(id) {
		id = normalizeKey(id);
		return Promise.resolve(_assets[id] ? _assets[id].meta : {});
	}
};
function initStorage() {
	const storage = createStorage({});
	storage.mount("/assets", assets);
	return storage;
}
function useStorage(base = "") {
	const storage = useStorage._storage ??= initStorage();
	return base ? prefixStorage(storage, base) : storage;
}
export { useStorage };
