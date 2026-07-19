import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
__eveDirname(__eveFileURLToPath(import.meta.url));
import { t as __commonJSMin } from "../../_runtime.mjs";
import { t as require_main$1 } from "../supabase__functions-js.mjs";
import { t as require_dist$4 } from "../supabase__postgrest-js.mjs";
import { t as require_main$2 } from "../supabase__realtime-js.mjs";
import { t as require_main$3 } from "../supabase__auth-js.mjs";
//#region ../../node_modules/iceberg-js/dist/index.cjs
var require_dist$3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	var IcebergError = class extends Error {
		constructor(message, opts) {
			super(message);
			this.name = "IcebergError";
			this.status = opts.status;
			this.icebergType = opts.icebergType;
			this.icebergCode = opts.icebergCode;
			this.details = opts.details;
			this.isCommitStateUnknown = opts.icebergType === "CommitStateUnknownException" || [
				500,
				502,
				504
			].includes(opts.status) && opts.icebergType?.includes("CommitState") === true;
		}
		/**
		* Returns true if the error is a 404 Not Found error.
		*/
		isNotFound() {
			return this.status === 404;
		}
		/**
		* Returns true if the error is a 409 Conflict error.
		*/
		isConflict() {
			return this.status === 409;
		}
		/**
		* Returns true if the error is a 419 Authentication Timeout error.
		*/
		isAuthenticationTimeout() {
			return this.status === 419;
		}
	};
	function buildUrl(baseUrl, path, query) {
		const url = new URL(path, baseUrl);
		if (query) {
			for (const [key, value] of Object.entries(query)) if (value !== void 0) url.searchParams.set(key, value);
		}
		return url.toString();
	}
	async function buildAuthHeaders(auth) {
		if (!auth || auth.type === "none") return {};
		if (auth.type === "bearer") return { Authorization: `Bearer ${auth.token}` };
		if (auth.type === "header") return { [auth.name]: auth.value };
		if (auth.type === "custom") return await auth.getHeaders();
		return {};
	}
	function createFetchClient(options) {
		const fetchFn = options.fetchImpl ?? globalThis.fetch;
		return { async request({ method, path, query, body, headers }) {
			const url = buildUrl(options.baseUrl, path, query);
			const authHeaders = await buildAuthHeaders(options.auth);
			const res = await fetchFn(url, {
				method,
				headers: {
					...body ? { "Content-Type": "application/json" } : {},
					...authHeaders,
					...headers
				},
				body: body ? JSON.stringify(body) : void 0
			});
			const text = await res.text();
			const isJson = (res.headers.get("content-type") || "").includes("application/json");
			const data = isJson && text ? JSON.parse(text) : text;
			if (!res.ok) {
				const errBody = isJson ? data : void 0;
				const errorDetail = errBody?.error;
				throw new IcebergError(errorDetail?.message ?? `Request failed with status ${res.status}`, {
					status: res.status,
					icebergType: errorDetail?.type,
					icebergCode: errorDetail?.code,
					details: errBody
				});
			}
			return {
				status: res.status,
				headers: res.headers,
				data
			};
		} };
	}
	function namespaceToPath(namespace) {
		return namespace.join("");
	}
	var NamespaceOperations = class {
		constructor(client, prefix = "") {
			this.client = client;
			this.prefix = prefix;
		}
		async listNamespaces(parent) {
			const query = parent ? { parent: namespaceToPath(parent.namespace) } : void 0;
			return (await this.client.request({
				method: "GET",
				path: `${this.prefix}/namespaces`,
				query
			})).data.namespaces.map((ns) => ({ namespace: ns }));
		}
		async createNamespace(id, metadata) {
			const request = {
				namespace: id.namespace,
				properties: metadata?.properties
			};
			return (await this.client.request({
				method: "POST",
				path: `${this.prefix}/namespaces`,
				body: request
			})).data;
		}
		async dropNamespace(id) {
			await this.client.request({
				method: "DELETE",
				path: `${this.prefix}/namespaces/${namespaceToPath(id.namespace)}`
			});
		}
		async loadNamespaceMetadata(id) {
			return { properties: (await this.client.request({
				method: "GET",
				path: `${this.prefix}/namespaces/${namespaceToPath(id.namespace)}`
			})).data.properties };
		}
		async namespaceExists(id) {
			try {
				await this.client.request({
					method: "HEAD",
					path: `${this.prefix}/namespaces/${namespaceToPath(id.namespace)}`
				});
				return true;
			} catch (error) {
				if (error instanceof IcebergError && error.status === 404) return false;
				throw error;
			}
		}
		async createNamespaceIfNotExists(id, metadata) {
			try {
				return await this.createNamespace(id, metadata);
			} catch (error) {
				if (error instanceof IcebergError && error.status === 409) return;
				throw error;
			}
		}
	};
	function namespaceToPath2(namespace) {
		return namespace.join("");
	}
	var TableOperations = class {
		constructor(client, prefix = "", accessDelegation) {
			this.client = client;
			this.prefix = prefix;
			this.accessDelegation = accessDelegation;
		}
		async listTables(namespace) {
			return (await this.client.request({
				method: "GET",
				path: `${this.prefix}/namespaces/${namespaceToPath2(namespace.namespace)}/tables`
			})).data.identifiers;
		}
		async createTable(namespace, request) {
			const headers = {};
			if (this.accessDelegation) headers["X-Iceberg-Access-Delegation"] = this.accessDelegation;
			return (await this.client.request({
				method: "POST",
				path: `${this.prefix}/namespaces/${namespaceToPath2(namespace.namespace)}/tables`,
				body: request,
				headers
			})).data.metadata;
		}
		async updateTable(id, request) {
			const response = await this.client.request({
				method: "POST",
				path: `${this.prefix}/namespaces/${namespaceToPath2(id.namespace)}/tables/${id.name}`,
				body: request
			});
			return {
				"metadata-location": response.data["metadata-location"],
				metadata: response.data.metadata
			};
		}
		async dropTable(id, options) {
			await this.client.request({
				method: "DELETE",
				path: `${this.prefix}/namespaces/${namespaceToPath2(id.namespace)}/tables/${id.name}`,
				query: { purgeRequested: String(options?.purge ?? false) }
			});
		}
		async loadTable(id) {
			const headers = {};
			if (this.accessDelegation) headers["X-Iceberg-Access-Delegation"] = this.accessDelegation;
			return (await this.client.request({
				method: "GET",
				path: `${this.prefix}/namespaces/${namespaceToPath2(id.namespace)}/tables/${id.name}`,
				headers
			})).data.metadata;
		}
		async tableExists(id) {
			const headers = {};
			if (this.accessDelegation) headers["X-Iceberg-Access-Delegation"] = this.accessDelegation;
			try {
				await this.client.request({
					method: "HEAD",
					path: `${this.prefix}/namespaces/${namespaceToPath2(id.namespace)}/tables/${id.name}`,
					headers
				});
				return true;
			} catch (error) {
				if (error instanceof IcebergError && error.status === 404) return false;
				throw error;
			}
		}
		async createTableIfNotExists(namespace, request) {
			try {
				return await this.createTable(namespace, request);
			} catch (error) {
				if (error instanceof IcebergError && error.status === 409) return await this.loadTable({
					namespace: namespace.namespace,
					name: request.name
				});
				throw error;
			}
		}
	};
	var IcebergRestCatalog = class {
		/**
		* Creates a new Iceberg REST Catalog client.
		*
		* @param options - Configuration options for the catalog client
		*/
		constructor(options) {
			let prefix = "v1";
			if (options.catalogName) prefix += `/${options.catalogName}`;
			const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`;
			this.client = createFetchClient({
				baseUrl,
				auth: options.auth,
				fetchImpl: options.fetch
			});
			this.accessDelegation = options.accessDelegation?.join(",");
			this.namespaceOps = new NamespaceOperations(this.client, prefix);
			this.tableOps = new TableOperations(this.client, prefix, this.accessDelegation);
		}
		/**
		* Lists all namespaces in the catalog.
		*
		* @param parent - Optional parent namespace to list children under
		* @returns Array of namespace identifiers
		*
		* @example
		* ```typescript
		* // List all top-level namespaces
		* const namespaces = await catalog.listNamespaces();
		*
		* // List namespaces under a parent
		* const children = await catalog.listNamespaces({ namespace: ['analytics'] });
		* ```
		*/
		async listNamespaces(parent) {
			return this.namespaceOps.listNamespaces(parent);
		}
		/**
		* Creates a new namespace in the catalog.
		*
		* @param id - Namespace identifier to create
		* @param metadata - Optional metadata properties for the namespace
		* @returns Response containing the created namespace and its properties
		*
		* @example
		* ```typescript
		* const response = await catalog.createNamespace(
		*   { namespace: ['analytics'] },
		*   { properties: { owner: 'data-team' } }
		* );
		* console.log(response.namespace); // ['analytics']
		* console.log(response.properties); // { owner: 'data-team', ... }
		* ```
		*/
		async createNamespace(id, metadata) {
			return this.namespaceOps.createNamespace(id, metadata);
		}
		/**
		* Drops a namespace from the catalog.
		*
		* The namespace must be empty (contain no tables) before it can be dropped.
		*
		* @param id - Namespace identifier to drop
		*
		* @example
		* ```typescript
		* await catalog.dropNamespace({ namespace: ['analytics'] });
		* ```
		*/
		async dropNamespace(id) {
			await this.namespaceOps.dropNamespace(id);
		}
		/**
		* Loads metadata for a namespace.
		*
		* @param id - Namespace identifier to load
		* @returns Namespace metadata including properties
		*
		* @example
		* ```typescript
		* const metadata = await catalog.loadNamespaceMetadata({ namespace: ['analytics'] });
		* console.log(metadata.properties);
		* ```
		*/
		async loadNamespaceMetadata(id) {
			return this.namespaceOps.loadNamespaceMetadata(id);
		}
		/**
		* Lists all tables in a namespace.
		*
		* @param namespace - Namespace identifier to list tables from
		* @returns Array of table identifiers
		*
		* @example
		* ```typescript
		* const tables = await catalog.listTables({ namespace: ['analytics'] });
		* console.log(tables); // [{ namespace: ['analytics'], name: 'events' }, ...]
		* ```
		*/
		async listTables(namespace) {
			return this.tableOps.listTables(namespace);
		}
		/**
		* Creates a new table in the catalog.
		*
		* @param namespace - Namespace to create the table in
		* @param request - Table creation request including name, schema, partition spec, etc.
		* @returns Table metadata for the created table
		*
		* @example
		* ```typescript
		* const metadata = await catalog.createTable(
		*   { namespace: ['analytics'] },
		*   {
		*     name: 'events',
		*     schema: {
		*       type: 'struct',
		*       fields: [
		*         { id: 1, name: 'id', type: 'long', required: true },
		*         { id: 2, name: 'timestamp', type: 'timestamp', required: true }
		*       ],
		*       'schema-id': 0
		*     },
		*     'partition-spec': {
		*       'spec-id': 0,
		*       fields: [
		*         { source_id: 2, field_id: 1000, name: 'ts_day', transform: 'day' }
		*       ]
		*     }
		*   }
		* );
		* ```
		*/
		async createTable(namespace, request) {
			return this.tableOps.createTable(namespace, request);
		}
		/**
		* Updates an existing table's metadata.
		*
		* Can update the schema, partition spec, or properties of a table.
		*
		* @param id - Table identifier to update
		* @param request - Update request with fields to modify
		* @returns Response containing the metadata location and updated table metadata
		*
		* @example
		* ```typescript
		* const response = await catalog.updateTable(
		*   { namespace: ['analytics'], name: 'events' },
		*   {
		*     properties: { 'read.split.target-size': '134217728' }
		*   }
		* );
		* console.log(response['metadata-location']); // s3://...
		* console.log(response.metadata); // TableMetadata object
		* ```
		*/
		async updateTable(id, request) {
			return this.tableOps.updateTable(id, request);
		}
		/**
		* Drops a table from the catalog.
		*
		* @param id - Table identifier to drop
		*
		* @example
		* ```typescript
		* await catalog.dropTable({ namespace: ['analytics'], name: 'events' });
		* ```
		*/
		async dropTable(id, options) {
			await this.tableOps.dropTable(id, options);
		}
		/**
		* Loads metadata for a table.
		*
		* @param id - Table identifier to load
		* @returns Table metadata including schema, partition spec, location, etc.
		*
		* @example
		* ```typescript
		* const metadata = await catalog.loadTable({ namespace: ['analytics'], name: 'events' });
		* console.log(metadata.schema);
		* console.log(metadata.location);
		* ```
		*/
		async loadTable(id) {
			return this.tableOps.loadTable(id);
		}
		/**
		* Checks if a namespace exists in the catalog.
		*
		* @param id - Namespace identifier to check
		* @returns True if the namespace exists, false otherwise
		*
		* @example
		* ```typescript
		* const exists = await catalog.namespaceExists({ namespace: ['analytics'] });
		* console.log(exists); // true or false
		* ```
		*/
		async namespaceExists(id) {
			return this.namespaceOps.namespaceExists(id);
		}
		/**
		* Checks if a table exists in the catalog.
		*
		* @param id - Table identifier to check
		* @returns True if the table exists, false otherwise
		*
		* @example
		* ```typescript
		* const exists = await catalog.tableExists({ namespace: ['analytics'], name: 'events' });
		* console.log(exists); // true or false
		* ```
		*/
		async tableExists(id) {
			return this.tableOps.tableExists(id);
		}
		/**
		* Creates a namespace if it does not exist.
		*
		* If the namespace already exists, returns void. If created, returns the response.
		*
		* @param id - Namespace identifier to create
		* @param metadata - Optional metadata properties for the namespace
		* @returns Response containing the created namespace and its properties, or void if it already exists
		*
		* @example
		* ```typescript
		* const response = await catalog.createNamespaceIfNotExists(
		*   { namespace: ['analytics'] },
		*   { properties: { owner: 'data-team' } }
		* );
		* if (response) {
		*   console.log('Created:', response.namespace);
		* } else {
		*   console.log('Already exists');
		* }
		* ```
		*/
		async createNamespaceIfNotExists(id, metadata) {
			return this.namespaceOps.createNamespaceIfNotExists(id, metadata);
		}
		/**
		* Creates a table if it does not exist.
		*
		* If the table already exists, returns its metadata instead.
		*
		* @param namespace - Namespace to create the table in
		* @param request - Table creation request including name, schema, partition spec, etc.
		* @returns Table metadata for the created or existing table
		*
		* @example
		* ```typescript
		* const metadata = await catalog.createTableIfNotExists(
		*   { namespace: ['analytics'] },
		*   {
		*     name: 'events',
		*     schema: {
		*       type: 'struct',
		*       fields: [
		*         { id: 1, name: 'id', type: 'long', required: true },
		*         { id: 2, name: 'timestamp', type: 'timestamp', required: true }
		*       ],
		*       'schema-id': 0
		*     }
		*   }
		* );
		* ```
		*/
		async createTableIfNotExists(namespace, request) {
			return this.tableOps.createTableIfNotExists(namespace, request);
		}
	};
	var DECIMAL_REGEX = /^decimal\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/;
	var FIXED_REGEX = /^fixed\s*\[\s*(\d+)\s*\]$/;
	function parseDecimalType(type) {
		const match = type.match(DECIMAL_REGEX);
		if (!match) return null;
		return {
			precision: parseInt(match[1], 10),
			scale: parseInt(match[2], 10)
		};
	}
	function parseFixedType(type) {
		const match = type.match(FIXED_REGEX);
		if (!match) return null;
		return { length: parseInt(match[1], 10) };
	}
	function isDecimalType(type) {
		return DECIMAL_REGEX.test(type);
	}
	function isFixedType(type) {
		return FIXED_REGEX.test(type);
	}
	function typesEqual(a, b) {
		const decimalA = parseDecimalType(a);
		const decimalB = parseDecimalType(b);
		if (decimalA && decimalB) return decimalA.precision === decimalB.precision && decimalA.scale === decimalB.scale;
		const fixedA = parseFixedType(a);
		const fixedB = parseFixedType(b);
		if (fixedA && fixedB) return fixedA.length === fixedB.length;
		return a === b;
	}
	function getCurrentSchema(metadata) {
		return metadata.schemas.find((s) => s["schema-id"] === metadata["current-schema-id"]);
	}
	exports.IcebergError = IcebergError;
	exports.IcebergRestCatalog = IcebergRestCatalog;
	exports.getCurrentSchema = getCurrentSchema;
	exports.isDecimalType = isDecimalType;
	exports.isFixedType = isFixedType;
	exports.parseDecimalType = parseDecimalType;
	exports.parseFixedType = parseFixedType;
	exports.typesEqual = typesEqual;
}));
//#endregion
//#region ../../node_modules/@supabase/storage-js/dist/index.cjs
var require_dist$2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	let iceberg_js = require_dist$3();
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o$1) {
			return typeof o$1;
		} : function(o$1) {
			return o$1 && "function" == typeof Symbol && o$1.constructor === Symbol && o$1 !== Symbol.prototype ? "symbol" : typeof o$1;
		}, _typeof(o);
	}
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r$1) {
				return Object.getOwnPropertyDescriptor(e, r$1).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread2(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r$1) {
				_defineProperty(e, r$1, t[r$1]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r$1) {
				Object.defineProperty(e, r$1, Object.getOwnPropertyDescriptor(t, r$1));
			});
		}
		return e;
	}
	/**
	* Base error class for all Storage errors
	* Supports both 'storage' and 'vectors' namespaces
	*/
	var StorageError = class extends Error {
		constructor(message, namespace = "storage", status, statusCode) {
			super(message);
			this.__isStorageError = true;
			this.namespace = namespace;
			this.name = namespace === "vectors" ? "StorageVectorsError" : "StorageError";
			this.status = status;
			this.statusCode = statusCode;
		}
		toJSON() {
			return {
				name: this.name,
				message: this.message,
				status: this.status,
				statusCode: this.statusCode
			};
		}
	};
	/**
	* Type guard to check if an error is a StorageError
	* @param error - The error to check
	* @returns True if the error is a StorageError
	*/
	function isStorageError(error) {
		return typeof error === "object" && error !== null && "__isStorageError" in error;
	}
	/**
	* API error returned from Storage service
	* Includes HTTP status code and service-specific error code
	*/
	var StorageApiError = class extends StorageError {
		constructor(message, status, statusCode, namespace = "storage") {
			super(message, namespace, status, statusCode);
			this.name = namespace === "vectors" ? "StorageVectorsApiError" : "StorageApiError";
			this.status = status;
			this.statusCode = statusCode;
		}
		toJSON() {
			return _objectSpread2({}, super.toJSON());
		}
	};
	/**
	* Unknown error that doesn't match expected error patterns
	* Wraps the original error for debugging
	*/
	var StorageUnknownError = class extends StorageError {
		constructor(message, originalError, namespace = "storage") {
			super(message, namespace);
			this.name = namespace === "vectors" ? "StorageVectorsUnknownError" : "StorageUnknownError";
			this.originalError = originalError;
		}
	};
	/**
	* @deprecated Use StorageError with namespace='vectors' instead
	* Alias for backward compatibility with existing vector storage code
	*/
	var StorageVectorsError = class extends StorageError {
		constructor(message) {
			super(message, "vectors");
		}
	};
	/**
	* Type guard to check if an error is a StorageVectorsError
	* @param error - The error to check
	* @returns True if the error is a StorageVectorsError
	*/
	function isStorageVectorsError(error) {
		return isStorageError(error) && error["namespace"] === "vectors";
	}
	/**
	* @deprecated Use StorageApiError with namespace='vectors' instead
	* Alias for backward compatibility with existing vector storage code
	*/
	var StorageVectorsApiError = class extends StorageApiError {
		constructor(message, status, statusCode) {
			super(message, status, statusCode, "vectors");
		}
	};
	/**
	* @deprecated Use StorageUnknownError with namespace='vectors' instead
	* Alias for backward compatibility with existing vector storage code
	*/
	var StorageVectorsUnknownError = class extends StorageUnknownError {
		constructor(message, originalError) {
			super(message, originalError, "vectors");
		}
	};
	/**
	* Error codes specific to S3 Vectors API
	* Maps AWS service errors to application-friendly error codes
	*/
	let StorageVectorsErrorCode = /* @__PURE__ */ function(StorageVectorsErrorCode$1) {
		/** Internal server fault (HTTP 500) */
		StorageVectorsErrorCode$1["InternalError"] = "InternalError";
		/** Resource already exists / conflict (HTTP 409) */
		StorageVectorsErrorCode$1["S3VectorConflictException"] = "S3VectorConflictException";
		/** Resource not found (HTTP 404) */
		StorageVectorsErrorCode$1["S3VectorNotFoundException"] = "S3VectorNotFoundException";
		/** Delete bucket while not empty (HTTP 400) */
		StorageVectorsErrorCode$1["S3VectorBucketNotEmpty"] = "S3VectorBucketNotEmpty";
		/** Exceeds bucket quota/limit (HTTP 400) */
		StorageVectorsErrorCode$1["S3VectorMaxBucketsExceeded"] = "S3VectorMaxBucketsExceeded";
		/** Exceeds index quota/limit (HTTP 400) */
		StorageVectorsErrorCode$1["S3VectorMaxIndexesExceeded"] = "S3VectorMaxIndexesExceeded";
		return StorageVectorsErrorCode$1;
	}({});
	/**
	* Sets a header with case-insensitive deduplication.
	* Removes any existing headers whose name matches (case-insensitive),
	* then sets the value under the lowercase key. Does not mutate the input object.
	*
	* @param headers - Existing headers object
	* @param name - Header name to set (stored as lowercase)
	* @param value - Header value
	* @returns New headers object with the header set
	*/
	function setHeader(headers, name, value) {
		const result = _objectSpread2({}, headers);
		const nameLower = name.toLowerCase();
		for (const key of Object.keys(result)) if (key.toLowerCase() === nameLower) delete result[key];
		result[nameLower] = value;
		return result;
	}
	/**
	* Normalizes all header keys to lowercase with case-insensitive deduplication.
	* When duplicate keys exist (differing only in case), the last value wins.
	* Does not mutate the input object.
	*
	* @param headers - Headers object to normalize
	* @returns New headers object with all keys lowercased
	*/
	function normalizeHeaders(headers) {
		const result = {};
		for (const [key, value] of Object.entries(headers)) result[key.toLowerCase()] = value;
		return result;
	}
	/**
	* Resolves the fetch implementation to use
	* Uses custom fetch if provided, otherwise uses native fetch
	*
	* @param customFetch - Optional custom fetch implementation
	* @returns Resolved fetch function
	*/
	const resolveFetch = (customFetch) => {
		if (customFetch) return (...args) => customFetch(...args);
		return (...args) => fetch(...args);
	};
	/**
	* Determine if input is a plain object
	* An object is plain if it's created by either {}, new Object(), or Object.create(null)
	*
	* @param value - Value to check
	* @returns True if value is a plain object
	* @source https://github.com/sindresorhus/is-plain-obj
	*/
	const isPlainObject = (value) => {
		if (typeof value !== "object" || value === null) return false;
		const prototype = Object.getPrototypeOf(value);
		return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
	};
	/**
	* Recursively converts object keys from snake_case to camelCase
	* Used for normalizing API responses
	*
	* @param item - Object to convert
	* @returns Converted object with camelCase keys
	*/
	const recursiveToCamel = (item) => {
		if (Array.isArray(item)) return item.map((el) => recursiveToCamel(el));
		else if (typeof item === "function" || item !== Object(item)) return item;
		const result = {};
		Object.entries(item).forEach(([key, value]) => {
			const newKey = key.replace(/([-_][a-z])/gi, (c) => c.toUpperCase().replace(/[-_]/g, ""));
			result[newKey] = recursiveToCamel(value);
		});
		return result;
	};
	/**
	* Validates if a given bucket name is valid according to Supabase Storage API rules
	* Mirrors backend validation from: storage/src/storage/limits.ts:isValidBucketName()
	*
	* Rules:
	* - Length: 1-100 characters
	* - Allowed characters: alphanumeric (a-z, A-Z, 0-9), underscore (_), and safe special characters
	* - Safe special characters: ! - . * ' ( ) space & $ @ = ; : + , ?
	* - Forbidden: path separators (/, \), path traversal (..), leading/trailing whitespace
	*
	* AWS S3 Reference: https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html
	*
	* @param bucketName - The bucket name to validate
	* @returns true if valid, false otherwise
	*/
	const isValidBucketName = (bucketName) => {
		if (!bucketName || typeof bucketName !== "string") return false;
		if (bucketName.length === 0 || bucketName.length > 100) return false;
		if (bucketName.trim() !== bucketName) return false;
		if (bucketName.includes("/") || bucketName.includes("\\")) return false;
		return /^[\w!.\*'() &$@=;:+,?-]+$/.test(bucketName);
	};
	/**
	* Extracts error message from various error response formats
	* @param err - Error object from API
	* @returns Human-readable error message
	*/
	const _getErrorMessage = (err) => {
		if (typeof err === "object" && err !== null) {
			const e = err;
			if (typeof e.msg === "string") return e.msg;
			if (typeof e.message === "string") return e.message;
			if (typeof e.error_description === "string") return e.error_description;
			if (typeof e.error === "string") return e.error;
			if (typeof e.error === "object" && e.error !== null) {
				const nested = e.error;
				if (typeof nested.message === "string") return nested.message;
			}
		}
		return JSON.stringify(err);
	};
	/**
	* Handles fetch errors and converts them to Storage error types
	* @param error - The error caught from fetch
	* @param reject - Promise rejection function
	* @param options - Fetch options that may affect error handling
	* @param namespace - Error namespace ('storage' or 'vectors')
	*/
	const handleError = async (error, reject, options, namespace) => {
		if (error !== null && typeof error === "object" && "json" in error && typeof error.json === "function") {
			const responseError = error;
			let status = parseInt(String(responseError.status), 10);
			if (!Number.isFinite(status)) status = 500;
			responseError.json().then((err) => {
				const statusCode = (err === null || err === void 0 ? void 0 : err.statusCode) || (err === null || err === void 0 ? void 0 : err.code) || status + "";
				reject(new StorageApiError(_getErrorMessage(err), status, statusCode, namespace));
			}).catch(() => {
				const statusCode = status + "";
				reject(new StorageApiError(responseError.statusText || `HTTP ${status} error`, status, statusCode, namespace));
			});
		} else reject(new StorageUnknownError(_getErrorMessage(error), error, namespace));
	};
	/**
	* Builds request parameters for fetch calls
	* @param method - HTTP method
	* @param options - Custom fetch options
	* @param parameters - Additional fetch parameters like AbortSignal
	* @param body - Request body (will be JSON stringified if plain object)
	* @returns Complete fetch request parameters
	*/
	const _getRequestParams = (method, options, parameters, body) => {
		const params = {
			method,
			headers: (options === null || options === void 0 ? void 0 : options.headers) || {}
		};
		if (method === "GET" || method === "HEAD" || !body) return _objectSpread2(_objectSpread2({}, params), parameters);
		if (isPlainObject(body)) {
			var _contentType;
			const headers = (options === null || options === void 0 ? void 0 : options.headers) || {};
			let contentType;
			for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === "content-type") contentType = value;
			params.headers = setHeader(headers, "Content-Type", (_contentType = contentType) !== null && _contentType !== void 0 ? _contentType : "application/json");
			params.body = JSON.stringify(body);
		} else params.body = body;
		if (options === null || options === void 0 ? void 0 : options.duplex) params.duplex = options.duplex;
		return _objectSpread2(_objectSpread2({}, params), parameters);
	};
	/**
	* Internal request handler that wraps fetch with error handling
	* @param fetcher - Fetch function to use
	* @param method - HTTP method
	* @param url - Request URL
	* @param options - Custom fetch options
	* @param parameters - Additional fetch parameters
	* @param body - Request body
	* @param namespace - Error namespace ('storage' or 'vectors')
	* @returns Promise with parsed response or error
	*/
	async function _handleRequest(fetcher, method, url, options, parameters, body, namespace) {
		return new Promise((resolve, reject) => {
			fetcher(url, _getRequestParams(method, options, parameters, body)).then((result) => {
				if (!result.ok) throw result;
				if (options === null || options === void 0 ? void 0 : options.noResolveJson) return result;
				if (namespace === "vectors") {
					const contentType = result.headers.get("content-type");
					if (result.headers.get("content-length") === "0" || result.status === 204) return {};
					if (!contentType || !contentType.includes("application/json")) return {};
				}
				return result.json();
			}).then((data) => resolve(data)).catch((error) => handleError(error, reject, options, namespace));
		});
	}
	/**
	* Creates a fetch API with the specified namespace
	* @param namespace - Error namespace ('storage' or 'vectors')
	* @returns Object with HTTP method functions
	*/
	function createFetchApi(namespace = "storage") {
		return {
			get: async (fetcher, url, options, parameters) => {
				return _handleRequest(fetcher, "GET", url, options, parameters, void 0, namespace);
			},
			post: async (fetcher, url, body, options, parameters) => {
				return _handleRequest(fetcher, "POST", url, options, parameters, body, namespace);
			},
			put: async (fetcher, url, body, options, parameters) => {
				return _handleRequest(fetcher, "PUT", url, options, parameters, body, namespace);
			},
			head: async (fetcher, url, options, parameters) => {
				return _handleRequest(fetcher, "HEAD", url, _objectSpread2(_objectSpread2({}, options), {}, { noResolveJson: true }), parameters, void 0, namespace);
			},
			remove: async (fetcher, url, body, options, parameters) => {
				return _handleRequest(fetcher, "DELETE", url, options, parameters, body, namespace);
			}
		};
	}
	const { get, post, put, head, remove } = createFetchApi("storage");
	const vectorsApi = createFetchApi("vectors");
	/**
	* @ignore
	* Base API client class for all Storage API classes
	* Provides common infrastructure for error handling and configuration
	*
	* @typeParam TError - The error type (StorageError or subclass)
	*/
	var BaseApiClient = class {
		/**
		* Creates a new BaseApiClient instance
		* @param url - Base URL for API requests
		* @param headers - Default headers for API requests
		* @param fetch - Optional custom fetch implementation
		* @param namespace - Error namespace ('storage' or 'vectors')
		*/
		constructor(url, headers = {}, fetch$1, namespace = "storage") {
			this.shouldThrowOnError = false;
			this.url = url;
			this.headers = normalizeHeaders(headers);
			this.fetch = resolveFetch(fetch$1);
			this.namespace = namespace;
		}
		/**
		* Enable throwing errors instead of returning them.
		* When enabled, errors are thrown instead of returned in { data, error } format.
		*
		* @returns this - For method chaining
		*/
		throwOnError() {
			this.shouldThrowOnError = true;
			return this;
		}
		/**
		* Set an HTTP header for the request.
		* Creates a shallow copy of headers to avoid mutating shared state.
		*
		* @param name - Header name
		* @param value - Header value
		* @returns this - For method chaining
		*/
		setHeader(name, value) {
			this.headers = setHeader(this.headers, name, value);
			return this;
		}
		/**
		* Handles API operation with standardized error handling
		* Eliminates repetitive try-catch blocks across all API methods
		*
		* This wrapper:
		* 1. Executes the operation
		* 2. Returns { data, error: null } on success
		* 3. Returns { data: null, error } on failure (if shouldThrowOnError is false)
		* 4. Throws error on failure (if shouldThrowOnError is true)
		*
		* @typeParam T - The expected data type from the operation
		* @param operation - Async function that performs the API call
		* @returns Promise with { data, error } tuple
		*
		* @example Handling an operation
		* ```typescript
		* async listBuckets() {
		*   return this.handleOperation(async () => {
		*     return await get(this.fetch, `${this.url}/bucket`, {
		*       headers: this.headers,
		*     })
		*   })
		* }
		* ```
		*/
		async handleOperation(operation) {
			var _this = this;
			try {
				return {
					data: await operation(),
					error: null
				};
			} catch (error) {
				if (_this.shouldThrowOnError) throw error;
				if (isStorageError(error)) return {
					data: null,
					error
				};
				throw error;
			}
		}
	};
	var StreamDownloadBuilder = class {
		constructor(downloadFn, shouldThrowOnError) {
			this.downloadFn = downloadFn;
			this.shouldThrowOnError = shouldThrowOnError;
		}
		then(onfulfilled, onrejected) {
			return this.execute().then(onfulfilled, onrejected);
		}
		async execute() {
			var _this = this;
			try {
				return {
					data: (await _this.downloadFn()).body,
					error: null
				};
			} catch (error) {
				if (_this.shouldThrowOnError) throw error;
				if (isStorageError(error)) return {
					data: null,
					error
				};
				throw error;
			}
		}
	};
	let _Symbol$toStringTag;
	_Symbol$toStringTag = Symbol.toStringTag;
	var BlobDownloadBuilder = class {
		constructor(downloadFn, shouldThrowOnError) {
			this.downloadFn = downloadFn;
			this.shouldThrowOnError = shouldThrowOnError;
			this[_Symbol$toStringTag] = "BlobDownloadBuilder";
			this.promise = null;
		}
		asStream() {
			return new StreamDownloadBuilder(this.downloadFn, this.shouldThrowOnError);
		}
		then(onfulfilled, onrejected) {
			return this.getPromise().then(onfulfilled, onrejected);
		}
		catch(onrejected) {
			return this.getPromise().catch(onrejected);
		}
		finally(onfinally) {
			return this.getPromise().finally(onfinally);
		}
		getPromise() {
			if (!this.promise) this.promise = this.execute();
			return this.promise;
		}
		async execute() {
			var _this = this;
			try {
				return {
					data: await (await _this.downloadFn()).blob(),
					error: null
				};
			} catch (error) {
				if (_this.shouldThrowOnError) throw error;
				if (isStorageError(error)) return {
					data: null,
					error
				};
				throw error;
			}
		}
	};
	const DEFAULT_SEARCH_OPTIONS = {
		limit: 100,
		offset: 0,
		sortBy: {
			column: "name",
			order: "asc"
		}
	};
	const DEFAULT_FILE_OPTIONS = {
		cacheControl: "3600",
		contentType: "text/plain;charset=UTF-8",
		upsert: false
	};
	var StorageFileApi = class extends BaseApiClient {
		constructor(url, headers = {}, bucketId, fetch$1) {
			super(url, headers, fetch$1, "storage");
			this.bucketId = bucketId;
		}
		/**
		* Uploads a file to an existing bucket or replaces an existing file at the specified path with a new one.
		*
		* @param method HTTP method.
		* @param path The relative file path. Should be of the format `folder/subfolder/filename.png`. The bucket must already exist before attempting to upload.
		* @param fileBody The body of the file to be stored in the bucket.
		*/
		async uploadOrUpdate(method, path, fileBody, fileOptions) {
			var _this = this;
			return _this.handleOperation(async () => {
				let body;
				const options = _objectSpread2(_objectSpread2({}, DEFAULT_FILE_OPTIONS), fileOptions);
				let headers = _objectSpread2(_objectSpread2({}, _this.headers), method === "POST" && { "x-upsert": String(options.upsert) });
				const metadata = options.metadata;
				if (typeof Blob !== "undefined" && fileBody instanceof Blob) {
					body = new FormData();
					body.append("cacheControl", options.cacheControl);
					if (metadata) body.append("metadata", _this.encodeMetadata(metadata));
					body.append("", fileBody);
				} else if (typeof FormData !== "undefined" && fileBody instanceof FormData) {
					body = fileBody;
					if (!body.has("cacheControl")) body.append("cacheControl", options.cacheControl);
					if (metadata && !body.has("metadata")) body.append("metadata", _this.encodeMetadata(metadata));
				} else {
					body = fileBody;
					headers["cache-control"] = `max-age=${options.cacheControl}`;
					headers["content-type"] = options.contentType;
					if (metadata) headers["x-metadata"] = _this.toBase64(_this.encodeMetadata(metadata));
					if ((typeof ReadableStream !== "undefined" && body instanceof ReadableStream || body && typeof body === "object" && "pipe" in body && typeof body.pipe === "function") && !options.duplex) options.duplex = "half";
				}
				if (fileOptions === null || fileOptions === void 0 ? void 0 : fileOptions.headers) for (const [key, value] of Object.entries(fileOptions.headers)) headers = setHeader(headers, key, value);
				const cleanPath = _this._removeEmptyFolders(path);
				const _path = _this._getFinalPath(cleanPath);
				const data = await (method == "PUT" ? put : post)(_this.fetch, `${_this.url}/object/${_path}`, body, _objectSpread2({ headers }, (options === null || options === void 0 ? void 0 : options.duplex) ? { duplex: options.duplex } : {}));
				return {
					path: cleanPath,
					id: data.Id,
					fullPath: data.Key
				};
			});
		}
		/**
		* Uploads a file to an existing bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The file path, including the file name. Should be of the format `folder/subfolder/filename.png`. The bucket must already exist before attempting to upload.
		* @param fileBody The body of the file to be stored in the bucket.
		* @param fileOptions Optional file upload options including cacheControl, contentType, upsert, and metadata.
		* @returns Promise with response containing file path, id, and fullPath or error
		*
		* @example Upload file
		* ```js
		* const avatarFile = event.target.files[0]
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .upload('public/avatar1.png', avatarFile, {
		*     cacheControl: '3600',
		*     upsert: false
		*   })
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "path": "public/avatar1.png",
		*     "fullPath": "avatars/public/avatar1.png"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @example Upload file using `ArrayBuffer` from base64 file data
		* ```js
		* import { decode } from 'base64-arraybuffer'
		*
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .upload('public/avatar1.png', decode('base64FileData'), {
		*     contentType: 'image/png'
		*   })
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: only `insert` when you are uploading new files and `select`, `insert` and `update` when you are upserting files
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		* - For React Native, using either `Blob`, `File` or `FormData` does not work as intended. Upload file using `ArrayBuffer` from base64 file data instead, see example below.
		*/
		async upload(path, fileBody, fileOptions) {
			return this.uploadOrUpdate("POST", path, fileBody, fileOptions);
		}
		/**
		* Upload a file with a token generated from `createSignedUploadUrl`.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The file path, including the file name. Should be of the format `folder/subfolder/filename.png`. The bucket must already exist before attempting to upload.
		* @param token The token generated from `createSignedUploadUrl`
		* @param fileBody The body of the file to be stored in the bucket.
		* @param fileOptions HTTP headers (cacheControl, contentType, etc.).
		* **Note:** The `upsert` option has no effect here. To enable upsert behavior,
		* pass `{ upsert: true }` when calling `createSignedUploadUrl()` instead.
		* @returns Promise with response containing file path and fullPath or error
		*
		* @example Upload to a signed URL
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .uploadToSignedUrl('folder/cat.jpg', 'token-from-createSignedUploadUrl', file)
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "path": "folder/cat.jpg",
		*     "fullPath": "avatars/folder/cat.jpg"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async uploadToSignedUrl(path, token, fileBody, fileOptions) {
			var _this3 = this;
			const cleanPath = _this3._removeEmptyFolders(path);
			const _path = _this3._getFinalPath(cleanPath);
			const url = new URL(_this3.url + `/object/upload/sign/${_path}`);
			url.searchParams.set("token", token);
			return _this3.handleOperation(async () => {
				let body;
				const options = _objectSpread2(_objectSpread2({}, DEFAULT_FILE_OPTIONS), fileOptions);
				let headers = _objectSpread2(_objectSpread2({}, _this3.headers), { "x-upsert": String(options.upsert) });
				const metadata = options.metadata;
				if (typeof Blob !== "undefined" && fileBody instanceof Blob) {
					body = new FormData();
					body.append("cacheControl", options.cacheControl);
					if (metadata) body.append("metadata", _this3.encodeMetadata(metadata));
					body.append("", fileBody);
				} else if (typeof FormData !== "undefined" && fileBody instanceof FormData) {
					body = fileBody;
					if (!body.has("cacheControl")) body.append("cacheControl", options.cacheControl);
					if (metadata && !body.has("metadata")) body.append("metadata", _this3.encodeMetadata(metadata));
				} else {
					body = fileBody;
					headers["cache-control"] = `max-age=${options.cacheControl}`;
					headers["content-type"] = options.contentType;
					if (metadata) headers["x-metadata"] = _this3.toBase64(_this3.encodeMetadata(metadata));
					if ((typeof ReadableStream !== "undefined" && body instanceof ReadableStream || body && typeof body === "object" && "pipe" in body && typeof body.pipe === "function") && !options.duplex) options.duplex = "half";
				}
				if (fileOptions === null || fileOptions === void 0 ? void 0 : fileOptions.headers) for (const [key, value] of Object.entries(fileOptions.headers)) headers = setHeader(headers, key, value);
				return {
					path: cleanPath,
					fullPath: (await put(_this3.fetch, url.toString(), body, _objectSpread2({ headers }, (options === null || options === void 0 ? void 0 : options.duplex) ? { duplex: options.duplex } : {}))).Key
				};
			});
		}
		/**
		* Creates a signed upload URL.
		* Signed upload URLs can be used to upload files to the bucket without further authentication.
		* They are valid for 2 hours.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The file path, including the current file name. For example `folder/image.png`.
		* @param options.upsert If set to true, allows the file to be overwritten if it already exists.
		* @returns Promise with response containing signed upload URL, token, and path or error
		*
		* @example Create Signed Upload URL
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .createSignedUploadUrl('folder/cat.jpg')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "signedUrl": "https://example.supabase.co/storage/v1/object/upload/sign/avatars/folder/cat.jpg?token=<TOKEN>",
		*     "path": "folder/cat.jpg",
		*     "token": "<TOKEN>"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `insert`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async createSignedUploadUrl(path, options) {
			var _this4 = this;
			return _this4.handleOperation(async () => {
				let _path = _this4._getFinalPath(path);
				const headers = _objectSpread2({}, _this4.headers);
				if (options === null || options === void 0 ? void 0 : options.upsert) headers["x-upsert"] = "true";
				const data = await post(_this4.fetch, `${_this4.url}/object/upload/sign/${_path}`, {}, { headers });
				const url = new URL(_this4.url + data.url);
				const token = url.searchParams.get("token");
				if (!token) throw new StorageError("No token returned by API");
				return {
					signedUrl: url.toString(),
					path,
					token
				};
			});
		}
		/**
		* Replaces an existing file at the specified path with a new one.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The relative file path. Should be of the format `folder/subfolder/filename.png`. The bucket must already exist before attempting to update.
		* @param fileBody The body of the file to be stored in the bucket.
		* @param fileOptions Optional file upload options including cacheControl, contentType, and metadata.
		* **Note:** The `upsert` option has no effect here. `update()` always replaces the
		* file at the given path, so the `x-upsert` header is not sent. To control upsert
		* behavior, use `upload()` instead.
		* @returns Promise with response containing file path, id, and fullPath or error
		*
		* @example Update file
		* ```js
		* const avatarFile = event.target.files[0]
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .update('public/avatar1.png', avatarFile, {
		*     cacheControl: '3600'
		*   })
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "path": "public/avatar1.png",
		*     "fullPath": "avatars/public/avatar1.png"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @example Update file using `ArrayBuffer` from base64 file data
		* ```js
		* import {decode} from 'base64-arraybuffer'
		*
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .update('public/avatar1.png', decode('base64FileData'), {
		*     contentType: 'image/png'
		*   })
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `update` and `select`
		* - `update()` always replaces the file at the given path regardless of the `upsert` option.
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		* - For React Native, using either `Blob`, `File` or `FormData` does not work as intended. Update file using `ArrayBuffer` from base64 file data instead, see example below.
		*/
		async update(path, fileBody, fileOptions) {
			return this.uploadOrUpdate("PUT", path, fileBody, fileOptions);
		}
		/**
		* Moves an existing file to a new path in the same bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param fromPath The original file path, including the current file name. For example `folder/image.png`.
		* @param toPath The new file path, including the new file name. For example `folder/image-new.png`.
		* @param options The destination options.
		* @returns Promise with response containing success message or error
		*
		* @example Move file
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .move('public/avatar1.png', 'private/avatar2.png')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "message": "Successfully moved"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `update` and `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async move(fromPath, toPath, options) {
			var _this6 = this;
			return _this6.handleOperation(async () => {
				return await post(_this6.fetch, `${_this6.url}/object/move`, {
					bucketId: _this6.bucketId,
					sourceKey: fromPath,
					destinationKey: toPath,
					destinationBucket: options === null || options === void 0 ? void 0 : options.destinationBucket
				}, { headers: _this6.headers });
			});
		}
		/**
		* Copies an existing file to a new path in the same bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param fromPath The original file path, including the current file name. For example `folder/image.png`.
		* @param toPath The new file path, including the new file name. For example `folder/image-copy.png`.
		* @param options The destination options.
		* @returns Promise with response containing copied file path or error
		*
		* @example Copy file
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .copy('public/avatar1.png', 'private/avatar2.png')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "path": "avatars/private/avatar2.png"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `insert` and `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async copy(fromPath, toPath, options) {
			var _this7 = this;
			return _this7.handleOperation(async () => {
				return { path: (await post(_this7.fetch, `${_this7.url}/object/copy`, {
					bucketId: _this7.bucketId,
					sourceKey: fromPath,
					destinationKey: toPath,
					destinationBucket: options === null || options === void 0 ? void 0 : options.destinationBucket
				}, { headers: _this7.headers })).Key };
			});
		}
		/**
		* Creates a signed URL. Use a signed URL to share a file for a fixed amount of time.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The file path, including the current file name. For example `folder/image.png`.
		* @param expiresIn The number of seconds until the signed URL expires. For example, `60` for a URL which is valid for one minute.
		* @param options.download triggers the file as a download if set to true. Set this parameter as the name of the file if you want to trigger the download with a different filename.
		* @param options.transform Transform the asset before serving it to the client.
		* @param options.cacheNonce Append a cache nonce parameter to the URL to invalidate the cache.
		* @returns Promise with response containing signed URL or error
		*
		* @example Create Signed URL
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .createSignedUrl('folder/avatar1.png', 60)
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "signedUrl": "https://example.supabase.co/storage/v1/object/sign/avatars/folder/avatar1.png?token=<TOKEN>"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @example Create a signed URL for an asset with transformations
		* ```js
		* const { data } = await supabase
		*   .storage
		*   .from('avatars')
		*   .createSignedUrl('folder/avatar1.png', 60, {
		*     transform: {
		*       width: 100,
		*       height: 100,
		*     }
		*   })
		* ```
		*
		* @example Create a signed URL which triggers the download of the asset
		* ```js
		* const { data } = await supabase
		*   .storage
		*   .from('avatars')
		*   .createSignedUrl('folder/avatar1.png', 60, {
		*     download: true,
		*   })
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async createSignedUrl(path, expiresIn, options) {
			var _this8 = this;
			return _this8.handleOperation(async () => {
				let _path = _this8._getFinalPath(path);
				const hasTransform = typeof (options === null || options === void 0 ? void 0 : options.transform) === "object" && options.transform !== null && Object.keys(options.transform).length > 0;
				let data = await post(_this8.fetch, `${_this8.url}/object/sign/${_path}`, _objectSpread2({ expiresIn }, hasTransform ? { transform: options.transform } : {}), { headers: _this8.headers });
				const query = new URLSearchParams();
				if (options === null || options === void 0 ? void 0 : options.download) query.set("download", options.download === true ? "" : options.download);
				if ((options === null || options === void 0 ? void 0 : options.cacheNonce) != null) query.set("cacheNonce", String(options.cacheNonce));
				const queryString = query.toString();
				return { signedUrl: encodeURI(`${_this8.url}${data.signedURL}${queryString ? `&${queryString}` : ""}`) };
			});
		}
		/**
		* Creates multiple signed URLs. Use a signed URL to share a file for a fixed amount of time.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param paths The file paths to be downloaded, including the current file names. For example `['folder/image.png', 'folder2/image2.png']`.
		* @param expiresIn The number of seconds until the signed URLs expire. For example, `60` for URLs which are valid for one minute.
		* @param options.download triggers the file as a download if set to true. Set this parameter as the name of the file if you want to trigger the download with a different filename.
		* @param options.cacheNonce Append a cache nonce parameter to the URL to invalidate the cache.
		* @returns Promise with response containing array of objects with signedUrl, path, and error or error
		*
		* @example Create Signed URLs
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .createSignedUrls(['folder/avatar1.png', 'folder/avatar2.png'], 60)
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": [
		*     {
		*       "error": null,
		*       "path": "folder/avatar1.png",
		*       "signedURL": "/object/sign/avatars/folder/avatar1.png?token=<TOKEN>",
		*       "signedUrl": "https://example.supabase.co/storage/v1/object/sign/avatars/folder/avatar1.png?token=<TOKEN>"
		*     },
		*     {
		*       "error": null,
		*       "path": "folder/avatar2.png",
		*       "signedURL": "/object/sign/avatars/folder/avatar2.png?token=<TOKEN>",
		*       "signedUrl": "https://example.supabase.co/storage/v1/object/sign/avatars/folder/avatar2.png?token=<TOKEN>"
		*     }
		*   ],
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async createSignedUrls(paths, expiresIn, options) {
			var _this9 = this;
			return _this9.handleOperation(async () => {
				const data = await post(_this9.fetch, `${_this9.url}/object/sign/${_this9.bucketId}`, {
					expiresIn,
					paths
				}, { headers: _this9.headers });
				const query = new URLSearchParams();
				if (options === null || options === void 0 ? void 0 : options.download) query.set("download", options.download === true ? "" : options.download);
				if ((options === null || options === void 0 ? void 0 : options.cacheNonce) != null) query.set("cacheNonce", String(options.cacheNonce));
				const queryString = query.toString();
				return data.map((datum) => _objectSpread2(_objectSpread2({}, datum), {}, { signedUrl: datum.signedURL ? encodeURI(`${_this9.url}${datum.signedURL}${queryString ? `&${queryString}` : ""}`) : null }));
			});
		}
		/**
		* Downloads a file from a private bucket. For public buckets, make a request to the URL returned from `getPublicUrl` instead.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The full path and file name of the file to be downloaded. For example `folder/image.png`.
		* @param options.transform Transform the asset before serving it to the client.
		* @param options.cacheNonce Append a cache nonce parameter to the URL to invalidate the cache.
		* @param parameters Additional fetch parameters like signal for cancellation. Supports standard fetch options including cache control.
		* @returns BlobDownloadBuilder instance for downloading the file
		*
		* @example Download file
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .download('folder/avatar1.png')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": <BLOB>,
		*   "error": null
		* }
		* ```
		*
		* @example Download file with transformations
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .download('folder/avatar1.png', {
		*     transform: {
		*       width: 100,
		*       height: 100,
		*       quality: 80
		*     }
		*   })
		* ```
		*
		* @example Download with cache control (useful in Edge Functions)
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .download('folder/avatar1.png', {}, { cache: 'no-store' })
		* ```
		*
		* @example Download with abort signal
		* ```js
		* const controller = new AbortController()
		* setTimeout(() => controller.abort(), 5000)
		*
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .download('folder/avatar1.png', {}, { signal: controller.signal })
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		download(path, options, parameters) {
			const renderPath = typeof (options === null || options === void 0 ? void 0 : options.transform) === "object" && options.transform !== null && Object.keys(options.transform).length > 0 ? "render/image/authenticated" : "object";
			const query = new URLSearchParams();
			if (options === null || options === void 0 ? void 0 : options.transform) this.applyTransformOptsToQuery(query, options.transform);
			if ((options === null || options === void 0 ? void 0 : options.cacheNonce) != null) query.set("cacheNonce", String(options.cacheNonce));
			const queryString = query.toString();
			const _path = this._getFinalPath(path);
			const downloadFn = () => get(this.fetch, `${this.url}/${renderPath}/${_path}${queryString ? `?${queryString}` : ""}`, {
				headers: this.headers,
				noResolveJson: true
			}, parameters);
			return new BlobDownloadBuilder(downloadFn, this.shouldThrowOnError);
		}
		/**
		* Retrieves the details of an existing file.
		*
		* Returns detailed file metadata including size, content type, and timestamps.
		* Note: The API returns `last_modified` field, not `updated_at`.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The file path, including the file name. For example `folder/image.png`.
		* @returns Promise with response containing file metadata or error
		*
		* @example Get file info
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .info('folder/avatar1.png')
		*
		* if (data) {
		*   console.log('Last modified:', data.lastModified)
		*   console.log('Size:', data.size)
		* }
		* ```
		*/
		async info(path) {
			var _this10 = this;
			const _path = _this10._getFinalPath(path);
			return _this10.handleOperation(async () => {
				return recursiveToCamel(await get(_this10.fetch, `${_this10.url}/object/info/${_path}`, { headers: _this10.headers }));
			});
		}
		/**
		* Checks the existence of a file.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The file path, including the file name. For example `folder/image.png`.
		* @returns Promise with response containing boolean indicating file existence or error
		*
		* @example Check file existence
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .exists('folder/avatar1.png')
		* ```
		*/
		async exists(path) {
			var _this11 = this;
			const _path = _this11._getFinalPath(path);
			try {
				await head(_this11.fetch, `${_this11.url}/object/${_path}`, { headers: _this11.headers });
				return {
					data: true,
					error: null
				};
			} catch (error) {
				if (_this11.shouldThrowOnError) throw error;
				if (isStorageError(error)) {
					var _error$originalError;
					const status = error instanceof StorageApiError ? error.status : error instanceof StorageUnknownError ? (_error$originalError = error.originalError) === null || _error$originalError === void 0 ? void 0 : _error$originalError.status : void 0;
					if (status !== void 0 && [400, 404].includes(status)) return {
						data: false,
						error
					};
				}
				throw error;
			}
		}
		/**
		* A simple convenience function to get the URL for an asset in a public bucket. If you do not want to use this function, you can construct the public URL by concatenating the bucket URL with the path to the asset.
		* This function does not verify if the bucket is public. If a public URL is created for a bucket which is not public, you will not be able to download the asset.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The path and name of the file to generate the public URL for. For example `folder/image.png`.
		* @param options.download Triggers the file as a download if set to true. Set this parameter as the name of the file if you want to trigger the download with a different filename.
		* @param options.transform Transform the asset before serving it to the client.
		* @param options.cacheNonce Append a cache nonce parameter to the URL to invalidate the cache.
		* @returns Object with public URL
		*
		* @example Returns the URL for an asset in a public bucket
		* ```js
		* const { data } = supabase
		*   .storage
		*   .from('public-bucket')
		*   .getPublicUrl('folder/avatar1.png')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "publicUrl": "https://example.supabase.co/storage/v1/object/public/public-bucket/folder/avatar1.png"
		*   }
		* }
		* ```
		*
		* @example Returns the URL for an asset in a public bucket with transformations
		* ```js
		* const { data } = supabase
		*   .storage
		*   .from('public-bucket')
		*   .getPublicUrl('folder/avatar1.png', {
		*     transform: {
		*       width: 100,
		*       height: 100,
		*     }
		*   })
		* ```
		*
		* @example Returns the URL which triggers the download of an asset in a public bucket
		* ```js
		* const { data } = supabase
		*   .storage
		*   .from('public-bucket')
		*   .getPublicUrl('folder/avatar1.png', {
		*     download: true,
		*   })
		* ```
		*
		* @remarks
		* - The bucket needs to be set to public, either via [updateBucket()](/docs/reference/javascript/storage-updatebucket) or by going to Storage on [supabase.com/dashboard](https://supabase.com/dashboard), clicking the overflow menu on a bucket and choosing "Make public"
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		getPublicUrl(path, options) {
			const _path = this._getFinalPath(path);
			const query = new URLSearchParams();
			if (options === null || options === void 0 ? void 0 : options.download) query.set("download", options.download === true ? "" : options.download);
			if (options === null || options === void 0 ? void 0 : options.transform) this.applyTransformOptsToQuery(query, options.transform);
			if ((options === null || options === void 0 ? void 0 : options.cacheNonce) != null) query.set("cacheNonce", String(options.cacheNonce));
			const queryString = query.toString();
			const renderPath = typeof (options === null || options === void 0 ? void 0 : options.transform) === "object" && options.transform !== null && Object.keys(options.transform).length > 0 ? "render/image" : "object";
			return { data: { publicUrl: encodeURI(`${this.url}/${renderPath}/public/${_path}`) + (queryString ? `?${queryString}` : "") } };
		}
		/**
		* Deletes files within the same bucket
		*
		* Returns an array of FileObject entries for the deleted files. Note that deprecated
		* fields like `bucket_id` may or may not be present in the response - do not rely on them.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param paths An array of files to delete, including the path and file name. For example [`'folder/image.png'`].
		* @returns Promise with response containing array of deleted file objects or error
		*
		* @example Delete file
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .remove(['folder/avatar1.png'])
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": [],
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `delete` and `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async remove(paths) {
			var _this12 = this;
			return _this12.handleOperation(async () => {
				return await remove(_this12.fetch, `${_this12.url}/object/${_this12.bucketId}`, { prefixes: paths }, { headers: _this12.headers });
			});
		}
		/**
		* Get file metadata
		* @param id the file id to retrieve metadata
		*/
		/**
		* Update file metadata
		* @param id the file id to update metadata
		* @param meta the new file metadata
		*/
		/**
		* Lists all the files and folders within a path of the bucket.
		*
		* **Important:** For folder entries, fields like `id`, `updated_at`, `created_at`,
		* `last_accessed_at`, and `metadata` will be `null`. Only files have these fields populated.
		* Additionally, deprecated fields like `bucket_id`, `owner`, and `buckets` are NOT returned
		* by this method.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param path The folder path.
		* @param options Search options including limit (defaults to 100), offset, sortBy, and search
		* @param parameters Optional fetch parameters including signal for cancellation
		* @returns Promise with response containing array of files/folders or error
		*
		* @example List files in a bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .list('folder', {
		*     limit: 100,
		*     offset: 0,
		*     sortBy: { column: 'name', order: 'asc' },
		*   })
		*
		* // Handle files vs folders
		* data?.forEach(item => {
		*   if (item.id !== null) {
		*     // It's a file
		*     console.log('File:', item.name, 'Size:', item.metadata?.size)
		*   } else {
		*     // It's a folder
		*     console.log('Folder:', item.name)
		*   }
		* })
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": [
		*     {
		*       "name": "avatar1.png",
		*       "id": "e668cf7f-821b-4a2f-9dce-7dfa5dd1cfd2",
		*       "updated_at": "2024-05-22T23:06:05.580Z",
		*       "created_at": "2024-05-22T23:04:34.443Z",
		*       "last_accessed_at": "2024-05-22T23:04:34.443Z",
		*       "metadata": {
		*         "eTag": "\"c5e8c553235d9af30ef4f6e280790b92\"",
		*         "size": 32175,
		*         "mimetype": "image/png",
		*         "cacheControl": "max-age=3600",
		*         "lastModified": "2024-05-22T23:06:05.574Z",
		*         "contentLength": 32175,
		*         "httpStatusCode": 200
		*       }
		*     }
		*   ],
		*   "error": null
		* }
		* ```
		*
		* @example Search files in a bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .list('folder', {
		*     limit: 100,
		*     offset: 0,
		*     sortBy: { column: 'name', order: 'asc' },
		*     search: 'jon'
		*   })
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: none
		*   - `objects` table permissions: `select`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async list(path, options, parameters) {
			var _this13 = this;
			return _this13.handleOperation(async () => {
				const body = _objectSpread2(_objectSpread2(_objectSpread2({}, DEFAULT_SEARCH_OPTIONS), options), {}, { prefix: path || "" });
				return await post(_this13.fetch, `${_this13.url}/object/list/${_this13.bucketId}`, body, { headers: _this13.headers }, parameters);
			});
		}
		/**
		* Lists all the files and folders within a bucket using the V2 API with pagination support.
		*
		* **Important:** Folder entries in the `folders` array only contain `name` and optionally `key` —
		* they have no `id`, timestamps, or `metadata` fields. Full file metadata is only available
		* on entries in the `objects` array.
		*
		* @experimental this method signature might change in the future
		*
		* @category Storage
		* @subcategory File Buckets
		* @param options Search options including prefix, cursor for pagination, limit, with_delimiter
		* @param parameters Optional fetch parameters including signal for cancellation
		* @returns Promise with response containing folders/objects arrays with pagination info or error
		*
		* @example List files with pagination
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .from('avatars')
		*   .listV2({
		*     prefix: 'folder/',
		*     limit: 100,
		*   })
		*
		* // Handle pagination
		* if (data?.hasNext) {
		*   const nextPage = await supabase
		*     .storage
		*     .from('avatars')
		*     .listV2({
		*       prefix: 'folder/',
		*       cursor: data.nextCursor,
		*     })
		* }
		*
		* // Handle files vs folders
		* data?.objects.forEach(file => {
		*   if (file.id !== null) {
		*     console.log('File:', file.name, 'Size:', file.metadata?.size)
		*   }
		* })
		* data?.folders.forEach(folder => {
		*   console.log('Folder:', folder.name)
		* })
		* ```
		*/
		async listV2(options, parameters) {
			var _this14 = this;
			return _this14.handleOperation(async () => {
				const body = _objectSpread2({}, options);
				return await post(_this14.fetch, `${_this14.url}/object/list-v2/${_this14.bucketId}`, body, { headers: _this14.headers }, parameters);
			});
		}
		encodeMetadata(metadata) {
			return JSON.stringify(metadata);
		}
		toBase64(data) {
			if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
			return btoa(data);
		}
		_getFinalPath(path) {
			return `${this.bucketId}/${path.replace(/^\/+/, "")}`;
		}
		_removeEmptyFolders(path) {
			return path.replace(/^\/|\/$/g, "").replace(/\/+/g, "/");
		}
		/** Modifies the `query`, appending values the from `transform` */
		applyTransformOptsToQuery(query, transform) {
			if (transform.width) query.set("width", transform.width.toString());
			if (transform.height) query.set("height", transform.height.toString());
			if (transform.resize) query.set("resize", transform.resize);
			if (transform.format) query.set("format", transform.format);
			if (transform.quality) query.set("quality", transform.quality.toString());
			return query;
		}
	};
	const DEFAULT_HEADERS = { "X-Client-Info": `storage-js/2.105.4` };
	var StorageBucketApi = class extends BaseApiClient {
		constructor(url, headers = {}, fetch$1, opts) {
			const baseUrl = new URL(url);
			if (opts === null || opts === void 0 ? void 0 : opts.useNewHostname) {
				if (/supabase\.(co|in|red)$/.test(baseUrl.hostname) && !baseUrl.hostname.includes("storage.supabase.")) baseUrl.hostname = baseUrl.hostname.replace("supabase.", "storage.supabase.");
			}
			const finalUrl = baseUrl.href.replace(/\/$/, "");
			const finalHeaders = _objectSpread2(_objectSpread2({}, DEFAULT_HEADERS), headers);
			super(finalUrl, finalHeaders, fetch$1, "storage");
		}
		/**
		* Retrieves the details of all Storage buckets within an existing project.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param options Query parameters for listing buckets
		* @param options.limit Maximum number of buckets to return
		* @param options.offset Number of buckets to skip
		* @param options.sortColumn Column to sort by ('id', 'name', 'created_at', 'updated_at')
		* @param options.sortOrder Sort order ('asc' or 'desc')
		* @param options.search Search term to filter bucket names
		* @returns Promise with response containing array of buckets or error
		*
		* @example List buckets
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .listBuckets()
		* ```
		*
		* @example List buckets with options
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .listBuckets({
		*     limit: 10,
		*     offset: 0,
		*     sortColumn: 'created_at',
		*     sortOrder: 'desc',
		*     search: 'prod'
		*   })
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: `select`
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async listBuckets(options) {
			var _this = this;
			return _this.handleOperation(async () => {
				const queryString = _this.listBucketOptionsToQueryString(options);
				return await get(_this.fetch, `${_this.url}/bucket${queryString}`, { headers: _this.headers });
			});
		}
		/**
		* Retrieves the details of an existing Storage bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param id The unique identifier of the bucket you would like to retrieve.
		* @returns Promise with response containing bucket details or error
		*
		* @example Get bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .getBucket('avatars')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "id": "avatars",
		*     "name": "avatars",
		*     "owner": "",
		*     "public": false,
		*     "file_size_limit": 1024,
		*     "allowed_mime_types": [
		*       "image/png"
		*     ],
		*     "created_at": "2024-05-22T22:26:05.100Z",
		*     "updated_at": "2024-05-22T22:26:05.100Z"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: `select`
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async getBucket(id) {
			var _this2 = this;
			return _this2.handleOperation(async () => {
				return await get(_this2.fetch, `${_this2.url}/bucket/${id}`, { headers: _this2.headers });
			});
		}
		/**
		* Creates a new Storage bucket
		*
		* @category Storage
		* @subcategory File Buckets
		* @param id A unique identifier for the bucket you are creating.
		* @param options.public The visibility of the bucket. Public buckets don't require an authorization token to download objects, but still require a valid token for all other operations. By default, buckets are private.
		* @param options.fileSizeLimit specifies the max file size in bytes that can be uploaded to this bucket.
		* The global file size limit takes precedence over this value.
		* The default value is null, which doesn't set a per bucket file size limit.
		* @param options.allowedMimeTypes specifies the allowed mime types that this bucket can accept during upload.
		* The default value is null, which allows files with all mime types to be uploaded.
		* Each mime type specified can be a wildcard, e.g. image/*, or a specific mime type, e.g. image/png.
		* @param options.type (private-beta) specifies the bucket type. see `BucketType` for more details.
		*   - default bucket type is `STANDARD`
		* @returns Promise with response containing newly created bucket name or error
		*
		* @example Create bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .createBucket('avatars', {
		*     public: false,
		*     allowedMimeTypes: ['image/png'],
		*     fileSizeLimit: 1024
		*   })
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "name": "avatars"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: `insert`
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async createBucket(id, options = { public: false }) {
			var _this3 = this;
			return _this3.handleOperation(async () => {
				return await post(_this3.fetch, `${_this3.url}/bucket`, {
					id,
					name: id,
					type: options.type,
					public: options.public,
					file_size_limit: options.fileSizeLimit,
					allowed_mime_types: options.allowedMimeTypes
				}, { headers: _this3.headers });
			});
		}
		/**
		* Updates a Storage bucket
		*
		* @category Storage
		* @subcategory File Buckets
		* @param id A unique identifier for the bucket you are updating.
		* @param options.public The visibility of the bucket. Public buckets don't require an authorization token to download objects, but still require a valid token for all other operations.
		* @param options.fileSizeLimit specifies the max file size in bytes that can be uploaded to this bucket.
		* The global file size limit takes precedence over this value.
		* The default value is null, which doesn't set a per bucket file size limit.
		* @param options.allowedMimeTypes specifies the allowed mime types that this bucket can accept during upload.
		* The default value is null, which allows files with all mime types to be uploaded.
		* Each mime type specified can be a wildcard, e.g. image/*, or a specific mime type, e.g. image/png.
		* @returns Promise with response containing success message or error
		*
		* @example Update bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .updateBucket('avatars', {
		*     public: false,
		*     allowedMimeTypes: ['image/png'],
		*     fileSizeLimit: 1024
		*   })
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "message": "Successfully updated"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: `select` and `update`
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async updateBucket(id, options) {
			var _this4 = this;
			return _this4.handleOperation(async () => {
				return await put(_this4.fetch, `${_this4.url}/bucket/${id}`, {
					id,
					name: id,
					public: options.public,
					file_size_limit: options.fileSizeLimit,
					allowed_mime_types: options.allowedMimeTypes
				}, { headers: _this4.headers });
			});
		}
		/**
		* Removes all objects inside a single bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param id The unique identifier of the bucket you would like to empty.
		* @returns Promise with success message or error
		*
		* @example Empty bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .emptyBucket('avatars')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "message": "Successfully emptied"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: `select`
		*   - `objects` table permissions: `select` and `delete`
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async emptyBucket(id) {
			var _this5 = this;
			return _this5.handleOperation(async () => {
				return await post(_this5.fetch, `${_this5.url}/bucket/${id}/empty`, {}, { headers: _this5.headers });
			});
		}
		/**
		* Deletes an existing bucket. A bucket can't be deleted with existing objects inside it.
		* You must first `empty()` the bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		* @param id The unique identifier of the bucket you would like to delete.
		* @returns Promise with success message or error
		*
		* @example Delete bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .deleteBucket('avatars')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "message": "Successfully deleted"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - RLS policy permissions required:
		*   - `buckets` table permissions: `select` and `delete`
		*   - `objects` table permissions: none
		* - Refer to the [Storage guide](/docs/guides/storage/security/access-control) on how access control works
		*/
		async deleteBucket(id) {
			var _this6 = this;
			return _this6.handleOperation(async () => {
				return await remove(_this6.fetch, `${_this6.url}/bucket/${id}`, {}, { headers: _this6.headers });
			});
		}
		listBucketOptionsToQueryString(options) {
			const params = {};
			if (options) {
				if ("limit" in options) params.limit = String(options.limit);
				if ("offset" in options) params.offset = String(options.offset);
				if (options.search) params.search = options.search;
				if (options.sortColumn) params.sortColumn = options.sortColumn;
				if (options.sortOrder) params.sortOrder = options.sortOrder;
			}
			return Object.keys(params).length > 0 ? "?" + new URLSearchParams(params).toString() : "";
		}
	};
	/**
	* Client class for managing Analytics Buckets using Iceberg tables
	* Provides methods for creating, listing, and deleting analytics buckets
	*/
	var StorageAnalyticsClient = class extends BaseApiClient {
		/**
		* @alpha
		*
		* Creates a new StorageAnalyticsClient instance
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Analytics Buckets
		* @param url - The base URL for the storage API
		* @param headers - HTTP headers to include in requests
		* @param fetch - Optional custom fetch implementation
		*
		* @example Using supabase-js (recommended)
		* ```typescript
		* import { createClient } from '@supabase/supabase-js'
		*
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
		* const { data, error } = await supabase.storage.analytics.listBuckets()
		* ```
		*
		* @example Standalone import for bundle-sensitive environments
		* ```typescript
		* import { StorageAnalyticsClient } from '@supabase/storage-js'
		*
		* const client = new StorageAnalyticsClient(url, headers)
		* ```
		*/
		constructor(url, headers = {}, fetch$1) {
			const finalUrl = url.replace(/\/$/, "");
			const finalHeaders = _objectSpread2(_objectSpread2({}, DEFAULT_HEADERS), headers);
			super(finalUrl, finalHeaders, fetch$1, "storage");
		}
		/**
		* @alpha
		*
		* Creates a new analytics bucket using Iceberg tables
		* Analytics buckets are optimized for analytical queries and data processing
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Analytics Buckets
		* @param name A unique name for the bucket you are creating
		* @returns Promise with response containing newly created analytics bucket or error
		*
		* @example Create analytics bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .analytics
		*   .createBucket('analytics-data')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "name": "analytics-data",
		*     "type": "ANALYTICS",
		*     "format": "iceberg",
		*     "created_at": "2024-05-22T22:26:05.100Z",
		*     "updated_at": "2024-05-22T22:26:05.100Z"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - Creates a new analytics bucket using Iceberg tables
		* - Analytics buckets are optimized for analytical queries and data processing
		*/
		async createBucket(name) {
			var _this = this;
			return _this.handleOperation(async () => {
				return await post(_this.fetch, `${_this.url}/bucket`, { name }, { headers: _this.headers });
			});
		}
		/**
		* @alpha
		*
		* Retrieves the details of all Analytics Storage buckets within an existing project
		* Only returns buckets of type 'ANALYTICS'
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Analytics Buckets
		* @param options Query parameters for listing buckets
		* @param options.limit Maximum number of buckets to return
		* @param options.offset Number of buckets to skip
		* @param options.sortColumn Column to sort by ('name', 'created_at', 'updated_at')
		* @param options.sortOrder Sort order ('asc' or 'desc')
		* @param options.search Search term to filter bucket names
		* @returns Promise with response containing array of analytics buckets or error
		*
		* @example List analytics buckets
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .analytics
		*   .listBuckets({
		*     limit: 10,
		*     offset: 0,
		*     sortColumn: 'created_at',
		*     sortOrder: 'desc'
		*   })
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": [
		*     {
		*       "name": "analytics-data",
		*       "type": "ANALYTICS",
		*       "format": "iceberg",
		*       "created_at": "2024-05-22T22:26:05.100Z",
		*       "updated_at": "2024-05-22T22:26:05.100Z"
		*     }
		*   ],
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - Retrieves the details of all Analytics Storage buckets within an existing project
		* - Only returns buckets of type 'ANALYTICS'
		*/
		async listBuckets(options) {
			var _this2 = this;
			return _this2.handleOperation(async () => {
				const queryParams = new URLSearchParams();
				if ((options === null || options === void 0 ? void 0 : options.limit) !== void 0) queryParams.set("limit", options.limit.toString());
				if ((options === null || options === void 0 ? void 0 : options.offset) !== void 0) queryParams.set("offset", options.offset.toString());
				if (options === null || options === void 0 ? void 0 : options.sortColumn) queryParams.set("sortColumn", options.sortColumn);
				if (options === null || options === void 0 ? void 0 : options.sortOrder) queryParams.set("sortOrder", options.sortOrder);
				if (options === null || options === void 0 ? void 0 : options.search) queryParams.set("search", options.search);
				const queryString = queryParams.toString();
				const url = queryString ? `${_this2.url}/bucket?${queryString}` : `${_this2.url}/bucket`;
				return await get(_this2.fetch, url, { headers: _this2.headers });
			});
		}
		/**
		* @alpha
		*
		* Deletes an existing analytics bucket
		* A bucket can't be deleted with existing objects inside it
		* You must first empty the bucket before deletion
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Analytics Buckets
		* @param bucketName The unique identifier of the bucket you would like to delete
		* @returns Promise with response containing success message or error
		*
		* @example Delete analytics bucket
		* ```js
		* const { data, error } = await supabase
		*   .storage
		*   .analytics
		*   .deleteBucket('analytics-data')
		* ```
		*
		* Response:
		* ```json
		* {
		*   "data": {
		*     "message": "Successfully deleted"
		*   },
		*   "error": null
		* }
		* ```
		*
		* @remarks
		* - Deletes an analytics bucket
		*/
		async deleteBucket(bucketName) {
			var _this3 = this;
			return _this3.handleOperation(async () => {
				return await remove(_this3.fetch, `${_this3.url}/bucket/${bucketName}`, {}, { headers: _this3.headers });
			});
		}
		/**
		* @alpha
		*
		* Get an Iceberg REST Catalog client configured for a specific analytics bucket
		* Use this to perform advanced table and namespace operations within the bucket
		* The returned client provides full access to the Apache Iceberg REST Catalog API
		* with the Supabase `{ data, error }` pattern for consistent error handling on all operations.
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Analytics Buckets
		* @param bucketName - The name of the analytics bucket (warehouse) to connect to
		* @returns The wrapped Iceberg catalog client
		* @throws {StorageError} If the bucket name is invalid
		*
		* @example Get catalog and create table
		* ```js
		* // First, create an analytics bucket
		* const { data: bucket, error: bucketError } = await supabase
		*   .storage
		*   .analytics
		*   .createBucket('analytics-data')
		*
		* // Get the Iceberg catalog for that bucket
		* const catalog = supabase.storage.analytics.from('analytics-data')
		*
		* // Create a namespace
		* const { error: nsError } = await catalog.createNamespace({ namespace: ['default'] })
		*
		* // Create a table with schema
		* const { data: tableMetadata, error: tableError } = await catalog.createTable(
		*   { namespace: ['default'] },
		*   {
		*     name: 'events',
		*     schema: {
		*       type: 'struct',
		*       fields: [
		*         { id: 1, name: 'id', type: 'long', required: true },
		*         { id: 2, name: 'timestamp', type: 'timestamp', required: true },
		*         { id: 3, name: 'user_id', type: 'string', required: false }
		*       ],
		*       'schema-id': 0,
		*       'identifier-field-ids': [1]
		*     },
		*     'partition-spec': {
		*       'spec-id': 0,
		*       fields: []
		*     },
		*     'write-order': {
		*       'order-id': 0,
		*       fields: []
		*     },
		*     properties: {
		*       'write.format.default': 'parquet'
		*     }
		*   }
		* )
		* ```
		*
		* @example List tables in namespace
		* ```js
		* const catalog = supabase.storage.analytics.from('analytics-data')
		*
		* // List all tables in the default namespace
		* const { data: tables, error: listError } = await catalog.listTables({ namespace: ['default'] })
		* if (listError) {
		*   if (listError.isNotFound()) {
		*     console.log('Namespace not found')
		*   }
		*   return
		* }
		* console.log(tables) // [{ namespace: ['default'], name: 'events' }]
		* ```
		*
		* @example Working with namespaces
		* ```js
		* const catalog = supabase.storage.analytics.from('analytics-data')
		*
		* // List all namespaces
		* const { data: namespaces } = await catalog.listNamespaces()
		*
		* // Create namespace with properties
		* await catalog.createNamespace(
		*   { namespace: ['production'] },
		*   { properties: { owner: 'data-team', env: 'prod' } }
		* )
		* ```
		*
		* @example Cleanup operations
		* ```js
		* const catalog = supabase.storage.analytics.from('analytics-data')
		*
		* // Drop table with purge option (removes all data)
		* const { error: dropError } = await catalog.dropTable(
		*   { namespace: ['default'], name: 'events' },
		*   { purge: true }
		* )
		*
		* if (dropError?.isNotFound()) {
		*   console.log('Table does not exist')
		* }
		*
		* // Drop namespace (must be empty)
		* await catalog.dropNamespace({ namespace: ['default'] })
		* ```
		*
		* @remarks
		* This method provides a bridge between Supabase's bucket management and the standard
		* Apache Iceberg REST Catalog API. The bucket name maps to the Iceberg warehouse parameter.
		* All authentication and configuration is handled automatically using your Supabase credentials.
		*
		* **Error Handling**: Invalid bucket names throw immediately. All catalog
		* operations return `{ data, error }` where errors are `IcebergError` instances from iceberg-js.
		* Use helper methods like `error.isNotFound()` or check `error.status` for specific error handling.
		* Use `.throwOnError()` on the analytics client if you prefer exceptions for catalog operations.
		*
		* **Cleanup Operations**: When using `dropTable`, the `purge: true` option permanently
		* deletes all table data. Without it, the table is marked as deleted but data remains.
		*
		* **Library Dependency**: The returned catalog wraps `IcebergRestCatalog` from iceberg-js.
		* For complete API documentation and advanced usage, refer to the
		* [iceberg-js documentation](https://supabase.github.io/iceberg-js/).
		*/
		from(bucketName) {
			var _this4 = this;
			if (!isValidBucketName(bucketName)) throw new StorageError("Invalid bucket name: File, folder, and bucket names must follow AWS object key naming guidelines and should avoid the use of any other characters.");
			const catalog = new iceberg_js.IcebergRestCatalog({
				baseUrl: this.url,
				catalogName: bucketName,
				auth: {
					type: "custom",
					getHeaders: async () => _this4.headers
				},
				fetch: this.fetch
			});
			const shouldThrowOnError = this.shouldThrowOnError;
			return new Proxy(catalog, { get(target, prop) {
				const value = target[prop];
				if (typeof value !== "function") return value;
				return async (...args) => {
					try {
						return {
							data: await value.apply(target, args),
							error: null
						};
					} catch (error) {
						if (shouldThrowOnError) throw error;
						return {
							data: null,
							error
						};
					}
				};
			} });
		}
	};
	/**
	* @hidden
	* Base implementation for vector index operations.
	* Use {@link VectorBucketScope} via `supabase.storage.vectors.from('bucket')` instead.
	*/
	var VectorIndexApi = class extends BaseApiClient {
		/** Creates a new VectorIndexApi instance */
		constructor(url, headers = {}, fetch$1) {
			const finalUrl = url.replace(/\/$/, "");
			const finalHeaders = _objectSpread2(_objectSpread2({}, DEFAULT_HEADERS), {}, { "Content-Type": "application/json" }, headers);
			super(finalUrl, finalHeaders, fetch$1, "vectors");
		}
		/** Creates a new vector index within a bucket */
		async createIndex(options) {
			var _this = this;
			return _this.handleOperation(async () => {
				return await vectorsApi.post(_this.fetch, `${_this.url}/CreateIndex`, options, { headers: _this.headers }) || {};
			});
		}
		/** Retrieves metadata for a specific vector index */
		async getIndex(vectorBucketName, indexName) {
			var _this2 = this;
			return _this2.handleOperation(async () => {
				return await vectorsApi.post(_this2.fetch, `${_this2.url}/GetIndex`, {
					vectorBucketName,
					indexName
				}, { headers: _this2.headers });
			});
		}
		/** Lists vector indexes within a bucket with optional filtering and pagination */
		async listIndexes(options) {
			var _this3 = this;
			return _this3.handleOperation(async () => {
				return await vectorsApi.post(_this3.fetch, `${_this3.url}/ListIndexes`, options, { headers: _this3.headers });
			});
		}
		/** Deletes a vector index and all its data */
		async deleteIndex(vectorBucketName, indexName) {
			var _this4 = this;
			return _this4.handleOperation(async () => {
				return await vectorsApi.post(_this4.fetch, `${_this4.url}/DeleteIndex`, {
					vectorBucketName,
					indexName
				}, { headers: _this4.headers }) || {};
			});
		}
	};
	/**
	* @hidden
	* Base implementation for vector data operations.
	* Use {@link VectorIndexScope} via `supabase.storage.vectors.from('bucket').index('idx')` instead.
	*/
	var VectorDataApi = class extends BaseApiClient {
		/** Creates a new VectorDataApi instance */
		constructor(url, headers = {}, fetch$1) {
			const finalUrl = url.replace(/\/$/, "");
			const finalHeaders = _objectSpread2(_objectSpread2({}, DEFAULT_HEADERS), {}, { "Content-Type": "application/json" }, headers);
			super(finalUrl, finalHeaders, fetch$1, "vectors");
		}
		/** Inserts or updates vectors in batch (1-500 per request) */
		async putVectors(options) {
			var _this = this;
			if (options.vectors.length < 1 || options.vectors.length > 500) throw new Error("Vector batch size must be between 1 and 500 items");
			return _this.handleOperation(async () => {
				return await vectorsApi.post(_this.fetch, `${_this.url}/PutVectors`, options, { headers: _this.headers }) || {};
			});
		}
		/** Retrieves vectors by their keys in batch */
		async getVectors(options) {
			var _this2 = this;
			return _this2.handleOperation(async () => {
				return await vectorsApi.post(_this2.fetch, `${_this2.url}/GetVectors`, options, { headers: _this2.headers });
			});
		}
		/** Lists vectors in an index with pagination */
		async listVectors(options) {
			var _this3 = this;
			if (options.segmentCount !== void 0) {
				if (options.segmentCount < 1 || options.segmentCount > 16) throw new Error("segmentCount must be between 1 and 16");
				if (options.segmentIndex !== void 0) {
					if (options.segmentIndex < 0 || options.segmentIndex >= options.segmentCount) throw new Error(`segmentIndex must be between 0 and ${options.segmentCount - 1}`);
				}
			}
			return _this3.handleOperation(async () => {
				return await vectorsApi.post(_this3.fetch, `${_this3.url}/ListVectors`, options, { headers: _this3.headers });
			});
		}
		/** Queries for similar vectors using approximate nearest neighbor search */
		async queryVectors(options) {
			var _this4 = this;
			return _this4.handleOperation(async () => {
				return await vectorsApi.post(_this4.fetch, `${_this4.url}/QueryVectors`, options, { headers: _this4.headers });
			});
		}
		/** Deletes vectors by their keys in batch (1-500 per request) */
		async deleteVectors(options) {
			var _this5 = this;
			if (options.keys.length < 1 || options.keys.length > 500) throw new Error("Keys batch size must be between 1 and 500 items");
			return _this5.handleOperation(async () => {
				return await vectorsApi.post(_this5.fetch, `${_this5.url}/DeleteVectors`, options, { headers: _this5.headers }) || {};
			});
		}
	};
	/**
	* @hidden
	* Base implementation for vector bucket operations.
	* Use {@link StorageVectorsClient} via `supabase.storage.vectors` instead.
	*/
	var VectorBucketApi = class extends BaseApiClient {
		/** Creates a new VectorBucketApi instance */
		constructor(url, headers = {}, fetch$1) {
			const finalUrl = url.replace(/\/$/, "");
			const finalHeaders = _objectSpread2(_objectSpread2({}, DEFAULT_HEADERS), {}, { "Content-Type": "application/json" }, headers);
			super(finalUrl, finalHeaders, fetch$1, "vectors");
		}
		/** Creates a new vector bucket */
		async createBucket(vectorBucketName) {
			var _this = this;
			return _this.handleOperation(async () => {
				return await vectorsApi.post(_this.fetch, `${_this.url}/CreateVectorBucket`, { vectorBucketName }, { headers: _this.headers }) || {};
			});
		}
		/** Retrieves metadata for a specific vector bucket */
		async getBucket(vectorBucketName) {
			var _this2 = this;
			return _this2.handleOperation(async () => {
				return await vectorsApi.post(_this2.fetch, `${_this2.url}/GetVectorBucket`, { vectorBucketName }, { headers: _this2.headers });
			});
		}
		/** Lists vector buckets with optional filtering and pagination */
		async listBuckets(options = {}) {
			var _this3 = this;
			return _this3.handleOperation(async () => {
				return await vectorsApi.post(_this3.fetch, `${_this3.url}/ListVectorBuckets`, options, { headers: _this3.headers });
			});
		}
		/** Deletes a vector bucket (must be empty first) */
		async deleteBucket(vectorBucketName) {
			var _this4 = this;
			return _this4.handleOperation(async () => {
				return await vectorsApi.post(_this4.fetch, `${_this4.url}/DeleteVectorBucket`, { vectorBucketName }, { headers: _this4.headers }) || {};
			});
		}
	};
	/**
	*
	* @alpha
	*
	* Main client for interacting with S3 Vectors API
	* Provides access to bucket, index, and vector data operations
	*
	* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
	*
	* **Usage Patterns:**
	*
	* ```typescript
	* const { data, error } = await supabase
	*  .storage
	*  .vectors
	*  .createBucket('embeddings-prod')
	*
	* // Access index operations via buckets
	* const bucket = supabase.storage.vectors.from('embeddings-prod')
	* await bucket.createIndex({
	*   indexName: 'documents',
	*   dataType: 'float32',
	*   dimension: 1536,
	*   distanceMetric: 'cosine'
	* })
	*
	* // Access vector operations via index
	* const index = bucket.index('documents')
	* await index.putVectors({
	*   vectors: [
	*     { key: 'doc-1', data: { float32: [...] }, metadata: { title: 'Intro' } }
	*   ]
	* })
	*
	* // Query similar vectors
	* const { data } = await index.queryVectors({
	*   queryVector: { float32: [...] },
	*   topK: 5,
	*   returnDistance: true
	* })
	* ```
	*/
	var StorageVectorsClient = class extends VectorBucketApi {
		/**
		* @alpha
		*
		* Creates a StorageVectorsClient that can manage buckets, indexes, and vectors.
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param url - Base URL of the Storage Vectors REST API.
		* @param options.headers - Optional headers (for example `Authorization`) applied to every request.
		* @param options.fetch - Optional custom `fetch` implementation for non-browser runtimes.
		*
		* @example Using supabase-js (recommended)
		* ```typescript
		* import { createClient } from '@supabase/supabase-js'
		*
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* ```
		*
		* @example Standalone import for bundle-sensitive environments
		* ```typescript
		* import { StorageVectorsClient } from '@supabase/storage-js'
		*
		* const client = new StorageVectorsClient(url, options)
		* ```
		*/
		constructor(url, options = {}) {
			super(url, options.headers || {}, options.fetch);
		}
		/**
		*
		* @alpha
		*
		* Access operations for a specific vector bucket
		* Returns a scoped client for index and vector operations within the bucket
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param vectorBucketName - Name of the vector bucket
		* @returns Bucket-scoped client with index and vector operations
		*
		* @example Accessing a vector bucket
		* ```typescript
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* ```
		*/
		from(vectorBucketName) {
			return new VectorBucketScope(this.url, this.headers, vectorBucketName, this.fetch);
		}
		/**
		*
		* @alpha
		*
		* Creates a new vector bucket
		* Vector buckets are containers for vector indexes and their data
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param vectorBucketName - Unique name for the vector bucket
		* @returns Promise with empty response on success or error
		*
		* @example Creating a vector bucket
		* ```typescript
		* const { data, error } = await supabase
		*   .storage
		*   .vectors
		*   .createBucket('embeddings-prod')
		* ```
		*/
		async createBucket(vectorBucketName) {
			var _superprop_getCreateBucket = () => super.createBucket, _this = this;
			return _superprop_getCreateBucket().call(_this, vectorBucketName);
		}
		/**
		*
		* @alpha
		*
		* Retrieves metadata for a specific vector bucket
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param vectorBucketName - Name of the vector bucket
		* @returns Promise with bucket metadata or error
		*
		* @example Get bucket metadata
		* ```typescript
		* const { data, error } = await supabase
		*   .storage
		*   .vectors
		*   .getBucket('embeddings-prod')
		*
		* console.log('Bucket created:', data?.vectorBucket.creationTime)
		* ```
		*/
		async getBucket(vectorBucketName) {
			var _superprop_getGetBucket = () => super.getBucket, _this2 = this;
			return _superprop_getGetBucket().call(_this2, vectorBucketName);
		}
		/**
		*
		* @alpha
		*
		* Lists all vector buckets with optional filtering and pagination
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Optional filters (prefix, maxResults, nextToken)
		* @returns Promise with list of buckets or error
		*
		* @example List vector buckets
		* ```typescript
		* const { data, error } = await supabase
		*   .storage
		*   .vectors
		*   .listBuckets({ prefix: 'embeddings-' })
		*
		* data?.vectorBuckets.forEach(bucket => {
		*   console.log(bucket.vectorBucketName)
		* })
		* ```
		*/
		async listBuckets(options = {}) {
			var _superprop_getListBuckets = () => super.listBuckets, _this3 = this;
			return _superprop_getListBuckets().call(_this3, options);
		}
		/**
		*
		* @alpha
		*
		* Deletes a vector bucket (bucket must be empty)
		* All indexes must be deleted before deleting the bucket
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param vectorBucketName - Name of the vector bucket to delete
		* @returns Promise with empty response on success or error
		*
		* @example Delete a vector bucket
		* ```typescript
		* const { data, error } = await supabase
		*   .storage
		*   .vectors
		*   .deleteBucket('embeddings-old')
		* ```
		*/
		async deleteBucket(vectorBucketName) {
			var _superprop_getDeleteBucket = () => super.deleteBucket, _this4 = this;
			return _superprop_getDeleteBucket().call(_this4, vectorBucketName);
		}
	};
	/**
	*
	* @alpha
	*
	* Scoped client for operations within a specific vector bucket
	* Provides index management and access to vector operations
	*
	* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
	*/
	var VectorBucketScope = class extends VectorIndexApi {
		/**
		* @alpha
		*
		* Creates a helper that automatically scopes all index operations to the provided bucket.
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @example Creating a vector bucket scope
		* ```typescript
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* ```
		*/
		constructor(url, headers, vectorBucketName, fetch$1) {
			super(url, headers, fetch$1);
			this.vectorBucketName = vectorBucketName;
		}
		/**
		*
		* @alpha
		*
		* Creates a new vector index in this bucket
		* Convenience method that automatically includes the bucket name
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Index configuration (vectorBucketName is automatically set)
		* @returns Promise with empty response on success or error
		*
		* @example Creating a vector index
		* ```typescript
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* await bucket.createIndex({
		*   indexName: 'documents-openai',
		*   dataType: 'float32',
		*   dimension: 1536,
		*   distanceMetric: 'cosine',
		*   metadataConfiguration: {
		*     nonFilterableMetadataKeys: ['raw_text']
		*   }
		* })
		* ```
		*/
		async createIndex(options) {
			var _superprop_getCreateIndex = () => super.createIndex, _this5 = this;
			return _superprop_getCreateIndex().call(_this5, _objectSpread2(_objectSpread2({}, options), {}, { vectorBucketName: _this5.vectorBucketName }));
		}
		/**
		*
		* @alpha
		*
		* Lists indexes in this bucket
		* Convenience method that automatically includes the bucket name
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Listing options (vectorBucketName is automatically set)
		* @returns Promise with response containing indexes array and pagination token or error
		*
		* @example List indexes
		* ```typescript
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* const { data } = await bucket.listIndexes({ prefix: 'documents-' })
		* ```
		*/
		async listIndexes(options = {}) {
			var _superprop_getListIndexes = () => super.listIndexes, _this6 = this;
			return _superprop_getListIndexes().call(_this6, _objectSpread2(_objectSpread2({}, options), {}, { vectorBucketName: _this6.vectorBucketName }));
		}
		/**
		*
		* @alpha
		*
		* Retrieves metadata for a specific index in this bucket
		* Convenience method that automatically includes the bucket name
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param indexName - Name of the index to retrieve
		* @returns Promise with index metadata or error
		*
		* @example Get index metadata
		* ```typescript
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* const { data } = await bucket.getIndex('documents-openai')
		* console.log('Dimension:', data?.index.dimension)
		* ```
		*/
		async getIndex(indexName) {
			var _superprop_getGetIndex = () => super.getIndex, _this7 = this;
			return _superprop_getGetIndex().call(_this7, _this7.vectorBucketName, indexName);
		}
		/**
		*
		* @alpha
		*
		* Deletes an index from this bucket
		* Convenience method that automatically includes the bucket name
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param indexName - Name of the index to delete
		* @returns Promise with empty response on success or error
		*
		* @example Delete an index
		* ```typescript
		* const bucket = supabase.storage.vectors.from('embeddings-prod')
		* await bucket.deleteIndex('old-index')
		* ```
		*/
		async deleteIndex(indexName) {
			var _superprop_getDeleteIndex = () => super.deleteIndex, _this8 = this;
			return _superprop_getDeleteIndex().call(_this8, _this8.vectorBucketName, indexName);
		}
		/**
		*
		* @alpha
		*
		* Access operations for a specific index within this bucket
		* Returns a scoped client for vector data operations
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param indexName - Name of the index
		* @returns Index-scoped client with vector data operations
		*
		* @example Accessing an index
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		*
		* // Insert vectors
		* await index.putVectors({
		*   vectors: [
		*     { key: 'doc-1', data: { float32: [...] }, metadata: { title: 'Intro' } }
		*   ]
		* })
		*
		* // Query similar vectors
		* const { data } = await index.queryVectors({
		*   queryVector: { float32: [...] },
		*   topK: 5
		* })
		* ```
		*/
		index(indexName) {
			return new VectorIndexScope(this.url, this.headers, this.vectorBucketName, indexName, this.fetch);
		}
	};
	/**
	*
	* @alpha
	*
	* Scoped client for operations within a specific vector index
	* Provides vector data operations (put, get, list, query, delete)
	*
	* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
	*/
	var VectorIndexScope = class extends VectorDataApi {
		/**
		*
		* @alpha
		*
		* Creates a helper that automatically scopes all vector operations to the provided bucket/index names.
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @example Creating a vector index scope
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		* ```
		*/
		constructor(url, headers, vectorBucketName, indexName, fetch$1) {
			super(url, headers, fetch$1);
			this.vectorBucketName = vectorBucketName;
			this.indexName = indexName;
		}
		/**
		*
		* @alpha
		*
		* Inserts or updates vectors in this index
		* Convenience method that automatically includes bucket and index names
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Vector insertion options (bucket and index names automatically set)
		* @returns Promise with empty response on success or error
		*
		* @example Insert vectors into an index
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		* await index.putVectors({
		*   vectors: [
		*     {
		*       key: 'doc-1',
		*       data: { float32: [0.1, 0.2, ...] },
		*       metadata: { title: 'Introduction', page: 1 }
		*     }
		*   ]
		* })
		* ```
		*/
		async putVectors(options) {
			var _superprop_getPutVectors = () => super.putVectors, _this9 = this;
			return _superprop_getPutVectors().call(_this9, _objectSpread2(_objectSpread2({}, options), {}, {
				vectorBucketName: _this9.vectorBucketName,
				indexName: _this9.indexName
			}));
		}
		/**
		*
		* @alpha
		*
		* Retrieves vectors by keys from this index
		* Convenience method that automatically includes bucket and index names
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Vector retrieval options (bucket and index names automatically set)
		* @returns Promise with response containing vectors array or error
		*
		* @example Get vectors by keys
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		* const { data } = await index.getVectors({
		*   keys: ['doc-1', 'doc-2'],
		*   returnMetadata: true
		* })
		* ```
		*/
		async getVectors(options) {
			var _superprop_getGetVectors = () => super.getVectors, _this10 = this;
			return _superprop_getGetVectors().call(_this10, _objectSpread2(_objectSpread2({}, options), {}, {
				vectorBucketName: _this10.vectorBucketName,
				indexName: _this10.indexName
			}));
		}
		/**
		*
		* @alpha
		*
		* Lists vectors in this index with pagination
		* Convenience method that automatically includes bucket and index names
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Listing options (bucket and index names automatically set)
		* @returns Promise with response containing vectors array and pagination token or error
		*
		* @example List vectors with pagination
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		* const { data } = await index.listVectors({
		*   maxResults: 500,
		*   returnMetadata: true
		* })
		* ```
		*/
		async listVectors(options = {}) {
			var _superprop_getListVectors = () => super.listVectors, _this11 = this;
			return _superprop_getListVectors().call(_this11, _objectSpread2(_objectSpread2({}, options), {}, {
				vectorBucketName: _this11.vectorBucketName,
				indexName: _this11.indexName
			}));
		}
		/**
		*
		* @alpha
		*
		* Queries for similar vectors in this index
		* Convenience method that automatically includes bucket and index names
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Query options (bucket and index names automatically set)
		* @returns Promise with response containing matches array of similar vectors ordered by distance or error
		*
		* @example Query similar vectors
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		* const { data } = await index.queryVectors({
		*   queryVector: { float32: [0.1, 0.2, ...] },
		*   topK: 5,
		*   filter: { category: 'technical' },
		*   returnDistance: true,
		*   returnMetadata: true
		* })
		* ```
		*/
		async queryVectors(options) {
			var _superprop_getQueryVectors = () => super.queryVectors, _this12 = this;
			return _superprop_getQueryVectors().call(_this12, _objectSpread2(_objectSpread2({}, options), {}, {
				vectorBucketName: _this12.vectorBucketName,
				indexName: _this12.indexName
			}));
		}
		/**
		*
		* @alpha
		*
		* Deletes vectors by keys from this index
		* Convenience method that automatically includes bucket and index names
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		* @param options - Deletion options (bucket and index names automatically set)
		* @returns Promise with empty response on success or error
		*
		* @example Delete vectors by keys
		* ```typescript
		* const index = supabase.storage.vectors.from('embeddings-prod').index('documents-openai')
		* await index.deleteVectors({
		*   keys: ['doc-1', 'doc-2', 'doc-3']
		* })
		* ```
		*/
		async deleteVectors(options) {
			var _superprop_getDeleteVectors = () => super.deleteVectors, _this13 = this;
			return _superprop_getDeleteVectors().call(_this13, _objectSpread2(_objectSpread2({}, options), {}, {
				vectorBucketName: _this13.vectorBucketName,
				indexName: _this13.indexName
			}));
		}
	};
	var StorageClient = class extends StorageBucketApi {
		/**
		* Creates a client for Storage buckets, files, analytics, and vectors.
		*
		* @category Storage
		* @subcategory File Buckets
		*
		* @example Using supabase-js (recommended)
		* ```ts
		* import { createClient } from '@supabase/supabase-js'
		*
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
		* const avatars = supabase.storage.from('avatars')
		* ```
		*
		* @example Standalone import for bundle-sensitive environments
		* ```ts
		* import { StorageClient } from '@supabase/storage-js'
		*
		* const storage = new StorageClient('https://xyzcompany.supabase.co/storage/v1', {
		*   apikey: 'your-publishable-key',
		* })
		* const avatars = storage.from('avatars')
		* ```
		*/
		constructor(url, headers = {}, fetch$1, opts) {
			super(url, headers, fetch$1, opts);
		}
		/**
		* Perform file operation in a bucket.
		*
		* @category Storage
		* @subcategory File Buckets
		*
		* @param id The bucket id to operate on.
		*
		* @example Accessing a bucket
		* ```typescript
		* const avatars = supabase.storage.from('avatars')
		* ```
		*/
		from(id) {
			return new StorageFileApi(this.url, this.headers, id, this.fetch);
		}
		/**
		*
		* @alpha
		*
		* Access vector storage operations.
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Vector Buckets
		*
		* @returns A StorageVectorsClient instance configured with the current storage settings.
		*/
		get vectors() {
			return new StorageVectorsClient(this.url + "/vector", {
				headers: this.headers,
				fetch: this.fetch
			});
		}
		/**
		*
		* @alpha
		*
		* Access analytics storage operations using Iceberg tables.
		*
		* **Public alpha:** This API is part of a public alpha release and may not be available to your account type.
		*
		* @category Storage
		* @subcategory Analytics Buckets
		*
		* @returns A StorageAnalyticsClient instance configured with the current storage settings.
		*/
		get analytics() {
			return new StorageAnalyticsClient(this.url + "/iceberg", this.headers, this.fetch);
		}
	};
	exports.StorageAnalyticsClient = StorageAnalyticsClient;
	exports.StorageApiError = StorageApiError;
	exports.StorageClient = StorageClient;
	exports.StorageError = StorageError;
	exports.StorageUnknownError = StorageUnknownError;
	exports.StorageVectorsApiError = StorageVectorsApiError;
	exports.StorageVectorsClient = StorageVectorsClient;
	exports.StorageVectorsError = StorageVectorsError;
	exports.StorageVectorsErrorCode = StorageVectorsErrorCode;
	exports.StorageVectorsUnknownError = StorageVectorsUnknownError;
	exports.VectorBucketApi = VectorBucketApi;
	exports.VectorBucketScope = VectorBucketScope;
	exports.VectorDataApi = VectorDataApi;
	exports.VectorIndexApi = VectorIndexApi;
	exports.VectorIndexScope = VectorIndexScope;
	exports.isStorageError = isStorageError;
	exports.isStorageVectorsError = isStorageVectorsError;
}));
//#endregion
//#region ../../node_modules/@supabase/supabase-js/dist/index.cjs
var require_dist$1 = /* @__PURE__ */ __commonJSMin(((exports) => {
	let __supabase_functions_js = require_main$1();
	let __supabase_postgrest_js = require_dist$4();
	let __supabase_realtime_js = require_main$2();
	let __supabase_storage_js = require_dist$2();
	let __supabase_auth_js = require_main$3();
	const version = "2.105.4";
	let JS_ENV = "";
	if (typeof Deno !== "undefined") JS_ENV = "deno";
	else if (typeof document !== "undefined") JS_ENV = "web";
	else if (typeof navigator !== "undefined" && navigator.product === "ReactNative") JS_ENV = "react-native";
	else JS_ENV = "node";
	const DEFAULT_GLOBAL_OPTIONS = { headers: { "X-Client-Info": `supabase-js-${JS_ENV}/${version}` } };
	const DEFAULT_DB_OPTIONS = { schema: "public" };
	const DEFAULT_AUTH_OPTIONS = {
		autoRefreshToken: true,
		persistSession: true,
		detectSessionInUrl: true,
		flowType: "implicit"
	};
	const DEFAULT_REALTIME_OPTIONS = {};
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o$1) {
			return typeof o$1;
		} : function(o$1) {
			return o$1 && "function" == typeof Symbol && o$1.constructor === Symbol && o$1 !== Symbol.prototype ? "symbol" : typeof o$1;
		}, _typeof(o);
	}
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r$1) {
				return Object.getOwnPropertyDescriptor(e, r$1).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread2(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r$1) {
				_defineProperty(e, r$1, t[r$1]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r$1) {
				Object.defineProperty(e, r$1, Object.getOwnPropertyDescriptor(t, r$1));
			});
		}
		return e;
	}
	const resolveFetch = (customFetch) => {
		if (customFetch) return (...args) => customFetch(...args);
		return (...args) => fetch(...args);
	};
	const resolveHeadersConstructor = () => {
		return Headers;
	};
	const fetchWithAuth = (supabaseKey, getAccessToken, customFetch) => {
		const fetch$1 = resolveFetch(customFetch);
		const HeadersConstructor = resolveHeadersConstructor();
		return async (input, init) => {
			var _await$getAccessToken;
			const accessToken = (_await$getAccessToken = await getAccessToken()) !== null && _await$getAccessToken !== void 0 ? _await$getAccessToken : supabaseKey;
			let headers = new HeadersConstructor(init === null || init === void 0 ? void 0 : init.headers);
			if (!headers.has("apikey")) headers.set("apikey", supabaseKey);
			if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${accessToken}`);
			return fetch$1(input, _objectSpread2(_objectSpread2({}, init), {}, { headers }));
		};
	};
	function ensureTrailingSlash(url) {
		return url.endsWith("/") ? url : url + "/";
	}
	function applySettingDefaults(options, defaults) {
		var _DEFAULT_GLOBAL_OPTIO, _globalOptions$header;
		const { db: dbOptions, auth: authOptions, realtime: realtimeOptions, global: globalOptions } = options;
		const { db: DEFAULT_DB_OPTIONS$1, auth: DEFAULT_AUTH_OPTIONS$1, realtime: DEFAULT_REALTIME_OPTIONS$1, global: DEFAULT_GLOBAL_OPTIONS$1 } = defaults;
		const result = {
			db: _objectSpread2(_objectSpread2({}, DEFAULT_DB_OPTIONS$1), dbOptions),
			auth: _objectSpread2(_objectSpread2({}, DEFAULT_AUTH_OPTIONS$1), authOptions),
			realtime: _objectSpread2(_objectSpread2({}, DEFAULT_REALTIME_OPTIONS$1), realtimeOptions),
			storage: {},
			global: _objectSpread2(_objectSpread2(_objectSpread2({}, DEFAULT_GLOBAL_OPTIONS$1), globalOptions), {}, { headers: _objectSpread2(_objectSpread2({}, (_DEFAULT_GLOBAL_OPTIO = DEFAULT_GLOBAL_OPTIONS$1 === null || DEFAULT_GLOBAL_OPTIONS$1 === void 0 ? void 0 : DEFAULT_GLOBAL_OPTIONS$1.headers) !== null && _DEFAULT_GLOBAL_OPTIO !== void 0 ? _DEFAULT_GLOBAL_OPTIO : {}), (_globalOptions$header = globalOptions === null || globalOptions === void 0 ? void 0 : globalOptions.headers) !== null && _globalOptions$header !== void 0 ? _globalOptions$header : {}) }),
			accessToken: async () => ""
		};
		if (options.accessToken) result.accessToken = options.accessToken;
		else delete result.accessToken;
		return result;
	}
	/**
	* Validates a Supabase client URL
	*
	* @param {string} supabaseUrl - The Supabase client URL string.
	* @returns {URL} - The validated base URL.
	* @throws {Error}
	*/
	function validateSupabaseUrl(supabaseUrl) {
		const trimmedUrl = supabaseUrl === null || supabaseUrl === void 0 ? void 0 : supabaseUrl.trim();
		if (!trimmedUrl) throw new Error("supabaseUrl is required.");
		if (!trimmedUrl.match(/^https?:\/\//i)) throw new Error("Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL.");
		try {
			return new URL(ensureTrailingSlash(trimmedUrl));
		} catch (_unused) {
			throw Error("Invalid supabaseUrl: Provided URL is malformed.");
		}
	}
	var SupabaseAuthClient = class extends __supabase_auth_js.AuthClient {
		constructor(options) {
			super(options);
		}
	};
	/**
	* Supabase Client.
	*
	* An isomorphic Javascript client for interacting with Postgres.
	*/
	var SupabaseClient = class {
		/**
		* Create a new client for use in the browser.
		*
		* @category Initializing
		*
		* @param supabaseUrl The unique Supabase URL which is supplied when you create a new project in your project dashboard.
		* @param supabaseKey The unique Supabase Key which is supplied when you create a new project in your project dashboard.
		* @param options.db.schema You can switch in between schemas. The schema needs to be on the list of exposed schemas inside Supabase.
		* @param options.auth.autoRefreshToken Set to "true" if you want to automatically refresh the token before expiring.
		* @param options.auth.persistSession Set to "true" if you want to automatically save the user session into local storage.
		* @param options.auth.detectSessionInUrl Set to "true" if you want to automatically detects OAuth grants in the URL and signs in the user.
		* @param options.realtime Options passed along to realtime-js constructor.
		* @param options.storage Options passed along to the storage-js constructor.
		* @param options.global.fetch A custom fetch implementation.
		* @param options.global.headers Any additional headers to send with each network request.
		*
		* @example Creating a client
		* ```js
		* import { createClient } from '@supabase/supabase-js'
		*
		* // Create a single supabase client for interacting with your database
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
		* ```
		*
		* @example With a custom domain
		* ```js
		* import { createClient } from '@supabase/supabase-js'
		*
		* // Use a custom domain as the supabase URL
		* const supabase = createClient('https://my-custom-domain.com', 'your-publishable-key')
		* ```
		*
		* @example With additional parameters
		* ```js
		* import { createClient } from '@supabase/supabase-js'
		*
		* const options = {
		*   db: {
		*     schema: 'public',
		*   },
		*   auth: {
		*     autoRefreshToken: true,
		*     persistSession: true,
		*     detectSessionInUrl: true
		*   },
		*   global: {
		*     headers: { 'x-my-custom-header': 'my-app-name' },
		*   },
		* }
		* const supabase = createClient("https://xyzcompany.supabase.co", "your-publishable-key", options)
		* ```
		*
		* @exampleDescription With custom schemas
		* By default the API server points to the `public` schema. You can enable other database schemas within the Dashboard.
		* Go to [Settings > API > Exposed schemas](/dashboard/project/_/settings/api) and add the schema which you want to expose to the API.
		*
		* Note: each client connection can only access a single schema, so the code above can access the `other_schema` schema but cannot access the `public` schema.
		*
		* @example With custom schemas
		* ```js
		* import { createClient } from '@supabase/supabase-js'
		*
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key', {
		*   // Provide a custom schema. Defaults to "public".
		*   db: { schema: 'other_schema' }
		* })
		* ```
		*
		* @exampleDescription Custom fetch implementation
		* `supabase-js` uses the [`cross-fetch`](https://www.npmjs.com/package/cross-fetch) library to make HTTP requests,
		* but an alternative `fetch` implementation can be provided as an option.
		* This is most useful in environments where `cross-fetch` is not compatible (for instance Cloudflare Workers).
		*
		* @example Custom fetch implementation
		* ```js
		* import { createClient } from '@supabase/supabase-js'
		*
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key', {
		*   global: { fetch: fetch.bind(globalThis) }
		* })
		* ```
		*
		* @exampleDescription React Native options with AsyncStorage
		* For React Native we recommend using `AsyncStorage` as the storage implementation for Supabase Auth.
		*
		* @example React Native options with AsyncStorage
		* ```js
		* import 'react-native-url-polyfill/auto'
		* import { createClient } from '@supabase/supabase-js'
		* import AsyncStorage from "@react-native-async-storage/async-storage";
		*
		* const supabase = createClient("https://xyzcompany.supabase.co", "your-publishable-key", {
		*   auth: {
		*     storage: AsyncStorage,
		*     autoRefreshToken: true,
		*     persistSession: true,
		*     detectSessionInUrl: false,
		*   },
		* });
		* ```
		*
		* @exampleDescription React Native options with Expo SecureStore
		* If you wish to encrypt the user's session information, you can use `aes-js` and store the encryption key in Expo SecureStore.
		* The `aes-js` library, a reputable JavaScript-only implementation of the AES encryption algorithm in CTR mode.
		* A new 256-bit encryption key is generated using the `react-native-get-random-values` library.
		* This key is stored inside Expo's SecureStore, while the value is encrypted and placed inside AsyncStorage.
		*
		* Please make sure that:
		* - You keep the `expo-secure-store`, `aes-js` and `react-native-get-random-values` libraries up-to-date.
		* - Choose the correct [`SecureStoreOptions`](https://docs.expo.dev/versions/latest/sdk/securestore/#securestoreoptions) for your app's needs.
		*   E.g. [`SecureStore.WHEN_UNLOCKED`](https://docs.expo.dev/versions/latest/sdk/securestore/#securestorewhen_unlocked) regulates when the data can be accessed.
		* - Carefully consider optimizations or other modifications to the above example, as those can lead to introducing subtle security vulnerabilities.
		*
		* @example React Native options with Expo SecureStore
		* ```ts
		* import 'react-native-url-polyfill/auto'
		* import { createClient } from '@supabase/supabase-js'
		* import AsyncStorage from '@react-native-async-storage/async-storage';
		* import * as SecureStore from 'expo-secure-store';
		* import * as aesjs from 'aes-js';
		* import 'react-native-get-random-values';
		*
		* // As Expo's SecureStore does not support values larger than 2048
		* // bytes, an AES-256 key is generated and stored in SecureStore, while
		* // it is used to encrypt/decrypt values stored in AsyncStorage.
		* class LargeSecureStore {
		*   private async _encrypt(key: string, value: string) {
		*     const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
		*
		*     const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
		*     const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
		*
		*     await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
		*
		*     return aesjs.utils.hex.fromBytes(encryptedBytes);
		*   }
		*
		*   private async _decrypt(key: string, value: string) {
		*     const encryptionKeyHex = await SecureStore.getItemAsync(key);
		*     if (!encryptionKeyHex) {
		*       return encryptionKeyHex;
		*     }
		*
		*     const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
		*     const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
		*
		*     return aesjs.utils.utf8.fromBytes(decryptedBytes);
		*   }
		*
		*   async getItem(key: string) {
		*     const encrypted = await AsyncStorage.getItem(key);
		*     if (!encrypted) { return encrypted; }
		*
		*     return await this._decrypt(key, encrypted);
		*   }
		*
		*   async removeItem(key: string) {
		*     await AsyncStorage.removeItem(key);
		*     await SecureStore.deleteItemAsync(key);
		*   }
		*
		*   async setItem(key: string, value: string) {
		*     const encrypted = await this._encrypt(key, value);
		*
		*     await AsyncStorage.setItem(key, encrypted);
		*   }
		* }
		*
		* const supabase = createClient("https://xyzcompany.supabase.co", "your-publishable-key", {
		*   auth: {
		*     storage: new LargeSecureStore(),
		*     autoRefreshToken: true,
		*     persistSession: true,
		*     detectSessionInUrl: false,
		*   },
		* });
		* ```
		*
		* @example With a database query
		* ```ts
		* import { createClient } from '@supabase/supabase-js'
		*
		* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
		*
		* const { data } = await supabase.from('profiles').select('*')
		* ```
		*/
		constructor(supabaseUrl, supabaseKey, options) {
			var _settings$auth$storag, _settings$global$head;
			this.supabaseUrl = supabaseUrl;
			this.supabaseKey = supabaseKey;
			const baseUrl = validateSupabaseUrl(supabaseUrl);
			if (!supabaseKey) throw new Error("supabaseKey is required.");
			this.realtimeUrl = new URL("realtime/v1", baseUrl);
			this.realtimeUrl.protocol = this.realtimeUrl.protocol.replace("http", "ws");
			this.authUrl = new URL("auth/v1", baseUrl);
			this.storageUrl = new URL("storage/v1", baseUrl);
			this.functionsUrl = new URL("functions/v1", baseUrl);
			const defaultStorageKey = `sb-${baseUrl.hostname.split(".")[0]}-auth-token`;
			const DEFAULTS = {
				db: DEFAULT_DB_OPTIONS,
				realtime: DEFAULT_REALTIME_OPTIONS,
				auth: _objectSpread2(_objectSpread2({}, DEFAULT_AUTH_OPTIONS), {}, { storageKey: defaultStorageKey }),
				global: DEFAULT_GLOBAL_OPTIONS
			};
			const settings = applySettingDefaults(options !== null && options !== void 0 ? options : {}, DEFAULTS);
			this.storageKey = (_settings$auth$storag = settings.auth.storageKey) !== null && _settings$auth$storag !== void 0 ? _settings$auth$storag : "";
			this.headers = (_settings$global$head = settings.global.headers) !== null && _settings$global$head !== void 0 ? _settings$global$head : {};
			if (!settings.accessToken) {
				var _settings$auth;
				this.auth = this._initSupabaseAuthClient((_settings$auth = settings.auth) !== null && _settings$auth !== void 0 ? _settings$auth : {}, this.headers, settings.global.fetch);
			} else {
				this.accessToken = settings.accessToken;
				this.auth = new Proxy({}, { get: (_, prop) => {
					throw new Error(`@supabase/supabase-js: Supabase Client is configured with the accessToken option, accessing supabase.auth.${String(prop)} is not possible`);
				} });
			}
			this.fetch = fetchWithAuth(supabaseKey, this._getAccessToken.bind(this), settings.global.fetch);
			this.realtime = this._initRealtimeClient(_objectSpread2({
				headers: this.headers,
				accessToken: this._getAccessToken.bind(this),
				fetch: this.fetch
			}, settings.realtime));
			if (this.accessToken) Promise.resolve(this.accessToken()).then((token) => this.realtime.setAuth(token)).catch((e) => console.warn("Failed to set initial Realtime auth token:", e));
			this.rest = new __supabase_postgrest_js.PostgrestClient(new URL("rest/v1", baseUrl).href, {
				headers: this.headers,
				schema: settings.db.schema,
				fetch: this.fetch,
				timeout: settings.db.timeout,
				urlLengthLimit: settings.db.urlLengthLimit
			});
			this.storage = new __supabase_storage_js.StorageClient(this.storageUrl.href, this.headers, this.fetch, options === null || options === void 0 ? void 0 : options.storage);
			if (!settings.accessToken) this._listenForAuthEvents();
		}
		/**
		* Supabase Functions allows you to deploy and invoke edge functions.
		*/
		get functions() {
			return new __supabase_functions_js.FunctionsClient(this.functionsUrl.href, {
				headers: this.headers,
				customFetch: this.fetch
			});
		}
		/**
		* Perform a query on a table or a view.
		*
		* @param relation - The table or view name to query
		*/
		from(relation) {
			return this.rest.from(relation);
		}
		/**
		* Select a schema to query or perform an function (rpc) call.
		*
		* The schema needs to be on the list of exposed schemas inside Supabase.
		*
		* @param schema - The schema to query
		*/
		schema(schema) {
			return this.rest.schema(schema);
		}
		/**
		* Perform a function call.
		*
		* @param fn - The function name to call
		* @param args - The arguments to pass to the function call
		* @param options - Named parameters
		* @param options.head - When set to `true`, `data` will not be returned.
		* Useful if you only need the count.
		* @param options.get - When set to `true`, the function will be called with
		* read-only access mode.
		* @param options.count - Count algorithm to use to count rows returned by the
		* function. Only applicable for [set-returning
		* functions](https://www.postgresql.org/docs/current/functions-srf.html).
		*
		* `"exact"`: Exact but slow count algorithm. Performs a `COUNT(*)` under the
		* hood.
		*
		* `"planned"`: Approximated but fast count algorithm. Uses the Postgres
		* statistics under the hood.
		*
		* `"estimated"`: Uses exact count for low numbers and planned count for high
		* numbers.
		*/
		rpc(fn, args = {}, options = {
			head: false,
			get: false,
			count: void 0
		}) {
			return this.rest.rpc(fn, args, options);
		}
		/**
		* Creates a Realtime channel with Broadcast, Presence, and Postgres Changes.
		*
		* @param {string} name - The name of the Realtime channel.
		* @param {Object} opts - The options to pass to the Realtime channel.
		*
		* @category Realtime
		*/
		channel(name, opts = { config: {} }) {
			return this.realtime.channel(name, opts);
		}
		/**
		* Returns all Realtime channels.
		*
		* @category Realtime
		*
		* @example Get all channels
		* ```js
		* const channels = supabase.getChannels()
		* ```
		*/
		getChannels() {
			return this.realtime.getChannels();
		}
		/**
		* Unsubscribes and removes Realtime channel from Realtime client.
		*
		* @param {RealtimeChannel} channel - The name of the Realtime channel.
		*
		*
		* @category Realtime
		*
		* @remarks
		* - Removing a channel is a great way to maintain the performance of your project's Realtime service as well as your database if you're listening to Postgres changes. Supabase will automatically handle cleanup 30 seconds after a client is disconnected, but unused channels may cause degradation as more clients are simultaneously subscribed.
		*
		* @example Removes a channel
		* ```js
		* supabase.removeChannel(myChannel)
		* ```
		*/
		removeChannel(channel) {
			return this.realtime.removeChannel(channel);
		}
		/**
		* Unsubscribes and removes all Realtime channels from Realtime client.
		*
		* @category Realtime
		*
		* @remarks
		* - Removing channels is a great way to maintain the performance of your project's Realtime service as well as your database if you're listening to Postgres changes. Supabase will automatically handle cleanup 30 seconds after a client is disconnected, but unused channels may cause degradation as more clients are simultaneously subscribed.
		*
		* @example Remove all channels
		* ```js
		* supabase.removeAllChannels()
		* ```
		*/
		removeAllChannels() {
			return this.realtime.removeAllChannels();
		}
		async _getAccessToken() {
			var _this = this;
			var _data$session$access_, _data$session;
			if (_this.accessToken) return await _this.accessToken();
			const { data } = await _this.auth.getSession();
			return (_data$session$access_ = (_data$session = data.session) === null || _data$session === void 0 ? void 0 : _data$session.access_token) !== null && _data$session$access_ !== void 0 ? _data$session$access_ : _this.supabaseKey;
		}
		_initSupabaseAuthClient({ autoRefreshToken, persistSession, detectSessionInUrl, storage, userStorage, storageKey, flowType, lock, debug, throwOnError, experimental, lockAcquireTimeout, skipAutoInitialize }, headers, fetch$1) {
			const authHeaders = {
				Authorization: `Bearer ${this.supabaseKey}`,
				apikey: `${this.supabaseKey}`
			};
			return new SupabaseAuthClient({
				url: this.authUrl.href,
				headers: _objectSpread2(_objectSpread2({}, authHeaders), headers),
				storageKey,
				autoRefreshToken,
				persistSession,
				detectSessionInUrl,
				storage,
				userStorage,
				flowType,
				lock,
				debug,
				throwOnError,
				experimental,
				fetch: fetch$1,
				lockAcquireTimeout,
				skipAutoInitialize,
				hasCustomAuthorizationHeader: Object.keys(this.headers).some((key) => key.toLowerCase() === "authorization")
			});
		}
		_initRealtimeClient(options) {
			return new __supabase_realtime_js.RealtimeClient(this.realtimeUrl.href, _objectSpread2(_objectSpread2({}, options), {}, { params: _objectSpread2(_objectSpread2({}, { apikey: this.supabaseKey }), options === null || options === void 0 ? void 0 : options.params) }));
		}
		_listenForAuthEvents() {
			return this.auth.onAuthStateChange((event, session) => {
				this._handleTokenChanged(event, "CLIENT", session === null || session === void 0 ? void 0 : session.access_token);
			});
		}
		_handleTokenChanged(event, source, token) {
			if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN") && this.changedAccessToken !== token) {
				this.changedAccessToken = token;
				this.realtime.setAuth(token);
			} else if (event === "SIGNED_OUT") {
				this.realtime.setAuth();
				if (source == "STORAGE") this.auth.signOut();
				this.changedAccessToken = void 0;
			}
		}
	};
	/**
	* Creates a new Supabase Client.
	*
	* @example Creating a Supabase client
	* ```ts
	* import { createClient } from '@supabase/supabase-js'
	*
	* const supabase = createClient('https://xyzcompany.supabase.co', 'your-publishable-key')
	* const { data, error } = await supabase.from('profiles').select('*')
	* ```
	*/
	const createClient = (supabaseUrl, supabaseKey, options) => {
		return new SupabaseClient(supabaseUrl, supabaseKey, options);
	};
	function shouldShowDeprecationWarning() {
		if (typeof window !== "undefined") return false;
		const _process = globalThis["process"];
		if (!_process) return false;
		const processVersion = _process["version"];
		if (processVersion === void 0 || processVersion === null) return false;
		const versionMatch = processVersion.match(/^v(\d+)\./);
		if (!versionMatch) return false;
		return parseInt(versionMatch[1], 10) <= 18;
	}
	if (shouldShowDeprecationWarning()) console.warn("⚠️  Node.js 18 and below are deprecated and will no longer be supported in future versions of @supabase/supabase-js. Please upgrade to Node.js 20 or later. For more information, visit: https://github.com/orgs/supabase/discussions/37217");
	Object.defineProperty(exports, "FunctionRegion", {
		enumerable: true,
		get: function() {
			return __supabase_functions_js.FunctionRegion;
		}
	});
	Object.defineProperty(exports, "FunctionsError", {
		enumerable: true,
		get: function() {
			return __supabase_functions_js.FunctionsError;
		}
	});
	Object.defineProperty(exports, "FunctionsFetchError", {
		enumerable: true,
		get: function() {
			return __supabase_functions_js.FunctionsFetchError;
		}
	});
	Object.defineProperty(exports, "FunctionsHttpError", {
		enumerable: true,
		get: function() {
			return __supabase_functions_js.FunctionsHttpError;
		}
	});
	Object.defineProperty(exports, "FunctionsRelayError", {
		enumerable: true,
		get: function() {
			return __supabase_functions_js.FunctionsRelayError;
		}
	});
	Object.defineProperty(exports, "PostgrestError", {
		enumerable: true,
		get: function() {
			return __supabase_postgrest_js.PostgrestError;
		}
	});
	Object.defineProperty(exports, "StorageApiError", {
		enumerable: true,
		get: function() {
			return __supabase_storage_js.StorageApiError;
		}
	});
	exports.SupabaseClient = SupabaseClient;
	exports.createClient = createClient;
	Object.keys(__supabase_auth_js).forEach(function(k) {
		if (k !== "default" && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
			enumerable: true,
			get: function() {
				return __supabase_auth_js[k];
			}
		});
	});
	Object.keys(__supabase_realtime_js).forEach(function(k) {
		if (k !== "default" && !Object.prototype.hasOwnProperty.call(exports, k)) Object.defineProperty(exports, k, {
			enumerable: true,
			get: function() {
				return __supabase_realtime_js[k];
			}
		});
	});
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/version.js
var require_version = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.VERSION = void 0;
	exports.VERSION = "0.10.3";
}));
//#endregion
//#region ../../node_modules/cookie/dist/index.js
var require_dist = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.parseCookie = parseCookie;
	exports.parse = parseCookie;
	exports.stringifyCookie = stringifyCookie;
	exports.stringifySetCookie = stringifySetCookie;
	exports.serialize = stringifySetCookie;
	exports.parseSetCookie = parseSetCookie;
	exports.stringifySetCookie = stringifySetCookie;
	exports.serialize = stringifySetCookie;
	/**
	* RegExp to match cookie-name in RFC 6265 sec 4.1.1
	* This refers out to the obsoleted definition of token in RFC 2616 sec 2.2
	* which has been replaced by the token definition in RFC 7230 appendix B.
	*
	* cookie-name       = token
	* token             = 1*tchar
	* tchar             = "!" / "#" / "$" / "%" / "&" / "'" /
	*                     "*" / "+" / "-" / "." / "^" / "_" /
	*                     "`" / "|" / "~" / DIGIT / ALPHA
	*
	* Note: Allowing more characters - https://github.com/jshttp/cookie/issues/191
	* Allow same range as cookie value, except `=`, which delimits end of name.
	*/
	const cookieNameRegExp = /^[\u0021-\u003A\u003C\u003E-\u007E]+$/;
	/**
	* RegExp to match cookie-value in RFC 6265 sec 4.1.1
	*
	* cookie-value      = *cookie-octet / ( DQUOTE *cookie-octet DQUOTE )
	* cookie-octet      = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E
	*                     ; US-ASCII characters excluding CTLs,
	*                     ; whitespace DQUOTE, comma, semicolon,
	*                     ; and backslash
	*
	* Allowing more characters: https://github.com/jshttp/cookie/issues/191
	* Comma, backslash, and DQUOTE are not part of the parsing algorithm.
	*/
	const cookieValueRegExp = /^[\u0021-\u003A\u003C-\u007E]*$/;
	/**
	* RegExp to match domain-value in RFC 6265 sec 4.1.1
	*
	* domain-value      = <subdomain>
	*                     ; defined in [RFC1034], Section 3.5, as
	*                     ; enhanced by [RFC1123], Section 2.1
	* <subdomain>       = <label> | <subdomain> "." <label>
	* <label>           = <let-dig> [ [ <ldh-str> ] <let-dig> ]
	*                     Labels must be 63 characters or less.
	*                     'let-dig' not 'letter' in the first char, per RFC1123
	* <ldh-str>         = <let-dig-hyp> | <let-dig-hyp> <ldh-str>
	* <let-dig-hyp>     = <let-dig> | "-"
	* <let-dig>         = <letter> | <digit>
	* <letter>          = any one of the 52 alphabetic characters A through Z in
	*                     upper case and a through z in lower case
	* <digit>           = any one of the ten digits 0 through 9
	*
	* Keep support for leading dot: https://github.com/jshttp/cookie/issues/173
	*
	* > (Note that a leading %x2E ("."), if present, is ignored even though that
	* character is not permitted, but a trailing %x2E ("."), if present, will
	* cause the user agent to ignore the attribute.)
	*/
	const domainValueRegExp = /^([.]?[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
	/**
	* RegExp to match path-value in RFC 6265 sec 4.1.1
	*
	* path-value        = <any CHAR except CTLs or ";">
	* CHAR              = %x01-7F
	*                     ; defined in RFC 5234 appendix B.1
	*/
	const pathValueRegExp = /^[\u0020-\u003A\u003D-\u007E]*$/;
	/**
	* RegExp to match max-age-value in RFC 6265 sec 5.6.2
	*/
	const maxAgeRegExp = /^-?\d+$/;
	const __toString = Object.prototype.toString;
	const NullObject = /* @__PURE__ */ (() => {
		const C = function() {};
		C.prototype = Object.create(null);
		return C;
	})();
	/**
	* Parse a `Cookie` header.
	*
	* Parse the given cookie header string into an object
	* The object has the various cookies as keys(names) => values
	*/
	function parseCookie(str, options) {
		const obj = new NullObject();
		const len = str.length;
		if (len < 2) return obj;
		const dec = options?.decode || decode;
		let index = 0;
		do {
			const eqIdx = eqIndex(str, index, len);
			if (eqIdx === -1) break;
			const endIdx = endIndex(str, index, len);
			if (eqIdx > endIdx) {
				index = str.lastIndexOf(";", eqIdx - 1) + 1;
				continue;
			}
			const key = valueSlice(str, index, eqIdx);
			if (obj[key] === void 0) obj[key] = dec(valueSlice(str, eqIdx + 1, endIdx));
			index = endIdx + 1;
		} while (index < len);
		return obj;
	}
	/**
	* Stringifies an object into an HTTP `Cookie` header.
	*/
	function stringifyCookie(cookie, options) {
		const enc = options?.encode || encodeURIComponent;
		const cookieStrings = [];
		for (const name of Object.keys(cookie)) {
			const val = cookie[name];
			if (val === void 0) continue;
			if (!cookieNameRegExp.test(name)) throw new TypeError(`cookie name is invalid: ${name}`);
			const value = enc(val);
			if (!cookieValueRegExp.test(value)) throw new TypeError(`cookie val is invalid: ${val}`);
			cookieStrings.push(`${name}=${value}`);
		}
		return cookieStrings.join("; ");
	}
	function stringifySetCookie(_name, _val, _opts) {
		const cookie = typeof _name === "object" ? _name : {
			..._opts,
			name: _name,
			value: String(_val)
		};
		const enc = (typeof _val === "object" ? _val : _opts)?.encode || encodeURIComponent;
		if (!cookieNameRegExp.test(cookie.name)) throw new TypeError(`argument name is invalid: ${cookie.name}`);
		const value = cookie.value ? enc(cookie.value) : "";
		if (!cookieValueRegExp.test(value)) throw new TypeError(`argument val is invalid: ${cookie.value}`);
		let str = cookie.name + "=" + value;
		if (cookie.maxAge !== void 0) {
			if (!Number.isInteger(cookie.maxAge)) throw new TypeError(`option maxAge is invalid: ${cookie.maxAge}`);
			str += "; Max-Age=" + cookie.maxAge;
		}
		if (cookie.domain) {
			if (!domainValueRegExp.test(cookie.domain)) throw new TypeError(`option domain is invalid: ${cookie.domain}`);
			str += "; Domain=" + cookie.domain;
		}
		if (cookie.path) {
			if (!pathValueRegExp.test(cookie.path)) throw new TypeError(`option path is invalid: ${cookie.path}`);
			str += "; Path=" + cookie.path;
		}
		if (cookie.expires) {
			if (!isDate(cookie.expires) || !Number.isFinite(cookie.expires.valueOf())) throw new TypeError(`option expires is invalid: ${cookie.expires}`);
			str += "; Expires=" + cookie.expires.toUTCString();
		}
		if (cookie.httpOnly) str += "; HttpOnly";
		if (cookie.secure) str += "; Secure";
		if (cookie.partitioned) str += "; Partitioned";
		if (cookie.priority) switch (typeof cookie.priority === "string" ? cookie.priority.toLowerCase() : void 0) {
			case "low":
				str += "; Priority=Low";
				break;
			case "medium":
				str += "; Priority=Medium";
				break;
			case "high":
				str += "; Priority=High";
				break;
			default: throw new TypeError(`option priority is invalid: ${cookie.priority}`);
		}
		if (cookie.sameSite) switch (typeof cookie.sameSite === "string" ? cookie.sameSite.toLowerCase() : cookie.sameSite) {
			case true:
			case "strict":
				str += "; SameSite=Strict";
				break;
			case "lax":
				str += "; SameSite=Lax";
				break;
			case "none":
				str += "; SameSite=None";
				break;
			default: throw new TypeError(`option sameSite is invalid: ${cookie.sameSite}`);
		}
		return str;
	}
	/**
	* Deserialize a `Set-Cookie` header into an object.
	*
	* deserialize('foo=bar; httpOnly')
	*   => { name: 'foo', value: 'bar', httpOnly: true }
	*/
	function parseSetCookie(str, options) {
		const dec = options?.decode || decode;
		const len = str.length;
		const endIdx = endIndex(str, 0, len);
		const eqIdx = eqIndex(str, 0, endIdx);
		const setCookie = eqIdx === -1 ? {
			name: "",
			value: dec(valueSlice(str, 0, endIdx))
		} : {
			name: valueSlice(str, 0, eqIdx),
			value: dec(valueSlice(str, eqIdx + 1, endIdx))
		};
		let index = endIdx + 1;
		while (index < len) {
			const endIdx = endIndex(str, index, len);
			const eqIdx = eqIndex(str, index, endIdx);
			const attr = eqIdx === -1 ? valueSlice(str, index, endIdx) : valueSlice(str, index, eqIdx);
			const val = eqIdx === -1 ? void 0 : valueSlice(str, eqIdx + 1, endIdx);
			switch (attr.toLowerCase()) {
				case "httponly":
					setCookie.httpOnly = true;
					break;
				case "secure":
					setCookie.secure = true;
					break;
				case "partitioned":
					setCookie.partitioned = true;
					break;
				case "domain":
					setCookie.domain = val;
					break;
				case "path":
					setCookie.path = val;
					break;
				case "max-age":
					if (val && maxAgeRegExp.test(val)) setCookie.maxAge = Number(val);
					break;
				case "expires":
					if (!val) break;
					const date = new Date(val);
					if (Number.isFinite(date.valueOf())) setCookie.expires = date;
					break;
				case "priority":
					if (!val) break;
					const priority = val.toLowerCase();
					if (priority === "low" || priority === "medium" || priority === "high") setCookie.priority = priority;
					break;
				case "samesite":
					if (!val) break;
					const sameSite = val.toLowerCase();
					if (sameSite === "lax" || sameSite === "strict" || sameSite === "none") setCookie.sameSite = sameSite;
					break;
			}
			index = endIdx + 1;
		}
		return setCookie;
	}
	/**
	* Find the `;` character between `min` and `len` in str.
	*/
	function endIndex(str, min, len) {
		const index = str.indexOf(";", min);
		return index === -1 ? len : index;
	}
	/**
	* Find the `=` character between `min` and `max` in str.
	*/
	function eqIndex(str, min, max) {
		const index = str.indexOf("=", min);
		return index < max ? index : -1;
	}
	/**
	* Slice out a value between startPod to max.
	*/
	function valueSlice(str, min, max) {
		let start = min;
		let end = max;
		do {
			const code = str.charCodeAt(start);
			if (code !== 32 && code !== 9) break;
		} while (++start < end);
		while (end > start) {
			const code = str.charCodeAt(end - 1);
			if (code !== 32 && code !== 9) break;
			end--;
		}
		return str.slice(start, end);
	}
	/**
	* URL-decode string value. Optimized to skip native call when no %.
	*/
	function decode(str) {
		if (str.indexOf("%") === -1) return str;
		try {
			return decodeURIComponent(str);
		} catch (e) {
			return str;
		}
	}
	/**
	* Determine if value is a Date.
	*/
	function isDate(val) {
		return __toString.call(val) === "[object Date]";
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/utils/helpers.js
var require_helpers = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
		Object.defineProperty(o, "default", {
			enumerable: true,
			value: v
		});
	}) : function(o, v) {
		o["default"] = v;
	});
	var __importStar = exports && exports.__importStar || function(mod) {
		if (mod && mod.__esModule) return mod;
		var result = {};
		if (mod != null) {
			for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
		}
		__setModuleDefault(result, mod);
		return result;
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.serialize = exports.parse = void 0;
	exports.parseCookieHeader = parseCookieHeader;
	exports.serializeCookieHeader = serializeCookieHeader;
	exports.isBrowser = isBrowser;
	exports.memoryLocalStorageAdapter = memoryLocalStorageAdapter;
	const cookie = __importStar(require_dist());
	/**
	* @deprecated Since v0.4.0: Please use {@link parseCookieHeader}. `parse` will
	* not be available for import starting v1.0.0 of `@supabase/ssr`.
	*/
	exports.parse = cookie.parse;
	/**
	* @deprecated Since v0.4.0: Please use {@link serializeCookieHeader}.
	* `serialize` will not be available for import starting v1.0.0 of
	* `@supabase/ssr`.
	*/
	exports.serialize = cookie.serialize;
	/**
	* Parses the `Cookie` HTTP header into an array of cookie name-value objects.
	*
	* @param header The `Cookie` HTTP header. Decodes cookie names and values from
	* URI encoding first.
	*/
	function parseCookieHeader(header) {
		const parsed = cookie.parse(header);
		return Object.keys(parsed ?? {}).map((name) => ({
			name,
			value: parsed[name]
		}));
	}
	/**
	* Converts the arguments to a valid `Set-Cookie` header. Non US-ASCII chars
	* and other forbidden cookie chars will be URI encoded.
	*
	* @param name Name of cookie.
	* @param value Value of cookie.
	*/
	function serializeCookieHeader(name, value, options) {
		return cookie.serialize(name, value, options);
	}
	function isBrowser() {
		return typeof window !== "undefined" && typeof window.document !== "undefined";
	}
	/**
	* Returns a localStorage-like object that stores the key-value pairs in
	* memory.
	*/
	function memoryLocalStorageAdapter(store = {}) {
		return {
			getItem: (key) => {
				return store[key] || null;
			},
			setItem: (key, value) => {
				store[key] = value;
			},
			removeItem: (key) => {
				delete store[key];
			}
		};
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/utils/constants.js
var require_constants = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.DEFAULT_COOKIE_OPTIONS = void 0;
	exports.DEFAULT_COOKIE_OPTIONS = {
		path: "/",
		sameSite: "lax",
		httpOnly: false,
		maxAge: 400 * 24 * 60 * 60
	};
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/utils/chunker.js
var require_chunker = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.MAX_CHUNK_SIZE = void 0;
	exports.isChunkLike = isChunkLike;
	exports.createChunks = createChunks;
	exports.combineChunks = combineChunks;
	exports.deleteChunks = deleteChunks;
	exports.MAX_CHUNK_SIZE = 3180;
	const CHUNK_LIKE_REGEX = /^(.*)[.](0|[1-9][0-9]*)$/;
	function isChunkLike(cookieName, key) {
		if (cookieName === key) return true;
		const chunkLike = cookieName.match(CHUNK_LIKE_REGEX);
		if (chunkLike && chunkLike[1] === key) return true;
		return false;
	}
	/**
	* create chunks from a string and return an array of object
	*/
	function createChunks(key, value, chunkSize) {
		const resolvedChunkSize = chunkSize ?? exports.MAX_CHUNK_SIZE;
		let encodedValue = encodeURIComponent(value);
		if (encodedValue.length <= resolvedChunkSize) return [{
			name: key,
			value
		}];
		const chunks = [];
		while (encodedValue.length > 0) {
			let encodedChunkHead = encodedValue.slice(0, resolvedChunkSize);
			const lastEscapePos = encodedChunkHead.lastIndexOf("%");
			if (lastEscapePos > resolvedChunkSize - 3) encodedChunkHead = encodedChunkHead.slice(0, lastEscapePos);
			let valueHead = "";
			while (encodedChunkHead.length > 0) try {
				valueHead = decodeURIComponent(encodedChunkHead);
				break;
			} catch (error) {
				if (error instanceof URIError && encodedChunkHead.at(-3) === "%" && encodedChunkHead.length > 3) encodedChunkHead = encodedChunkHead.slice(0, encodedChunkHead.length - 3);
				else throw error;
			}
			chunks.push(valueHead);
			encodedValue = encodedValue.slice(encodedChunkHead.length);
		}
		return chunks.map((value, i) => ({
			name: `${key}.${i}`,
			value
		}));
	}
	async function combineChunks(key, retrieveChunk) {
		const value = await retrieveChunk(key);
		if (value) return value;
		let values = [];
		for (let i = 0;; i++) {
			const chunk = await retrieveChunk(`${key}.${i}`);
			if (!chunk) break;
			values.push(chunk);
		}
		if (values.length > 0) return values.join("");
		return null;
	}
	async function deleteChunks(key, retrieveChunk, removeChunk) {
		if (await retrieveChunk(key)) await removeChunk(key);
		for (let i = 0;; i++) {
			const chunkName = `${key}.${i}`;
			if (!await retrieveChunk(chunkName)) break;
			await removeChunk(chunkName);
		}
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/utils/base64url.js
var require_base64url = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Avoid modifying this file. It's part of
	* https://github.com/supabase-community/base64url-js.  Submit all fixes on
	* that repo!
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.stringToBase64URL = stringToBase64URL;
	exports.stringFromBase64URL = stringFromBase64URL;
	exports.codepointToUTF8 = codepointToUTF8;
	exports.stringToUTF8 = stringToUTF8;
	exports.stringFromUTF8 = stringFromUTF8;
	/**
	* An array of characters that encode 6 bits into a Base64-URL alphabet
	* character.
	*/
	const TO_BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".split("");
	/**
	* An array of characters that can appear in a Base64-URL encoded string but
	* should be ignored.
	*/
	const IGNORE_BASE64URL = " 	\n\r=".split("");
	/**
	* An array of 128 numbers that map a Base64-URL character to 6 bits, or if -2
	* used to skip the character, or if -1 used to error out.
	*/
	const FROM_BASE64URL = (() => {
		const charMap = new Array(128);
		for (let i = 0; i < charMap.length; i += 1) charMap[i] = -1;
		for (let i = 0; i < IGNORE_BASE64URL.length; i += 1) charMap[IGNORE_BASE64URL[i].charCodeAt(0)] = -2;
		for (let i = 0; i < TO_BASE64URL.length; i += 1) charMap[TO_BASE64URL[i].charCodeAt(0)] = i;
		return charMap;
	})();
	/**
	* Converts a JavaScript string (which may include any valid character) into a
	* Base64-URL encoded string. The string is first encoded in UTF-8 which is
	* then encoded as Base64-URL.
	*
	* @param str The string to convert.
	*/
	function stringToBase64URL(str) {
		const base64 = [];
		let queue = 0;
		let queuedBits = 0;
		const emitter = (byte) => {
			queue = queue << 8 | byte;
			queuedBits += 8;
			while (queuedBits >= 6) {
				const pos = queue >> queuedBits - 6 & 63;
				base64.push(TO_BASE64URL[pos]);
				queuedBits -= 6;
			}
		};
		stringToUTF8(str, emitter);
		if (queuedBits > 0) {
			queue = queue << 6 - queuedBits;
			queuedBits = 6;
			while (queuedBits >= 6) {
				const pos = queue >> queuedBits - 6 & 63;
				base64.push(TO_BASE64URL[pos]);
				queuedBits -= 6;
			}
		}
		return base64.join("");
	}
	/**
	* Converts a Base64-URL encoded string into a JavaScript string. It is assumed
	* that the underlying string has been encoded as UTF-8.
	*
	* @param str The Base64-URL encoded string.
	*/
	function stringFromBase64URL(str) {
		const conv = [];
		const emit = (codepoint) => {
			conv.push(String.fromCodePoint(codepoint));
		};
		const state = {
			utf8seq: 0,
			codepoint: 0
		};
		let queue = 0;
		let queuedBits = 0;
		for (let i = 0; i < str.length; i += 1) {
			const codepoint = str.charCodeAt(i);
			const bits = FROM_BASE64URL[codepoint];
			if (bits > -1) {
				queue = queue << 6 | bits;
				queuedBits += 6;
				while (queuedBits >= 8) {
					stringFromUTF8(queue >> queuedBits - 8 & 255, state, emit);
					queuedBits -= 8;
				}
			} else if (bits === -2) continue;
			else throw new Error(`Invalid Base64-URL character "${str.at(i)}" at position ${i}`);
		}
		return conv.join("");
	}
	/**
	* Converts a Unicode codepoint to a multi-byte UTF-8 sequence.
	*
	* @param codepoint The Unicode codepoint.
	* @param emit      Function which will be called for each UTF-8 byte that represents the codepoint.
	*/
	function codepointToUTF8(codepoint, emit) {
		if (codepoint <= 127) {
			emit(codepoint);
			return;
		} else if (codepoint <= 2047) {
			emit(192 | codepoint >> 6);
			emit(128 | codepoint & 63);
			return;
		} else if (codepoint <= 65535) {
			emit(224 | codepoint >> 12);
			emit(128 | codepoint >> 6 & 63);
			emit(128 | codepoint & 63);
			return;
		} else if (codepoint <= 1114111) {
			emit(240 | codepoint >> 18);
			emit(128 | codepoint >> 12 & 63);
			emit(128 | codepoint >> 6 & 63);
			emit(128 | codepoint & 63);
			return;
		}
		throw new Error(`Unrecognized Unicode codepoint: ${codepoint.toString(16)}`);
	}
	/**
	* Converts a JavaScript string to a sequence of UTF-8 bytes.
	*
	* @param str  The string to convert to UTF-8.
	* @param emit Function which will be called for each UTF-8 byte of the string.
	*/
	function stringToUTF8(str, emit) {
		for (let i = 0; i < str.length; i += 1) {
			let codepoint = str.charCodeAt(i);
			if (codepoint > 55295 && codepoint <= 56319) {
				const highSurrogate = (codepoint - 55296) * 1024 & 65535;
				codepoint = (str.charCodeAt(i + 1) - 56320 & 65535 | highSurrogate) + 65536;
				i += 1;
			}
			codepointToUTF8(codepoint, emit);
		}
	}
	/**
	* Converts a UTF-8 byte to a Unicode codepoint.
	*
	* @param byte  The UTF-8 byte next in the sequence.
	* @param state The shared state between consecutive UTF-8 bytes in the
	*              sequence, an object with the shape `{ utf8seq: 0, codepoint: 0 }`.
	* @param emit  Function which will be called for each codepoint.
	*/
	function stringFromUTF8(byte, state, emit) {
		if (state.utf8seq === 0) {
			if (byte <= 127) {
				emit(byte);
				return;
			}
			for (let leadingBit = 1; leadingBit < 6; leadingBit += 1) if ((byte >> 7 - leadingBit & 1) === 0) {
				state.utf8seq = leadingBit;
				break;
			}
			if (state.utf8seq === 2) state.codepoint = byte & 31;
			else if (state.utf8seq === 3) state.codepoint = byte & 15;
			else if (state.utf8seq === 4) state.codepoint = byte & 7;
			else throw new Error("Invalid UTF-8 sequence");
			state.utf8seq -= 1;
		} else if (state.utf8seq > 0) {
			if (byte <= 127) throw new Error("Invalid UTF-8 sequence");
			state.codepoint = state.codepoint << 6 | byte & 63;
			state.utf8seq -= 1;
			if (state.utf8seq === 0) emit(state.codepoint);
		}
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/utils/index.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$2) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$2, p)) __createBinding(exports$2, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	__exportStar(require_helpers(), exports);
	__exportStar(require_constants(), exports);
	__exportStar(require_chunker(), exports);
	__exportStar(require_base64url(), exports);
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/cookies.js
var require_cookies = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.createStorageFromOptions = createStorageFromOptions;
	exports.applyServerStorage = applyServerStorage;
	const cookie_1 = require_dist();
	const utils_1 = require_utils();
	const BASE64_PREFIX = "base64-";
	/**
	* Decodes a chunked cookie value that may carry the `base64-` prefix written
	* by this module. When the prefix is present, the underlying payload is always
	* JSON encoded by auth-js (`setItemAsync` runs `JSON.stringify` on every
	* write). If the decoded value cannot be parsed as JSON, the chunks are
	* mismatched (e.g. a partial cookie write left the browser holding a mix of
	* old and new generations) and we treat the entry as absent so the SDK does
	* not propagate or re-save the corrupted payload.
	*/
	function decodeChunkedCookieValue(value) {
		if (!value.startsWith(BASE64_PREFIX)) return value;
		let decoded;
		try {
			decoded = (0, utils_1.stringFromBase64URL)(value.substring(7));
		} catch (error) {
			console.warn("@supabase/ssr: could not base64url-decode chunked cookie value, treating as absent. Cookie chunks may have been written partially across responses.", error);
			return null;
		}
		try {
			JSON.parse(decoded);
		} catch {
			console.warn("@supabase/ssr: chunked cookie decoded to invalid JSON, treating as absent. This usually indicates that cookie chunks from different writes were combined (e.g. response committed before all Set-Cookie headers were sent).");
			return null;
		}
		return decoded;
	}
	/**
	* Creates a storage client that handles cookies correctly for browser and
	* server clients with or without properly provided cookie methods.
	*
	* @param options The options passed to createBrowserClient or createServer client.
	*
	* @param isServerClient Whether it's called from createServerClient.
	*/
	function createStorageFromOptions(options, isServerClient) {
		const cookies = options.cookies ?? null;
		const cookieEncoding = options.cookieEncoding;
		const setItems = {};
		const removedItems = {};
		let getAll;
		let setAll;
		const documentCookieGetAll = () => {
			const parsed = (0, cookie_1.parse)(document.cookie);
			return Object.keys(parsed).map((name) => ({
				name,
				value: parsed[name] ?? ""
			}));
		};
		const documentCookieSetAll = (setCookies) => {
			setCookies.forEach(({ name, value, options }) => {
				document.cookie = (0, cookie_1.serialize)(name, value, options);
			});
		};
		if (cookies) if ("get" in cookies) {
			const getWithHints = async (keyHints) => {
				const chunkNames = keyHints.flatMap((keyHint) => [keyHint, ...Array.from({ length: 5 }).map((_, i) => `${keyHint}.${i}`)]);
				const chunks = [];
				for (let i = 0; i < chunkNames.length; i += 1) {
					const value = await cookies.get(chunkNames[i]);
					if (!value && typeof value !== "string") continue;
					chunks.push({
						name: chunkNames[i],
						value
					});
				}
				return chunks;
			};
			getAll = async (keyHints) => await getWithHints(keyHints);
			if ("set" in cookies && "remove" in cookies) setAll = async (setCookies) => {
				for (let i = 0; i < setCookies.length; i += 1) {
					const { name, value, options } = setCookies[i];
					if (value) await cookies.set(name, value, options);
					else await cookies.remove(name, options);
				}
			};
			else if (isServerClient) setAll = async () => {
				console.warn("@supabase/ssr: createServerClient was configured without set and remove cookie methods, but the client needs to set cookies. This can lead to issues such as random logouts, early session termination or increased token refresh requests. If in NextJS, check your middleware.ts file, route handlers and server actions for correctness. Consider switching to the getAll and setAll cookie methods instead of get, set and remove which are deprecated and can be difficult to use correctly.");
			};
			else throw new Error("@supabase/ssr: createBrowserClient requires configuring a getAll and setAll cookie method (deprecated: alternatively both get, set and remove can be used)");
		} else if ("getAll" in cookies) {
			getAll = async () => await cookies.getAll();
			if ("setAll" in cookies) setAll = cookies.setAll;
			else if (isServerClient) setAll = async () => {
				console.warn("@supabase/ssr: createServerClient was configured without the setAll cookie method, but the client needs to set cookies. This can lead to issues such as random logouts, early session termination or increased token refresh requests. If in NextJS, check your middleware.ts file, route handlers and server actions for correctness.");
			};
			else throw new Error("@supabase/ssr: createBrowserClient requires configuring both getAll and setAll cookie methods (deprecated: alternatively both get, set and remove can be used)");
		} else if (!isServerClient && (0, utils_1.isBrowser)()) {
			getAll = () => documentCookieGetAll();
			setAll = documentCookieSetAll;
		} else throw new Error(`@supabase/ssr: ${isServerClient ? "createServerClient" : "createBrowserClient"} requires configuring getAll and setAll cookie methods (deprecated: alternatively use get, set and remove).${(0, utils_1.isBrowser)() ? " As this is called in a browser runtime, consider removing the cookies option object to use the document.cookie API automatically." : ""}`);
		else if (!isServerClient && (0, utils_1.isBrowser)()) {
			getAll = () => documentCookieGetAll();
			setAll = documentCookieSetAll;
		} else if (isServerClient) throw new Error("@supabase/ssr: createServerClient must be initialized with cookie options that specify getAll and setAll functions (deprecated, not recommended: alternatively use get, set and remove)");
		else {
			getAll = () => {
				return [];
			};
			setAll = () => {
				throw new Error("@supabase/ssr: createBrowserClient in non-browser runtimes (including Next.js pre-rendering mode) was not initialized cookie options that specify getAll and setAll functions (deprecated: alternatively use get, set and remove), but they were needed");
			};
		}
		if (!isServerClient) return {
			getAll,
			setAll,
			setItems,
			removedItems,
			storage: {
				isServer: false,
				getItem: async (key) => {
					const allCookies = await getAll([key]);
					const chunkedCookie = await (0, utils_1.combineChunks)(key, async (chunkName) => {
						const cookie = allCookies?.find(({ name }) => name === chunkName) || null;
						if (!cookie) return null;
						return cookie.value;
					});
					if (!chunkedCookie) return null;
					return decodeChunkedCookieValue(chunkedCookie);
				},
				setItem: async (key, value) => {
					const cookieNames = (await getAll([key]))?.map(({ name }) => name) || [];
					const removeCookies = new Set(cookieNames.filter((name) => (0, utils_1.isChunkLike)(name, key)));
					let encoded = value;
					if (cookieEncoding === "base64url") encoded = BASE64_PREFIX + (0, utils_1.stringToBase64URL)(value);
					const setCookies = (0, utils_1.createChunks)(key, encoded);
					setCookies.forEach(({ name }) => {
						removeCookies.delete(name);
					});
					const removeCookieOptions = {
						...utils_1.DEFAULT_COOKIE_OPTIONS,
						...options?.cookieOptions,
						maxAge: 0
					};
					const setCookieOptions = {
						...utils_1.DEFAULT_COOKIE_OPTIONS,
						...options?.cookieOptions,
						maxAge: utils_1.DEFAULT_COOKIE_OPTIONS.maxAge
					};
					delete removeCookieOptions.name;
					delete setCookieOptions.name;
					const allToSet = [...[...removeCookies].map((name) => ({
						name,
						value: "",
						options: removeCookieOptions
					})), ...setCookies.map(({ name, value }) => ({
						name,
						value,
						options: setCookieOptions
					}))];
					if (allToSet.length > 0) await setAll(allToSet, {});
				},
				removeItem: async (key) => {
					const removeCookies = ((await getAll([key]))?.map(({ name }) => name) || []).filter((name) => (0, utils_1.isChunkLike)(name, key));
					const removeCookieOptions = {
						...utils_1.DEFAULT_COOKIE_OPTIONS,
						...options?.cookieOptions,
						maxAge: 0
					};
					delete removeCookieOptions.name;
					if (removeCookies.length > 0) await setAll(removeCookies.map((name) => ({
						name,
						value: "",
						options: removeCookieOptions
					})), {});
				}
			}
		};
		return {
			getAll,
			setAll,
			setItems,
			removedItems,
			storage: {
				isServer: true,
				getItem: async (key) => {
					if (typeof setItems[key] === "string") return setItems[key];
					if (removedItems[key]) return null;
					const allCookies = await getAll([key]);
					const chunkedCookie = await (0, utils_1.combineChunks)(key, async (chunkName) => {
						const cookie = allCookies?.find(({ name }) => name === chunkName) || null;
						if (!cookie) return null;
						return cookie.value;
					});
					if (!chunkedCookie) return null;
					if (typeof chunkedCookie !== "string") return chunkedCookie;
					return decodeChunkedCookieValue(chunkedCookie);
				},
				setItem: async (key, value) => {
					if (key.endsWith("-code-verifier")) await applyServerStorage({
						getAll,
						setAll,
						setItems: { [key]: value },
						removedItems: {}
					}, {
						cookieOptions: options?.cookieOptions ?? null,
						cookieEncoding
					});
					setItems[key] = value;
					delete removedItems[key];
				},
				removeItem: async (key) => {
					delete setItems[key];
					removedItems[key] = true;
				}
			}
		};
	}
	/**
	* When createServerClient needs to apply the created storage to cookies, it
	* should call this function which handles correcly setting cookies for stored
	* and removed items in the storage.
	*/
	async function applyServerStorage({ getAll, setAll, setItems, removedItems }, options) {
		const cookieEncoding = options.cookieEncoding;
		const cookieOptions = options.cookieOptions ?? null;
		const cookieNames = (await getAll([...setItems ? Object.keys(setItems) : [], ...removedItems ? Object.keys(removedItems) : []]))?.map(({ name }) => name) || [];
		const removeCookies = Object.keys(removedItems).flatMap((itemName) => {
			return cookieNames.filter((name) => (0, utils_1.isChunkLike)(name, itemName));
		});
		const setCookies = Object.keys(setItems).flatMap((itemName) => {
			const removeExistingCookiesForItem = new Set(cookieNames.filter((name) => (0, utils_1.isChunkLike)(name, itemName)));
			let encoded = setItems[itemName];
			if (cookieEncoding === "base64url") encoded = BASE64_PREFIX + (0, utils_1.stringToBase64URL)(encoded);
			const chunks = (0, utils_1.createChunks)(itemName, encoded);
			chunks.forEach((chunk) => {
				removeExistingCookiesForItem.delete(chunk.name);
			});
			removeCookies.push(...removeExistingCookiesForItem);
			return chunks;
		});
		const removeCookieOptions = {
			...utils_1.DEFAULT_COOKIE_OPTIONS,
			...cookieOptions,
			maxAge: 0
		};
		const setCookieOptions = {
			...utils_1.DEFAULT_COOKIE_OPTIONS,
			...cookieOptions,
			maxAge: utils_1.DEFAULT_COOKIE_OPTIONS.maxAge
		};
		delete removeCookieOptions.name;
		delete setCookieOptions.name;
		await setAll([...removeCookies.map((name) => ({
			name,
			value: "",
			options: removeCookieOptions
		})), ...setCookies.map(({ name, value }) => ({
			name,
			value,
			options: setCookieOptions
		}))], {
			"Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
			Expires: "0",
			Pragma: "no-cache"
		});
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/warnDeprecatedPackage.js
var require_warnDeprecatedPackage = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.warnIfUsingDeprecatedAuthHelpersPackage = warnIfUsingDeprecatedAuthHelpersPackage;
	let warned = false;
	const DEPRECATED_PACKAGES = [
		"@supabase/auth-helpers-nextjs",
		"@supabase/auth-helpers-react",
		"@supabase/auth-helpers-remix",
		"@supabase/auth-helpers-sveltekit"
	];
	function warnIfUsingDeprecatedAuthHelpersPackage() {
		if (warned) return;
		if (typeof process === "undefined" || !process.env?.npm_package_name) return;
		const packageName = process.env.npm_package_name;
		if (!DEPRECATED_PACKAGES.includes(packageName)) return;
		warned = true;
		console.warn(`
╔════════════════════════════════════════════════════════════════════════════╗
║ ⚠️  IMPORTANT: Package Consolidation Notice                                ║
║                                                                            ║
║ The ${packageName.padEnd(35)} package name is deprecated.  ║
║                                                                            ║
║ You are now using @supabase/ssr - a unified solution for all frameworks.  ║
║                                                                            ║
║ The auth-helpers packages have been consolidated into @supabase/ssr       ║
║ to provide better maintenance and consistent APIs across frameworks.      ║
║                                                                            ║
║ Please update your package.json to use @supabase/ssr directly:            ║
║   npm uninstall ${packageName.padEnd(42)} ║
║   npm install @supabase/ssr                                               ║
║                                                                            ║
║ For more information, visit:                                              ║
║ https://supabase.com/docs/guides/auth/server-side                         ║
╚════════════════════════════════════════════════════════════════════════════╝
    `);
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/createBrowserClient.js
var require_createBrowserClient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.createBrowserClient = createBrowserClient;
	const supabase_js_1 = require_dist$1();
	const version_1 = require_version();
	const utils_1 = require_utils();
	const cookies_1 = require_cookies();
	const warnDeprecatedPackage_1 = require_warnDeprecatedPackage();
	let cachedBrowserClient;
	function createBrowserClient(supabaseUrl, supabaseKey, options) {
		(0, warnDeprecatedPackage_1.warnIfUsingDeprecatedAuthHelpersPackage)();
		const shouldUseSingleton = options?.isSingleton === true || (!options || !("isSingleton" in options)) && (0, utils_1.isBrowser)();
		if (shouldUseSingleton && cachedBrowserClient) return cachedBrowserClient;
		if (!supabaseUrl || !supabaseKey) throw new Error(`@supabase/ssr: Your project's URL and API key are required to create a Supabase client!\n\nCheck your Supabase project's API settings to find these values\n\nhttps://supabase.com/dashboard/project/_/settings/api`);
		const { storage } = (0, cookies_1.createStorageFromOptions)({
			...options,
			cookieEncoding: options?.cookieEncoding ?? "base64url"
		}, false);
		const client = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey, {
			...options,
			global: {
				...options?.global,
				headers: {
					...options?.global?.headers,
					"X-Client-Info": `supabase-ssr/${version_1.VERSION} createBrowserClient`
				}
			},
			auth: {
				...options?.auth,
				...options?.cookieOptions?.name ? { storageKey: options.cookieOptions.name } : null,
				flowType: "pkce",
				autoRefreshToken: options?.auth?.autoRefreshToken ?? (0, utils_1.isBrowser)(),
				detectSessionInUrl: options?.auth?.detectSessionInUrl ?? (0, utils_1.isBrowser)(),
				persistSession: options?.auth?.persistSession ?? true,
				storage,
				...options?.cookies && "encode" in options.cookies && options.cookies.encode === "tokens-only" ? { userStorage: options?.auth?.userStorage ?? window.localStorage } : null
			}
		});
		if (shouldUseSingleton) cachedBrowserClient = client;
		return client;
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/createServerClient.js
var require_createServerClient = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.createServerClient = createServerClient;
	const supabase_js_1 = require_dist$1();
	const version_1 = require_version();
	const cookies_1 = require_cookies();
	const helpers_1 = require_helpers();
	const warnDeprecatedPackage_1 = require_warnDeprecatedPackage();
	function createServerClient(supabaseUrl, supabaseKey, options) {
		(0, warnDeprecatedPackage_1.warnIfUsingDeprecatedAuthHelpersPackage)();
		if (!supabaseUrl || !supabaseKey) throw new Error(`Your project's URL and Key are required to create a Supabase client!\n\nCheck your Supabase project's API settings to find these values\n\nhttps://supabase.com/dashboard/project/_/settings/api`);
		const { storage, getAll, setAll, setItems, removedItems } = (0, cookies_1.createStorageFromOptions)({
			...options,
			cookieEncoding: options?.cookieEncoding ?? "base64url"
		}, true);
		const client = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey, {
			...options,
			global: {
				...options?.global,
				headers: {
					...options?.global?.headers,
					"X-Client-Info": `supabase-ssr/${version_1.VERSION} createServerClient`
				}
			},
			auth: {
				...options?.cookieOptions?.name ? { storageKey: options.cookieOptions.name } : null,
				...options?.auth,
				flowType: "pkce",
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: true,
				skipAutoInitialize: true,
				storage,
				...options?.cookies && "encode" in options.cookies && options.cookies.encode === "tokens-only" ? { userStorage: options?.auth?.userStorage ?? (0, helpers_1.memoryLocalStorageAdapter)() } : null
			}
		});
		client.auth.onAuthStateChange(async (event) => {
			if ((Object.keys(setItems).length > 0 || Object.keys(removedItems).length > 0) && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED" || event === "PASSWORD_RECOVERY" || event === "SIGNED_OUT" || event === "MFA_CHALLENGE_VERIFIED")) await (0, cookies_1.applyServerStorage)({
				getAll,
				setAll,
				setItems,
				removedItems
			}, {
				cookieOptions: options?.cookieOptions ?? null,
				cookieEncoding: options?.cookieEncoding ?? "base64url"
			});
		});
		return client;
	}
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/types.js
var require_types = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
}));
//#endregion
//#region ../../node_modules/@supabase/ssr/dist/main/index.js
var require_main = /* @__PURE__ */ __commonJSMin(((exports) => {
	var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		var desc = Object.getOwnPropertyDescriptor(m, k);
		if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) desc = {
			enumerable: true,
			get: function() {
				return m[k];
			}
		};
		Object.defineProperty(o, k2, desc);
	}) : (function(o, m, k, k2) {
		if (k2 === void 0) k2 = k;
		o[k2] = m[k];
	}));
	var __exportStar = exports && exports.__exportStar || function(m, exports$1) {
		for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports$1, p)) __createBinding(exports$1, m, p);
	};
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.warnIfUsingDeprecatedAuthHelpersPackage = void 0;
	__exportStar(require_createBrowserClient(), exports);
	__exportStar(require_createServerClient(), exports);
	__exportStar(require_types(), exports);
	__exportStar(require_utils(), exports);
	var warnDeprecatedPackage_1 = require_warnDeprecatedPackage();
	Object.defineProperty(exports, "warnIfUsingDeprecatedAuthHelpersPackage", {
		enumerable: true,
		get: function() {
			return warnDeprecatedPackage_1.warnIfUsingDeprecatedAuthHelpersPackage;
		}
	});
}));
//#endregion
export { require_main as t };
