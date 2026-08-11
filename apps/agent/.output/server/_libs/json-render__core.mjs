import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
__eveDirname(__eveFileURLToPath(import.meta.url));
import { A as literal, C as _null, E as boolean, I as string, L as union, M as number, N as object, P as record, R as unknown, T as array, k as lazy, w as any, x as _enum } from "./@ai-sdk/anthropic+[...].mjs";
//#region ../../node_modules/@json-render/core/dist/chunk-AFLK3Q4T.mjs
var DynamicValueSchema = union([
	string(),
	number(),
	boolean(),
	_null(),
	object({ $state: string() })
]);
union([string(), object({ $state: string() })]);
union([number(), object({ $state: string() })]);
union([boolean(), object({ $state: string() })]);
//#endregion
//#region ../../node_modules/@json-render/core/dist/index.mjs
var numericOrStateRef = union([number(), object({ $state: string() })]);
var comparisonOps = {
	eq: unknown().optional(),
	neq: unknown().optional(),
	gt: numericOrStateRef.optional(),
	gte: numericOrStateRef.optional(),
	lt: numericOrStateRef.optional(),
	lte: numericOrStateRef.optional(),
	not: literal(true).optional()
};
var SingleConditionSchema = union([
	object({
		$state: string(),
		...comparisonOps
	}),
	object({
		$item: string(),
		...comparisonOps
	}),
	object({
		$index: literal(true),
		...comparisonOps
	})
]);
var VisibilityConditionSchema = lazy(() => union([
	boolean(),
	SingleConditionSchema,
	array(SingleConditionSchema),
	object({ $and: array(VisibilityConditionSchema) }),
	object({ $or: array(VisibilityConditionSchema) })
]));
var ActionConfirmSchema = object({
	title: string(),
	message: string(),
	confirmLabel: string().optional(),
	cancelLabel: string().optional(),
	variant: _enum(["default", "danger"]).optional()
});
var ActionOnSuccessSchema = union([
	object({ navigate: string() }),
	object({ set: record(string(), unknown()) }),
	object({ action: string() })
]);
var ActionOnErrorSchema = union([object({ set: record(string(), unknown()) }), object({ action: string() })]);
object({
	action: string(),
	params: record(string(), DynamicValueSchema).optional(),
	confirm: ActionConfirmSchema.optional(),
	onSuccess: ActionOnSuccessSchema.optional(),
	onError: ActionOnErrorSchema.optional(),
	preventDefault: boolean().optional()
});
object({
	checks: array(object({
		type: string(),
		args: record(string(), DynamicValueSchema).optional(),
		message: string()
	})).optional(),
	validateOn: _enum([
		"change",
		"blur",
		"submit"
	]).optional(),
	enabled: VisibilityConditionSchema.optional()
});
function validateSpec(spec, options = {}) {
	const { checkOrphans = false } = options;
	const issues = [];
	if (!spec.root) {
		issues.push({
			severity: "error",
			message: "Spec has no root element defined.",
			code: "missing_root"
		});
		return {
			valid: false,
			issues
		};
	}
	if (!spec.elements[spec.root]) issues.push({
		severity: "error",
		message: `Root element "${spec.root}" not found in elements map.`,
		code: "root_not_found"
	});
	if (Object.keys(spec.elements).length === 0) {
		issues.push({
			severity: "error",
			message: "Spec has no elements.",
			code: "empty_spec"
		});
		return {
			valid: false,
			issues
		};
	}
	for (const [key, element] of Object.entries(spec.elements)) {
		if (element.children) {
			for (const childKey of element.children) if (!spec.elements[childKey]) issues.push({
				severity: "error",
				message: `Element "${key}" references child "${childKey}" which does not exist in the elements map.`,
				elementKey: key,
				code: "missing_child"
			});
		}
		const props = element.props;
		if (props && "visible" in props && props.visible !== void 0) issues.push({
			severity: "error",
			message: `Element "${key}" has "visible" inside "props". It should be a top-level field on the element (sibling of type/props/children).`,
			elementKey: key,
			code: "visible_in_props"
		});
		if (props && "on" in props && props.on !== void 0) issues.push({
			severity: "error",
			message: `Element "${key}" has "on" inside "props". It should be a top-level field on the element (sibling of type/props/children).`,
			elementKey: key,
			code: "on_in_props"
		});
		if (props && "repeat" in props && props.repeat !== void 0) issues.push({
			severity: "error",
			message: `Element "${key}" has "repeat" inside "props". It should be a top-level field on the element (sibling of type/props/children).`,
			elementKey: key,
			code: "repeat_in_props"
		});
		if (props && "watch" in props && props.watch !== void 0) issues.push({
			severity: "error",
			message: `Element "${key}" has "watch" inside "props". It should be a top-level field on the element (sibling of type/props/children).`,
			elementKey: key,
			code: "watch_in_props"
		});
	}
	if (checkOrphans) {
		const reachable = /* @__PURE__ */ new Set();
		const walk = (key) => {
			if (reachable.has(key)) return;
			reachable.add(key);
			const el = spec.elements[key];
			if (el?.children) {
				for (const childKey of el.children) if (spec.elements[childKey]) walk(childKey);
			}
		};
		if (spec.elements[spec.root]) walk(spec.root);
		for (const key of Object.keys(spec.elements)) if (!reachable.has(key)) issues.push({
			severity: "warning",
			message: `Element "${key}" is not reachable from root "${spec.root}".`,
			elementKey: key,
			code: "orphaned_element"
		});
	}
	return {
		valid: !issues.some((i) => i.severity === "error"),
		issues
	};
}
var DEFAULT_MODES = ["patch"];
function normalizeModes(config) {
	if (!config?.modes?.length) return DEFAULT_MODES;
	return config.modes;
}
function jsonPatchInstructions() {
	return [
		"PATCH MODE (RFC 6902 JSON Patch):",
		"Output one JSON object per line. Each line is a patch operation.",
		"- Add: {\"op\":\"add\",\"path\":\"/elements/new-key\",\"value\":{...}}",
		"- Replace: {\"op\":\"replace\",\"path\":\"/elements/existing-key\",\"value\":{...}}",
		"- Remove: {\"op\":\"remove\",\"path\":\"/elements/old-key\"}",
		"Only output patches for what needs to change."
	].join("\n");
}
function jsonMergeInstructions() {
	return [
		"MERGE MODE (RFC 7396 JSON Merge Patch):",
		"Output a single JSON object on one line with __json_edit set to true.",
		"Include only the keys that changed. Unmentioned keys are preserved.",
		"Set a key to null to delete it.",
		"",
		"Example (update a title and add an element):",
		"{\"__json_edit\":true,\"elements\":{\"main\":{\"props\":{\"title\":\"New Title\"}},\"new-el\":{\"type\":\"Card\",\"props\":{},\"children\":[]}}}",
		"",
		"Example (delete an element):",
		"{\"__json_edit\":true,\"elements\":{\"old-widget\":null}}"
	].join("\n");
}
function jsonDiffInstructions() {
	return [
		"DIFF MODE (unified diff):",
		"Output a unified diff inside a ```diff code fence.",
		"The diff applies against the JSON-serialized current spec.",
		"",
		"Example:",
		"```diff",
		"--- a/spec.json",
		"+++ b/spec.json",
		"@@ -3,1 +3,1 @@",
		"-      \"title\": \"Login\"",
		"+      \"title\": \"Welcome Back\"",
		"```"
	].join("\n");
}
function yamlPatchInstructions() {
	return [
		"PATCH MODE (RFC 6902 JSON Patch):",
		"Output RFC 6902 JSON Patch lines inside a ```yaml-patch code fence.",
		"Each line is one JSON patch operation.",
		"",
		"Example:",
		"```yaml-patch",
		"{\"op\":\"replace\",\"path\":\"/elements/main/props/title\",\"value\":\"New Title\"}",
		"{\"op\":\"add\",\"path\":\"/elements/new-el\",\"value\":{\"type\":\"Card\",\"props\":{},\"children\":[]}}",
		"```"
	].join("\n");
}
function yamlMergeInstructions() {
	return [
		"MERGE MODE (RFC 7396 JSON Merge Patch):",
		"Output only the changed parts in a ```yaml-edit code fence.",
		"Uses deep merge semantics: only keys you include are updated. Unmentioned elements and props are preserved.",
		"Set a key to null to delete it.",
		"",
		"Example edit (update title, add a new element):",
		"```yaml-edit",
		"elements:",
		"  main:",
		"    props:",
		"      title: Updated Title",
		"  new-chart:",
		"    type: Card",
		"    props: {}",
		"    children: []",
		"```",
		"",
		"Example deletion:",
		"```yaml-edit",
		"elements:",
		"  old-widget: null",
		"```"
	].join("\n");
}
function yamlDiffInstructions() {
	return [
		"DIFF MODE (unified diff):",
		"Output a unified diff inside a ```diff code fence.",
		"The diff applies against the YAML-serialized current spec.",
		"",
		"Example:",
		"```diff",
		"--- a/spec.yaml",
		"+++ b/spec.yaml",
		"@@ -6,1 +6,1 @@",
		"-      title: Login",
		"+      title: Welcome Back",
		"```"
	].join("\n");
}
function modeSelectionGuidance(modes) {
	if (modes.length === 1) return "";
	const parts = ["Choose the best edit strategy for the requested change:"];
	if (modes.includes("patch")) parts.push("- PATCH: best for precise, targeted single-field updates");
	if (modes.includes("merge")) parts.push("- MERGE: best for structural changes (add/remove elements, reparent children, update multiple props at once)");
	if (modes.includes("diff")) parts.push("- DIFF: best for small text-level changes when you can see the exact lines to change");
	return parts.join("\n");
}
function buildEditInstructions(config, format) {
	const modes = normalizeModes(config);
	const sections = [];
	sections.push("EDITING EXISTING SPECS:");
	sections.push("");
	const guidance = modeSelectionGuidance(modes);
	if (guidance) {
		sections.push(guidance);
		sections.push("");
	}
	for (const mode of modes) {
		if (format === "json") switch (mode) {
			case "patch":
				sections.push(jsonPatchInstructions());
				break;
			case "merge":
				sections.push(jsonMergeInstructions());
				break;
			case "diff":
				sections.push(jsonDiffInstructions());
				break;
		}
		else switch (mode) {
			case "patch":
				sections.push(yamlPatchInstructions());
				break;
			case "merge":
				sections.push(yamlMergeInstructions());
				break;
			case "diff":
				sections.push(yamlDiffInstructions());
				break;
		}
		sections.push("");
	}
	return sections.join("\n");
}
function createBuilder() {
	return {
		string: () => ({ kind: "string" }),
		number: () => ({ kind: "number" }),
		boolean: () => ({ kind: "boolean" }),
		array: (item) => ({
			kind: "array",
			inner: item
		}),
		object: (shape) => ({
			kind: "object",
			inner: shape
		}),
		record: (value) => ({
			kind: "record",
			inner: value
		}),
		any: () => ({ kind: "any" }),
		zod: () => ({ kind: "zod" }),
		ref: (path) => ({
			kind: "ref",
			inner: path
		}),
		propsOf: (path) => ({
			kind: "propsOf",
			inner: path
		}),
		map: (entryShape) => ({
			kind: "map",
			inner: entryShape
		}),
		optional: () => ({ optional: true })
	};
}
function defineSchema(builder, options) {
	return {
		definition: builder(createBuilder()),
		promptTemplate: options?.promptTemplate,
		defaultRules: options?.defaultRules,
		builtInActions: options?.builtInActions,
		createCatalog(catalog) {
			return createCatalogFromSchema(this, catalog);
		}
	};
}
function createCatalogFromSchema(schema, catalogData) {
	const components = catalogData.components;
	const actions = catalogData.actions;
	const componentNames = components ? Object.keys(components) : [];
	const actionNames = actions ? Object.keys(actions) : [];
	const zodSchema = buildZodSchemaFromDefinition(schema.definition, catalogData);
	return {
		schema,
		data: catalogData,
		componentNames,
		actionNames,
		prompt(options = {}) {
			return generatePrompt(this, options);
		},
		jsonSchema(options = {}) {
			return zodToJsonSchema(zodSchema, options.strict ?? false);
		},
		validate(spec) {
			const result = zodSchema.safeParse(spec);
			if (result.success) return {
				success: true,
				data: result.data
			};
			return {
				success: false,
				error: result.error
			};
		},
		zodSchema() {
			return zodSchema;
		},
		get _specType() {
			throw new Error("_specType is only for type inference");
		}
	};
}
function buildZodSchemaFromDefinition(definition, catalogData) {
	return buildZodType(definition.spec, catalogData);
}
function buildZodType(schemaType, catalogData) {
	switch (schemaType.kind) {
		case "string": return string();
		case "number": return number();
		case "boolean": return boolean();
		case "any": return any();
		case "array": return array(buildZodType(schemaType.inner, catalogData));
		case "object": {
			const shape = schemaType.inner;
			const zodShape = {};
			for (const [key, value] of Object.entries(shape)) {
				let zodType = buildZodType(value, catalogData);
				if (value.optional) zodType = zodType.optional();
				zodShape[key] = zodType;
			}
			return object(zodShape);
		}
		case "record": {
			const inner = buildZodType(schemaType.inner, catalogData);
			return record(string(), inner);
		}
		case "ref": {
			const path = schemaType.inner;
			const keys = getKeysFromPath(path, catalogData);
			if (keys.length === 0) return string();
			if (keys.length === 1) return literal(keys[0]);
			return _enum(keys);
		}
		case "propsOf": {
			const path = schemaType.inner;
			const propsSchemas = getPropsFromPath(path, catalogData);
			if (propsSchemas.length === 0) return record(string(), unknown());
			if (propsSchemas.length === 1) return propsSchemas[0];
			return record(string(), unknown());
		}
		default: return unknown();
	}
}
function getKeysFromPath(path, catalogData) {
	const parts = path.split(".");
	let current = { catalog: catalogData };
	for (const part of parts) if (current && typeof current === "object") current = current[part];
	else return [];
	if (current && typeof current === "object") return Object.keys(current);
	return [];
}
function getPropsFromPath(path, catalogData) {
	const parts = path.split(".");
	let current = { catalog: catalogData };
	for (const part of parts) if (current && typeof current === "object") current = current[part];
	else return [];
	if (current && typeof current === "object") return Object.values(current).map((entry) => entry.props).filter((props) => props !== void 0);
	return [];
}
function generatePrompt(catalog, options) {
	if (catalog.schema.promptTemplate) {
		const context = {
			catalog: catalog.data,
			componentNames: catalog.componentNames,
			actionNames: catalog.actionNames,
			options,
			formatZodType
		};
		return catalog.schema.promptTemplate(context);
	}
	const { system = "You are a UI generator that outputs JSON.", customRules = [], mode: rawMode = "standalone" } = options;
	const mode = rawMode === "chat" ? (console.warn("[json-render] mode \"chat\" is deprecated, use \"inline\" instead"), "inline") : rawMode === "generate" ? (console.warn("[json-render] mode \"generate\" is deprecated, use \"standalone\" instead"), "standalone") : rawMode;
	const lines = [];
	lines.push(system);
	lines.push("");
	if (mode === "inline") {
		lines.push("OUTPUT FORMAT (text + JSONL, RFC 6902 JSON Patch):");
		lines.push("You respond conversationally. When generating UI, first write a brief explanation (1-3 sentences), then output JSONL patch lines wrapped in a ```spec code fence.");
		lines.push("The JSONL lines use RFC 6902 JSON Patch operations to build a UI tree. Always wrap them in a ```spec fence block:");
		lines.push("  ```spec");
		lines.push("  {\"op\":\"add\",\"path\":\"/root\",\"value\":\"main\"}");
		lines.push("  {\"op\":\"add\",\"path\":\"/elements/main\",\"value\":{\"type\":\"Card\",\"props\":{\"title\":\"Hello\"},\"children\":[]}}");
		lines.push("  ```");
		lines.push("If the user's message does not require a UI (e.g. a greeting or clarifying question), respond with text only — no JSONL.");
	} else {
		lines.push("OUTPUT FORMAT (JSONL, RFC 6902 JSON Patch):");
		lines.push("Output JSONL (one JSON object per line) using RFC 6902 JSON Patch operations to build a UI tree.");
	}
	lines.push("Each line is a JSON patch operation (add, remove, replace). Start with /root, then stream /elements and /state patches interleaved so the UI fills in progressively as it streams.");
	lines.push("");
	lines.push("Example output (each line is a separate JSON object):");
	lines.push("");
	const allComponents = catalog.data.components;
	const cn = catalog.componentNames;
	const comp1 = cn[0] || "Component";
	const comp2 = cn.length > 1 ? cn[1] : comp1;
	const comp1Def = allComponents?.[comp1];
	const comp2Def = allComponents?.[comp2];
	const comp1Props = comp1Def ? getExampleProps(comp1Def) : {};
	const comp2Props = comp2Def ? getExampleProps(comp2Def) : {};
	const dynamicPropName = comp2Def?.props ? findFirstStringProp(comp2Def.props) : null;
	const dynamicProps = dynamicPropName ? {
		...comp2Props,
		[dynamicPropName]: { $item: "title" }
	} : comp2Props;
	const exampleOutput = [
		JSON.stringify({
			op: "add",
			path: "/root",
			value: "main"
		}),
		JSON.stringify({
			op: "add",
			path: "/elements/main",
			value: {
				type: comp1,
				props: comp1Props,
				children: ["child-1", "list"]
			}
		}),
		JSON.stringify({
			op: "add",
			path: "/elements/child-1",
			value: {
				type: comp2,
				props: comp2Props,
				children: []
			}
		}),
		JSON.stringify({
			op: "add",
			path: "/elements/list",
			value: {
				type: comp1,
				props: comp1Props,
				repeat: {
					statePath: "/items",
					key: "id"
				},
				children: ["item"]
			}
		}),
		JSON.stringify({
			op: "add",
			path: "/elements/item",
			value: {
				type: comp2,
				props: dynamicProps,
				children: []
			}
		}),
		JSON.stringify({
			op: "add",
			path: "/state/items",
			value: []
		}),
		JSON.stringify({
			op: "add",
			path: "/state/items/0",
			value: {
				id: "1",
				title: "First Item"
			}
		}),
		JSON.stringify({
			op: "add",
			path: "/state/items/1",
			value: {
				id: "2",
				title: "Second Item"
			}
		})
	].join("\n");
	lines.push(`${exampleOutput}

Note: state patches appear right after the elements that use them, so the UI fills in as it streams. ONLY use component types from the AVAILABLE COMPONENTS list below.`);
	lines.push("");
	lines.push("INITIAL STATE:");
	lines.push("Specs include a /state field to seed the state model. Components with { $bindState } or { $bindItem } read from and write to this state, and $state expressions read from it.");
	lines.push("CRITICAL: You MUST include state patches whenever your UI displays data via $state, $bindState, $bindItem, $item, or $index expressions, or uses repeat to iterate over arrays. Without state, these references resolve to nothing and repeat lists render zero items.");
	lines.push("Output state patches right after the elements that reference them, so the UI fills in progressively as it streams.");
	lines.push("Stream state progressively - output one patch per array item instead of one giant blob:");
	lines.push("  For arrays: {\"op\":\"add\",\"path\":\"/state/posts/0\",\"value\":{\"id\":\"1\",\"title\":\"First Post\",...}} then /state/posts/1, /state/posts/2, etc.");
	lines.push("  For scalars: {\"op\":\"add\",\"path\":\"/state/newTodoText\",\"value\":\"\"}");
	lines.push("  Initialize the array first if needed: {\"op\":\"add\",\"path\":\"/state/posts\",\"value\":[]}");
	lines.push("When content comes from the state model, use { \"$state\": \"/some/path\" } dynamic props to display it instead of hardcoding the same value in both state and props. The state model is the single source of truth.");
	lines.push("Include realistic sample data in state. For blogs: 3-4 posts with titles, excerpts, authors, dates. For product lists: 3-5 items with names, prices, descriptions. Never leave arrays empty.");
	lines.push("");
	lines.push("DYNAMIC LISTS (repeat field):");
	lines.push("Any element can have a top-level \"repeat\" field to render its children once per item in a state array: { \"repeat\": { \"statePath\": \"/arrayPath\", \"key\": \"id\" } }.");
	lines.push("The element itself renders once (as the container), and its children are expanded once per array item. \"statePath\" is the state array path. \"key\" is an optional field name on each item for stable React keys.");
	lines.push(`Example: ${JSON.stringify({
		type: comp1,
		props: comp1Props,
		repeat: {
			statePath: "/todos",
			key: "id"
		},
		children: ["todo-item"]
	})}`);
	lines.push("Inside children of a repeated element, use { \"$item\": \"field\" } to read a field from the current item, and { \"$index\": true } to get the current array index. For two-way binding to an item field use { \"$bindItem\": \"completed\" } on the appropriate prop.");
	lines.push("ALWAYS use the repeat field for lists backed by state arrays. NEVER hardcode individual elements for each array item.");
	lines.push("IMPORTANT: \"repeat\" is a top-level field on the element (sibling of type/props/children), NOT inside props.");
	lines.push("");
	lines.push("ARRAY STATE ACTIONS:");
	lines.push("Use action \"pushState\" to append items to arrays. Params: { statePath: \"/arrayPath\", value: { ...item }, clearStatePath: \"/inputPath\" }.");
	lines.push("Values inside pushState can contain { \"$state\": \"/statePath\" } references to read current state (e.g. the text from an input field).");
	lines.push("Use \"$id\" inside a pushState value to auto-generate a unique ID.");
	lines.push("Example: on: { \"press\": { \"action\": \"pushState\", \"params\": { \"statePath\": \"/todos\", \"value\": { \"id\": \"$id\", \"title\": { \"$state\": \"/newTodoText\" }, \"completed\": false }, \"clearStatePath\": \"/newTodoText\" } } }");
	lines.push(`Use action "removeState" to remove items from arrays by index. Params: { statePath: "/arrayPath", index: N }. Inside a repeated element's children, use { "$index": true } for the current item index. Action params support the same expressions as props: { "$item": "field" } resolves to the absolute state path, { "$index": true } resolves to the index number, and { "$state": "/path" } reads a value from state.`);
	lines.push("For lists where users can add/remove items (todos, carts, etc.), use pushState and removeState instead of hardcoding with setState.");
	lines.push("");
	lines.push("IMPORTANT: State paths use RFC 6901 JSON Pointer syntax (e.g. \"/todos/0/title\"). Do NOT use JavaScript-style dot notation (e.g. \"/todos.length\" is WRONG). To generate unique IDs for new items, use \"$id\" instead of trying to read array length.");
	lines.push("");
	const components = allComponents;
	if (components) {
		lines.push(`AVAILABLE COMPONENTS (${catalog.componentNames.length}):`);
		lines.push("");
		for (const [name, def] of Object.entries(components)) {
			const propsStr = def.props ? formatZodType(def.props) : "{}";
			const childrenStr = def.slots && def.slots.length > 0 ? " [accepts children]" : "";
			const eventsStr = def.events && def.events.length > 0 ? ` [events: ${def.events.join(", ")}]` : "";
			const descStr = def.description ? ` - ${def.description}` : "";
			lines.push(`- ${name}: ${propsStr}${descStr}${childrenStr}${eventsStr}`);
		}
		lines.push("");
	}
	const actions = catalog.data.actions;
	const builtInActions = catalog.schema.builtInActions ?? [];
	const hasCustomActions = actions && catalog.actionNames.length > 0;
	const hasBuiltInActions = builtInActions.length > 0;
	if (hasCustomActions || hasBuiltInActions) {
		lines.push("AVAILABLE ACTIONS:");
		lines.push("");
		for (const action2 of builtInActions) lines.push(`- ${action2.name}: ${action2.description} [built-in]`);
		if (hasCustomActions) for (const [name, def] of Object.entries(actions)) lines.push(`- ${name}${def.description ? `: ${def.description}` : ""}`);
		lines.push("");
	}
	lines.push("EVENTS (the `on` field):");
	lines.push("Elements can have an optional `on` field to bind events to actions. The `on` field is a top-level field on the element (sibling of type/props/children), NOT inside props.");
	lines.push("Each key in `on` is an event name (from the component's supported events), and the value is an action binding: `{ \"action\": \"<actionName>\", \"params\": { ... } }`.");
	lines.push("");
	lines.push("Example:");
	lines.push(`  ${JSON.stringify({
		type: comp1,
		props: comp1Props,
		on: { press: {
			action: "setState",
			params: {
				statePath: "/saved",
				value: true
			}
		} },
		children: []
	})}`);
	lines.push("");
	lines.push("Action params can use dynamic references to read from state: { \"$state\": \"/statePath\" }.");
	lines.push("IMPORTANT: Do NOT put action/actionParams inside props. Always use the `on` field for event bindings.");
	lines.push("");
	lines.push("VISIBILITY CONDITIONS:");
	lines.push("Elements can have an optional `visible` field to conditionally show/hide based on state. IMPORTANT: `visible` is a top-level field on the element object (sibling of type/props/children), NOT inside props.");
	lines.push(`Correct: ${JSON.stringify({
		type: comp1,
		props: comp1Props,
		visible: {
			$state: "/activeTab",
			eq: "home"
		},
		children: ["..."]
	})}`);
	lines.push("- `{ \"$state\": \"/path\" }` - visible when state at path is truthy");
	lines.push("- `{ \"$state\": \"/path\", \"not\": true }` - visible when state at path is falsy");
	lines.push("- `{ \"$state\": \"/path\", \"eq\": \"value\" }` - visible when state equals value");
	lines.push("- `{ \"$state\": \"/path\", \"neq\": \"value\" }` - visible when state does not equal value");
	lines.push("- `{ \"$state\": \"/path\", \"gt\": N }` / `gte` / `lt` / `lte` - numeric comparisons");
	lines.push("- Use ONE operator per condition (eq, neq, gt, gte, lt, lte). Do not combine multiple operators.");
	lines.push("- Any condition can add `\"not\": true` to invert its result");
	lines.push("- `[condition, condition]` - all conditions must be true (implicit AND)");
	lines.push("- `{ \"$and\": [condition, condition] }` - explicit AND (use when nesting inside $or)");
	lines.push("- `{ \"$or\": [condition, condition] }` - at least one must be true (OR)");
	lines.push("- `true` / `false` - always visible/hidden");
	lines.push("");
	lines.push("Use a component with on.press bound to setState to update state and drive visibility.");
	lines.push(`Example: A ${comp1} with on: { "press": { "action": "setState", "params": { "statePath": "/activeTab", "value": "home" } } } sets state, then a container with visible: { "$state": "/activeTab", "eq": "home" } shows only when that tab is active.`);
	lines.push("");
	lines.push("For tab patterns where the first/default tab should be visible when no tab is selected yet, use $or to handle both cases: visible: { \"$or\": [{ \"$state\": \"/activeTab\", \"eq\": \"home\" }, { \"$state\": \"/activeTab\", \"not\": true }] }. This ensures the first tab is visible both when explicitly selected AND when /activeTab is not yet set.");
	lines.push("");
	lines.push("DYNAMIC PROPS:");
	lines.push("Any prop value can be a dynamic expression that resolves based on state. Three forms are supported:");
	lines.push("");
	lines.push("1. Read-only state: `{ \"$state\": \"/statePath\" }` - resolves to the value at that state path (one-way read).");
	lines.push("   Example: `\"color\": { \"$state\": \"/theme/primary\" }` reads the color from state.");
	lines.push("");
	lines.push("2. Two-way binding: `{ \"$bindState\": \"/statePath\" }` - resolves to the value at the state path AND enables write-back. Use on form input props (value, checked, pressed, etc.).");
	lines.push("   Example: `\"value\": { \"$bindState\": \"/form/email\" }` binds the input value to /form/email.");
	lines.push("   Inside repeat scopes: `\"checked\": { \"$bindItem\": \"completed\" }` binds to the current item's completed field.");
	lines.push("");
	lines.push("3. Conditional: `{ \"$cond\": <condition>, \"$then\": <value>, \"$else\": <value> }` - evaluates the condition (same syntax as visibility conditions) and picks the matching value.");
	lines.push("   Example: `\"color\": { \"$cond\": { \"$state\": \"/activeTab\", \"eq\": \"home\" }, \"$then\": \"#007AFF\", \"$else\": \"#8E8E93\" }`");
	lines.push("");
	lines.push("Use $bindState for form inputs (text fields, checkboxes, selects, sliders, etc.) and $state for read-only data display. Inside repeat scopes, use $bindItem for form inputs bound to the current item. Use dynamic props instead of duplicating elements with opposing visible conditions when only prop values differ.");
	lines.push("");
	lines.push("4. Template: `{ \"$template\": \"Hello, ${/name}!\" }` - interpolates references in the string. Absolute paths like `${/path}` resolve against the state model. Bare names like `${field}` resolve against the current repeat item first, then fall back to the state model at `/<field>`.");
	lines.push("   Example: `\"label\": { \"$template\": \"Items: ${/cart/count} | Total: ${/cart/total}\" }` renders \"Items: 3 | Total: 42.00\" when /cart/count is 3 and /cart/total is 42.00. Inside a repeat, `{ \"$template\": \"${name} - ${email}\" }` reads name and email from each item.");
	lines.push("");
	const catalogFunctions = catalog.data.functions;
	if (catalogFunctions && Object.keys(catalogFunctions).length > 0) {
		lines.push("5. Computed: `{ \"$computed\": \"<functionName>\", \"args\": { \"key\": <expression> } }` - calls a registered function with resolved args and returns the result.");
		lines.push("   Example: `\"value\": { \"$computed\": \"fullName\", \"args\": { \"first\": { \"$state\": \"/form/firstName\" }, \"last\": { \"$state\": \"/form/lastName\" } } }`");
		lines.push("   Available functions:");
		for (const name of Object.keys(catalogFunctions)) lines.push(`   - ${name}`);
		lines.push("");
	}
	const directives = options.directives;
	if (directives && directives.length > 0) {
		lines.push("CUSTOM DYNAMIC VALUES:");
		lines.push("");
		for (const d of directives) {
			const desc = d.description ? ` (${d.description})` : "";
			lines.push(`- ${d.name}${desc}: ${formatZodType(d.schema)}`);
		}
		lines.push("");
		lines.push("Directives compose: any value field can contain another directive or a $state expression, resolved inside-out.");
		lines.push("");
	}
	if (allComponents ? Object.entries(allComponents).some(([, def]) => {
		if (!def.props) return false;
		return formatZodType(def.props).includes("checks");
	}) : false) {
		lines.push("VALIDATION:");
		lines.push("Form components that accept a `checks` prop support client-side validation.");
		lines.push("Each check is an object: { \"type\": \"<name>\", \"message\": \"...\", \"args\": { ... } }");
		lines.push("");
		lines.push("Built-in validation types:");
		lines.push("  - required — value must be non-empty");
		lines.push("  - email — valid email format");
		lines.push("  - minLength — minimum string length (args: { \"min\": N })");
		lines.push("  - maxLength — maximum string length (args: { \"max\": N })");
		lines.push("  - pattern — match a regex (args: { \"pattern\": \"regex\" })");
		lines.push("  - min — minimum numeric value (args: { \"min\": N })");
		lines.push("  - max — maximum numeric value (args: { \"max\": N })");
		lines.push("  - numeric — value must be a number");
		lines.push("  - url — valid URL format");
		lines.push("  - matches — must equal another field (args: { \"other\": { \"$state\": \"/path\" } })");
		lines.push("  - equalTo — alias for matches (args: { \"other\": { \"$state\": \"/path\" } })");
		lines.push("  - lessThan — value must be less than another field (args: { \"other\": { \"$state\": \"/path\" } })");
		lines.push("  - greaterThan — value must be greater than another field (args: { \"other\": { \"$state\": \"/path\" } })");
		lines.push("  - requiredIf — required only when another field is truthy (args: { \"field\": { \"$state\": \"/path\" } })");
		lines.push("");
		lines.push("Example:");
		lines.push("  \"checks\": [{ \"type\": \"required\", \"message\": \"Email is required\" }, { \"type\": \"email\", \"message\": \"Invalid email\" }]");
		lines.push("");
		lines.push("IMPORTANT: When using checks, the component must also have a { $bindState } or { $bindItem } on its value/checked prop for two-way binding.");
		lines.push("Always include validation checks on form inputs for a good user experience (e.g. required, email, minLength).");
		lines.push("");
	}
	if (hasCustomActions || hasBuiltInActions) {
		lines.push("STATE WATCHERS:");
		lines.push("Elements can have an optional `watch` field to react to state changes and trigger actions. The `watch` field is a top-level field on the element (sibling of type/props/children), NOT inside props.");
		lines.push("Maps state paths (JSON Pointers) to action bindings. When the value at a watched path changes, the bound actions fire automatically.");
		lines.push("");
		lines.push("Example (cascading select — country changes trigger city loading):");
		lines.push(`  ${JSON.stringify({
			type: "Select",
			props: {
				value: { $bindState: "/form/country" },
				options: [
					"US",
					"Canada",
					"UK"
				]
			},
			watch: { "/form/country": {
				action: "loadCities",
				params: { country: { $state: "/form/country" } }
			} },
			children: []
		})}`);
		lines.push("");
		lines.push("Use `watch` for cascading dependencies where changing one field should trigger side effects (loading data, resetting dependent fields, computing derived values).");
		lines.push("IMPORTANT: `watch` is a top-level field on the element (sibling of type/props/children), NOT inside props. Watchers only fire when the value changes, not on initial render.");
		lines.push("");
	}
	const editModes = options.editModes;
	if (editModes && editModes.length > 0) lines.push(buildEditInstructions({ modes: editModes }, "json"));
	lines.push("RULES:");
	const baseRules = mode === "inline" ? [
		"When generating UI, wrap all JSONL patches in a ```spec code fence - one JSON object per line inside the fence",
		"Write a brief conversational response before any JSONL output",
		"First set root: {\"op\":\"add\",\"path\":\"/root\",\"value\":\"<root-key>\"}",
		"Then add each element: {\"op\":\"add\",\"path\":\"/elements/<key>\",\"value\":{...}}",
		"Output /state patches right after the elements that use them, one per array item for progressive loading. REQUIRED whenever using $state, $bindState, $bindItem, $item, $index, or repeat.",
		"ONLY use components listed above",
		"Each element value needs: type, props, children (array of child keys)",
		"Use unique keys for the element map entries (e.g., 'header', 'metric-1', 'chart-revenue')"
	] : [
		"Output ONLY JSONL patches - one JSON object per line, no markdown, no code fences",
		"First set root: {\"op\":\"add\",\"path\":\"/root\",\"value\":\"<root-key>\"}",
		"Then add each element: {\"op\":\"add\",\"path\":\"/elements/<key>\",\"value\":{...}}",
		"Output /state patches right after the elements that use them, one per array item for progressive loading. REQUIRED whenever using $state, $bindState, $bindItem, $item, $index, or repeat.",
		"ONLY use components listed above",
		"Each element value needs: type, props, children (array of child keys)",
		"Use unique keys for the element map entries (e.g., 'header', 'metric-1', 'chart-revenue')"
	];
	const schemaRules = catalog.schema.defaultRules ?? [];
	[
		...baseRules,
		...schemaRules,
		...customRules
	].forEach((rule, i) => {
		lines.push(`${i + 1}. ${rule}`);
	});
	return lines.join("\n");
}
function getExampleProps(def) {
	if (def.example && Object.keys(def.example).length > 0) return def.example;
	if (def.props) return generateExamplePropsFromZod(def.props);
	return {};
}
function generateExamplePropsFromZod(schema) {
	if (!schema || !schema._def) return {};
	const def = schema._def;
	const typeName = getZodTypeName(schema);
	if (typeName !== "ZodObject" && typeName !== "object") return {};
	const shape = typeof def.shape === "function" ? def.shape() : def.shape;
	if (!shape) return {};
	const result = {};
	for (const [key, value] of Object.entries(shape)) {
		const innerTypeName = getZodTypeName(value);
		if (innerTypeName === "ZodOptional" || innerTypeName === "optional" || innerTypeName === "ZodNullable" || innerTypeName === "nullable") continue;
		result[key] = generateExampleValue(value);
	}
	return result;
}
function generateExampleValue(schema) {
	if (!schema || !schema._def) return "...";
	const def = schema._def;
	switch (getZodTypeName(schema)) {
		case "ZodString":
		case "string": return "example";
		case "ZodNumber":
		case "number": return 0;
		case "ZodBoolean":
		case "boolean": return true;
		case "ZodLiteral":
		case "literal": return def.value;
		case "ZodEnum":
		case "enum":
			if (Array.isArray(def.values) && def.values.length > 0) return def.values[0];
			if (def.entries && typeof def.entries === "object") {
				const values = Object.values(def.entries);
				return values.length > 0 ? values[0] : "example";
			}
			return "example";
		case "ZodOptional":
		case "optional":
		case "ZodNullable":
		case "nullable":
		case "ZodDefault":
		case "default": {
			const inner = def.innerType ?? def.wrapped;
			return inner ? generateExampleValue(inner) : null;
		}
		case "ZodArray":
		case "array": return [];
		case "ZodObject":
		case "object": return generateExamplePropsFromZod(schema);
		case "ZodUnion":
		case "union": {
			const options = def.options;
			return options && options.length > 0 ? generateExampleValue(options[0]) : "...";
		}
		default: return "...";
	}
}
function findFirstStringProp(schema) {
	if (!schema || !schema._def) return null;
	const def = schema._def;
	const typeName = getZodTypeName(schema);
	if (typeName !== "ZodObject" && typeName !== "object") return null;
	const shape = typeof def.shape === "function" ? def.shape() : def.shape;
	if (!shape) return null;
	for (const [key, value] of Object.entries(shape)) {
		const innerTypeName = getZodTypeName(value);
		if (innerTypeName === "ZodOptional" || innerTypeName === "optional" || innerTypeName === "ZodNullable" || innerTypeName === "nullable") continue;
		if (innerTypeName === "ZodString" || innerTypeName === "string") return key;
	}
	return null;
}
function getZodTypeName(schema) {
	if (!schema || !schema._def) return "";
	const def = schema._def;
	return def.typeName ?? def.type ?? "";
}
function formatZodType(schema) {
	if (!schema || !schema._def) return "unknown";
	const def = schema._def;
	switch (getZodTypeName(schema)) {
		case "ZodString":
		case "string": return "string";
		case "ZodNumber":
		case "number": return "number";
		case "ZodBoolean":
		case "boolean": return "boolean";
		case "ZodLiteral":
		case "literal": {
			const litValue = def.values?.[0] ?? def.value;
			return JSON.stringify(litValue);
		}
		case "ZodEnum":
		case "enum": {
			let values;
			if (Array.isArray(def.values)) values = def.values;
			else if (def.entries && typeof def.entries === "object") values = Object.values(def.entries);
			else return "enum";
			return values.map((v) => `"${v}"`).join(" | ");
		}
		case "ZodArray":
		case "array": {
			const inner = typeof def.element === "object" ? def.element : typeof def.type === "object" ? def.type : void 0;
			return inner ? `Array<${formatZodType(inner)}>` : "Array<unknown>";
		}
		case "ZodObject":
		case "object": {
			const shape = typeof def.shape === "function" ? def.shape() : def.shape;
			if (!shape) return "object";
			return `{ ${Object.entries(shape).map(([key, value]) => {
				const innerTypeName = getZodTypeName(value);
				return `${key}${innerTypeName === "ZodOptional" || innerTypeName === "ZodNullable" || innerTypeName === "optional" || innerTypeName === "nullable" ? "?" : ""}: ${formatZodType(value)}`;
			}).join(", ")} }`;
		}
		case "ZodOptional":
		case "optional":
		case "ZodNullable":
		case "nullable": {
			const inner = def.innerType ?? def.wrapped;
			return inner ? formatZodType(inner) : "unknown";
		}
		case "ZodUnion":
		case "union": {
			const options = def.options;
			return options ? options.map((opt) => formatZodType(opt)).join(" | ") : "unknown";
		}
		case "ZodRecord":
		case "record": {
			const keyType = def.keyType ?? void 0;
			const valueType = def.valueType ?? def.element ?? void 0;
			return `Record<${keyType ? formatZodType(keyType) : "string"}, ${valueType ? formatZodType(valueType) : "unknown"}>`;
		}
		case "ZodDefault":
		case "default": {
			const inner = def.innerType ?? def.wrapped;
			return inner ? formatZodType(inner) : "unknown";
		}
		default: return "unknown";
	}
}
function zodTypeName(def) {
	if (typeof def.type === "string") return def.type;
	if (typeof def.typeName === "string") return def.typeName;
	return "";
}
function normalizeTypeName(raw) {
	if (raw.startsWith("Zod")) return raw.slice(3).toLowerCase();
	return raw.toLowerCase();
}
function zodToJsonSchema(schema, strict = false) {
	const def = schema._def;
	switch (normalizeTypeName(zodTypeName(def))) {
		case "string": return { type: "string" };
		case "number": return { type: "number" };
		case "boolean": return { type: "boolean" };
		case "literal": {
			const values = def.values;
			return { const: values ? values[0] : def.value };
		}
		case "enum": {
			const entries = def.entries;
			return { enum: (entries ? Object.values(entries) : def.values) ?? [] };
		}
		case "array": {
			const inner = def.element ?? def.type;
			return {
				type: "array",
				items: inner ? zodToJsonSchema(inner, strict) : {}
			};
		}
		case "object": {
			const rawShape = def.shape;
			const shape = typeof rawShape === "function" ? rawShape() : rawShape;
			if (!shape) {
				if (strict) return {
					type: "object",
					properties: {},
					required: [],
					additionalProperties: false
				};
				return { type: "object" };
			}
			const properties = {};
			const required = [];
			for (const [key, value] of Object.entries(shape)) {
				const innerDef = value._def;
				const innerKind = normalizeTypeName(zodTypeName(innerDef));
				const isOptional = innerKind === "optional" || innerKind === "nullable";
				if (strict) {
					required.push(key);
					if (isOptional) properties[key] = { anyOf: [zodToJsonSchema(value, strict), { type: "null" }] };
					else properties[key] = zodToJsonSchema(value, strict);
				} else {
					properties[key] = zodToJsonSchema(value);
					if (!isOptional) required.push(key);
				}
			}
			return {
				type: "object",
				properties,
				required: required.length > 0 ? required : void 0,
				additionalProperties: false
			};
		}
		case "record": {
			const valueType = def.valueType;
			if (strict) return {
				type: "object",
				properties: {},
				required: [],
				additionalProperties: false
			};
			return {
				type: "object",
				additionalProperties: valueType ? zodToJsonSchema(valueType) : true
			};
		}
		case "optional":
		case "nullable": {
			const inner = def.innerType;
			return inner ? zodToJsonSchema(inner, strict) : {};
		}
		case "union": {
			const options = def.options;
			return options ? { anyOf: options.map((o) => zodToJsonSchema(o, strict)) } : {};
		}
		case "any":
		case "unknown":
			if (strict) return {
				type: "object",
				properties: {},
				required: [],
				additionalProperties: false
			};
			return {};
		default: return {};
	}
}
function defineCatalog(schema, catalog) {
	return schema.createCatalog(catalog);
}
//#endregion
export { defineSchema as n, validateSpec as r, defineCatalog as t };
