import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
__eveDirname(__eveFileURLToPath(import.meta.url));
import { i as __require, t as __commonJSMin } from "../_runtime.mjs";
//#region ../../node_modules/safe-buffer/index.js
var require_safe_buffer = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
	var buffer = __require("buffer");
	var Buffer = buffer.Buffer;
	function copyProps(src, dst) {
		for (var key in src) dst[key] = src[key];
	}
	if (Buffer.from && Buffer.alloc && Buffer.allocUnsafe && Buffer.allocUnsafeSlow) module.exports = buffer;
	else {
		copyProps(buffer, exports);
		exports.Buffer = SafeBuffer;
	}
	function SafeBuffer(arg, encodingOrOffset, length) {
		return Buffer(arg, encodingOrOffset, length);
	}
	SafeBuffer.prototype = Object.create(Buffer.prototype);
	copyProps(Buffer, SafeBuffer);
	SafeBuffer.from = function(arg, encodingOrOffset, length) {
		if (typeof arg === "number") throw new TypeError("Argument must not be a number");
		return Buffer(arg, encodingOrOffset, length);
	};
	SafeBuffer.alloc = function(size, fill, encoding) {
		if (typeof size !== "number") throw new TypeError("Argument must be a number");
		var buf = Buffer(size);
		if (fill !== void 0) if (typeof encoding === "string") buf.fill(fill, encoding);
		else buf.fill(fill);
		else buf.fill(0);
		return buf;
	};
	SafeBuffer.allocUnsafe = function(size) {
		if (typeof size !== "number") throw new TypeError("Argument must be a number");
		return Buffer(size);
	};
	SafeBuffer.allocUnsafeSlow = function(size) {
		if (typeof size !== "number") throw new TypeError("Argument must be a number");
		return buffer.SlowBuffer(size);
	};
}));
//#endregion
//#region ../../node_modules/ecdsa-sig-formatter/src/param-bytes-for-alg.js
var require_param_bytes_for_alg = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	function getParamSize(keySize) {
		return (keySize / 8 | 0) + (keySize % 8 === 0 ? 0 : 1);
	}
	var paramBytesForAlg = {
		ES256: getParamSize(256),
		ES384: getParamSize(384),
		ES512: getParamSize(521)
	};
	function getParamBytesForAlg(alg) {
		var paramBytes = paramBytesForAlg[alg];
		if (paramBytes) return paramBytes;
		throw new Error("Unknown algorithm \"" + alg + "\"");
	}
	module.exports = getParamBytesForAlg;
}));
//#endregion
//#region ../../node_modules/ecdsa-sig-formatter/src/ecdsa-sig-formatter.js
var require_ecdsa_sig_formatter = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	var Buffer = require_safe_buffer().Buffer;
	var getParamBytesForAlg = require_param_bytes_for_alg();
	var MAX_OCTET = 128;
	var CLASS_UNIVERSAL = 0;
	var PRIMITIVE_BIT = 32;
	var TAG_SEQ = 16;
	var TAG_INT = 2;
	var ENCODED_TAG_SEQ = TAG_SEQ | PRIMITIVE_BIT | CLASS_UNIVERSAL << 6;
	var ENCODED_TAG_INT = TAG_INT | CLASS_UNIVERSAL << 6;
	function base64Url(base64) {
		return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
	}
	function signatureAsBuffer(signature) {
		if (Buffer.isBuffer(signature)) return signature;
		else if ("string" === typeof signature) return Buffer.from(signature, "base64");
		throw new TypeError("ECDSA signature must be a Base64 string or a Buffer");
	}
	function derToJose(signature, alg) {
		signature = signatureAsBuffer(signature);
		var paramBytes = getParamBytesForAlg(alg);
		var maxEncodedParamLength = paramBytes + 1;
		var inputLength = signature.length;
		var offset = 0;
		if (signature[offset++] !== ENCODED_TAG_SEQ) throw new Error("Could not find expected \"seq\"");
		var seqLength = signature[offset++];
		if (seqLength === (MAX_OCTET | 1)) seqLength = signature[offset++];
		if (inputLength - offset < seqLength) throw new Error("\"seq\" specified length of \"" + seqLength + "\", only \"" + (inputLength - offset) + "\" remaining");
		if (signature[offset++] !== ENCODED_TAG_INT) throw new Error("Could not find expected \"int\" for \"r\"");
		var rLength = signature[offset++];
		if (inputLength - offset - 2 < rLength) throw new Error("\"r\" specified length of \"" + rLength + "\", only \"" + (inputLength - offset - 2) + "\" available");
		if (maxEncodedParamLength < rLength) throw new Error("\"r\" specified length of \"" + rLength + "\", max of \"" + maxEncodedParamLength + "\" is acceptable");
		var rOffset = offset;
		offset += rLength;
		if (signature[offset++] !== ENCODED_TAG_INT) throw new Error("Could not find expected \"int\" for \"s\"");
		var sLength = signature[offset++];
		if (inputLength - offset !== sLength) throw new Error("\"s\" specified length of \"" + sLength + "\", expected \"" + (inputLength - offset) + "\"");
		if (maxEncodedParamLength < sLength) throw new Error("\"s\" specified length of \"" + sLength + "\", max of \"" + maxEncodedParamLength + "\" is acceptable");
		var sOffset = offset;
		offset += sLength;
		if (offset !== inputLength) throw new Error("Expected to consume entire buffer, but \"" + (inputLength - offset) + "\" bytes remain");
		var rPadding = paramBytes - rLength, sPadding = paramBytes - sLength;
		var dst = Buffer.allocUnsafe(rPadding + rLength + sPadding + sLength);
		for (offset = 0; offset < rPadding; ++offset) dst[offset] = 0;
		signature.copy(dst, offset, rOffset + Math.max(-rPadding, 0), rOffset + rLength);
		offset = paramBytes;
		for (var o = offset; offset < o + sPadding; ++offset) dst[offset] = 0;
		signature.copy(dst, offset, sOffset + Math.max(-sPadding, 0), sOffset + sLength);
		dst = dst.toString("base64");
		dst = base64Url(dst);
		return dst;
	}
	function countPadding(buf, start, stop) {
		var padding = 0;
		while (start + padding < stop && buf[start + padding] === 0) ++padding;
		if (buf[start + padding] >= MAX_OCTET) --padding;
		return padding;
	}
	function joseToDer(signature, alg) {
		signature = signatureAsBuffer(signature);
		var paramBytes = getParamBytesForAlg(alg);
		var signatureBytes = signature.length;
		if (signatureBytes !== paramBytes * 2) throw new TypeError("\"" + alg + "\" signatures must be \"" + paramBytes * 2 + "\" bytes, saw \"" + signatureBytes + "\"");
		var rPadding = countPadding(signature, 0, paramBytes);
		var sPadding = countPadding(signature, paramBytes, signature.length);
		var rLength = paramBytes - rPadding;
		var sLength = paramBytes - sPadding;
		var rsBytes = 2 + rLength + 1 + 1 + sLength;
		var shortLength = rsBytes < MAX_OCTET;
		var dst = Buffer.allocUnsafe((shortLength ? 2 : 3) + rsBytes);
		var offset = 0;
		dst[offset++] = ENCODED_TAG_SEQ;
		if (shortLength) dst[offset++] = rsBytes;
		else {
			dst[offset++] = MAX_OCTET | 1;
			dst[offset++] = rsBytes & 255;
		}
		dst[offset++] = ENCODED_TAG_INT;
		dst[offset++] = rLength;
		if (rPadding < 0) {
			dst[offset++] = 0;
			offset += signature.copy(dst, offset, 0, paramBytes);
		} else offset += signature.copy(dst, offset, rPadding, paramBytes);
		dst[offset++] = ENCODED_TAG_INT;
		dst[offset++] = sLength;
		if (sPadding < 0) {
			dst[offset++] = 0;
			signature.copy(dst, offset, paramBytes);
		} else signature.copy(dst, offset, paramBytes + sPadding);
		return dst;
	}
	module.exports = {
		derToJose,
		joseToDer
	};
}));
//#endregion
export { require_safe_buffer as n, require_ecdsa_sig_formatter as t };
