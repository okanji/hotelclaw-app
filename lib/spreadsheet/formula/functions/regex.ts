/** REGEX functions — case-sensitive by default; uses standard JS regex. */

import { argToScalarString, type FunctionImpl } from "./_helpers";

export const REGEX_FUNCTIONS: Record<string, FunctionImpl> = {
  REGEXMATCH(args, resolve) {
    const text = argToScalarString(args[0]!, resolve);
    const pattern = argToScalarString(args[1]!, resolve);
    try {
      return { type: "boolean", value: new RegExp(pattern).test(text) };
    } catch {
      return { type: "error" };
    }
  },
  REGEXEXTRACT(args, resolve) {
    const text = argToScalarString(args[0]!, resolve);
    const pattern = argToScalarString(args[1]!, resolve);
    try {
      const m = new RegExp(pattern).exec(text);
      if (!m) return { type: "string", value: "" };
      // Group 1 if captured, else the whole match.
      return { type: "string", value: m[1] ?? m[0] };
    } catch {
      return { type: "error" };
    }
  },
  REGEXREPLACE(args, resolve) {
    const text = argToScalarString(args[0]!, resolve);
    const pattern = argToScalarString(args[1]!, resolve);
    const replacement = argToScalarString(args[2]!, resolve);
    try {
      return {
        type: "string",
        value: text.replace(new RegExp(pattern, "g"), replacement),
      };
    } catch {
      return { type: "error" };
    }
  },
};
