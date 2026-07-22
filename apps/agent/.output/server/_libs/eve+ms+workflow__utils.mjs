import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
__eveDirname(__eveFileURLToPath(import.meta.url));
//#region ../../node_modules/eve/dist/src/_virtual/_rolldown/runtime.js
var __defProp = Object.defineProperty;
var __commonJSMin = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports);
var __exportAll = (e, n) => {
	let r = {};
	for (var i in e) __defProp(r, i, {
		get: e[i],
		enumerable: !0
	});
	return n || __defProp(r, Symbol.toStringTag, { value: `Module` }), r;
};
//#endregion
//#region ../../node_modules/eve/dist/src/node_modules/.pnpm/ms@2.1.3/node_modules/ms/index.js
var require_ms = __commonJSMin(((e, t) => {
	var n = 1e3, r = n * 60, i = r * 60, a = i * 24, o = a * 7, s = a * 365.25;
	t.exports = function(e, t) {
		t ||= {};
		var n = typeof e;
		if (n === `string` && e.length > 0) return parse(e);
		if (n === `number` && isFinite(e)) return t.long ? fmtLong(e) : fmtShort(e);
		throw Error(`val is not a non-empty string or a valid number. val=` + JSON.stringify(e));
	};
	function parse(e) {
		if (e = String(e), !(e.length > 100)) {
			var t = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(e);
			if (t) {
				var c = parseFloat(t[1]);
				switch ((t[2] || `ms`).toLowerCase()) {
					case `years`:
					case `year`:
					case `yrs`:
					case `yr`:
					case `y`: return c * s;
					case `weeks`:
					case `week`:
					case `w`: return c * o;
					case `days`:
					case `day`:
					case `d`: return c * a;
					case `hours`:
					case `hour`:
					case `hrs`:
					case `hr`:
					case `h`: return c * i;
					case `minutes`:
					case `minute`:
					case `mins`:
					case `min`:
					case `m`: return c * r;
					case `seconds`:
					case `second`:
					case `secs`:
					case `sec`:
					case `s`: return c * n;
					case `milliseconds`:
					case `millisecond`:
					case `msecs`:
					case `msec`:
					case `ms`: return c;
					default: return;
				}
			}
		}
	}
	function fmtShort(e) {
		var t = Math.abs(e);
		return t >= a ? Math.round(e / a) + `d` : t >= i ? Math.round(e / i) + `h` : t >= r ? Math.round(e / r) + `m` : t >= n ? Math.round(e / n) + `s` : e + `ms`;
	}
	function fmtLong(e) {
		var t = Math.abs(e);
		return t >= a ? plural(e, t, a, `day`) : t >= i ? plural(e, t, i, `hour`) : t >= r ? plural(e, t, r, `minute`) : t >= n ? plural(e, t, n, `second`) : e + ` ms`;
	}
	function plural(e, t, n, r) {
		var i = t >= n * 1.5;
		return Math.round(e / n) + ` ` + r + (i ? `s` : ``);
	}
}));
require_ms();
//#endregion
//#region ../../node_modules/eve/dist/src/node_modules/.pnpm/@workflow_utils@5.0.0-beta.6/node_modules/@workflow/utils/dist/time.js
require_ms();
//#endregion
export { __exportAll as t };
