import {
  SyntaxKind,
  type AnyToken,
  type CellToken,
  type IdentToken,
  type NumberLiteralToken,
  type RefToken,
  type StringLiteralToken,
} from "./syntax";

// Tried in priority order at each position. First match wins.
const REF_RE = /^([A-Za-z0-9_-]+)@([A-Za-z0-9_-]+)/;
const NUMBER_RE = /^[0-9]+(?:\.[0-9]+)?/;
const STRING_RE = /^"((?:[^"\\]|\\.)*)"/;
const CELL_RE = /^([A-Z]+)([0-9]+)(?![A-Za-z0-9_-])/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

/**
 * Lex a formula body (the substring after the leading `=`). Throws on
 * unexpected characters; the evaluator wraps in try/catch.
 *
 * Token priority is deliberate:
 *  - REF first so a stored `colId@rowId` always lexes as a single ref
 *  - STRING and NUMBER are easy to disambiguate
 *  - CELL (A1) requires uppercase letters + digits + a non-word boundary
 *    after, so it doesn't shadow nanoid ids like `A1bcdEFG@...`
 *  - IDENT is last — function names + TRUE / FALSE
 */
export function tokenize(input: string): AnyToken[] {
  const tokens: AnyToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "+") {
      tokens.push({ kind: SyntaxKind.PlusToken });
      i++;
      continue;
    }
    if (ch === "-") {
      tokens.push({ kind: SyntaxKind.MinusToken });
      i++;
      continue;
    }
    if (ch === "*") {
      tokens.push({ kind: SyntaxKind.AsteriskToken });
      i++;
      continue;
    }
    if (ch === "/") {
      tokens.push({ kind: SyntaxKind.SlashToken });
      i++;
      continue;
    }
    if (ch === "%") {
      tokens.push({ kind: SyntaxKind.PercentToken });
      i++;
      continue;
    }
    if (ch === "^") {
      tokens.push({ kind: SyntaxKind.CaretToken });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: SyntaxKind.OpenParenthesisToken });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: SyntaxKind.CloseParenthesisToken });
      i++;
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: SyntaxKind.ColonToken });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: SyntaxKind.CommaToken });
      i++;
      continue;
    }

    const slice = input.slice(i);

    const refMatch = slice.match(REF_RE);
    if (refMatch) {
      const ref = refMatch[0];
      tokens.push({ kind: SyntaxKind.RefToken, ref } as RefToken);
      i += refMatch[0].length;
      continue;
    }

    const stringMatch = slice.match(STRING_RE);
    if (stringMatch) {
      const raw = stringMatch[1] ?? "";
      const unescaped = raw.replace(/\\(.)/g, "$1");
      tokens.push({
        kind: SyntaxKind.StringLiteralToken,
        value: unescaped,
      } as StringLiteralToken);
      i += stringMatch[0].length;
      continue;
    }

    const numberMatch = slice.match(NUMBER_RE);
    if (numberMatch) {
      tokens.push({
        kind: SyntaxKind.NumberLiteralToken,
        value: Number.parseFloat(numberMatch[0]),
      } as NumberLiteralToken);
      i += numberMatch[0].length;
      continue;
    }

    const cellMatch = slice.match(CELL_RE);
    if (cellMatch) {
      tokens.push({
        kind: SyntaxKind.CellToken,
        cell: [cellMatch[1]!, cellMatch[2]!],
      } as CellToken);
      i += cellMatch[0].length;
      continue;
    }

    const identMatch = slice.match(IDENT_RE);
    if (identMatch) {
      tokens.push({
        kind: SyntaxKind.IdentToken,
        name: identMatch[0],
      } as IdentToken);
      i += identMatch[0].length;
      continue;
    }

    throw new Error(`Unexpected character "${ch}" at index ${i}`);
  }
  tokens.push({ kind: SyntaxKind.EndOfTokens });
  return tokens;
}
