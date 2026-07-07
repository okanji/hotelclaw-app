/**
 * AST + token kinds for the spreadsheet formula language.
 *
 * Ported from Liveblocks's nextjs-spreadsheet-advanced example, extended with
 * function calls + range expressions + string literals so the language can
 * support SUM(A1:A5), CONCAT("hi", B2), etc.
 *
 * Grammar (simplified):
 *
 *   expression := unary
 *   unary      := ('+' | '-')? exponent
 *   exponent   := term ('^' term)*
 *   term       := atom (('*' | '/' | '%') atom)*
 *   atom       := unary | NumberLiteral | StringLiteral | functionCall | rangeOrRef | '(' expression ')'
 *   functionCall := IDENT '(' (expression (',' expression)*)? ')'
 *   rangeOrRef := ref (':' ref)?
 */

export enum SyntaxKind {
  PlusToken,
  MinusToken,
  AsteriskToken,
  SlashToken,
  PercentToken,
  CaretToken,
  OpenParenthesisToken,
  CloseParenthesisToken,
  ColonToken,
  CommaToken,
  AmpersandToken, // & — string concat
  EqualsToken, // = (inside formula body — comparison)
  NotEqualsToken, // <>
  LessThanToken, // <
  LessEqualToken, // <=
  GreaterThanToken, // >
  GreaterEqualToken, // >=
  EndOfTokens,
  NumberLiteralToken,
  StringLiteralToken,
  CellToken, // A1 form, pre-resolution
  RefToken, // colId@rowId form, post-resolution
  IdentToken, // function name / TRUE / FALSE / named-range

  // AST nodes
  Expression,
  UnaryExpression,
  BinaryExpression,
  NumberLiteral,
  StringLiteral,
  Ref,
  Range,
  FunctionCall,
  /** A named-range reference resolved at eval time via the workbook. */
  NamedRef,
}

export interface Token<K extends SyntaxKind = SyntaxKind> {
  kind: K;
}

export interface NumberLiteralToken extends Token<SyntaxKind.NumberLiteralToken> {
  value: number;
}
export interface StringLiteralToken extends Token<SyntaxKind.StringLiteralToken> {
  value: string;
}
/** Pre-resolution A1 ref. Produced only by the user-input tokenizer path. */
export interface CellToken extends Token<SyntaxKind.CellToken> {
  cell: [letter: string, number: string];
}
/** Post-resolution cell id ref — `colId@rowId`. */
export interface RefToken extends Token<SyntaxKind.RefToken> {
  ref: string;
}
export interface IdentToken extends Token<SyntaxKind.IdentToken> {
  name: string;
}

export type AnyToken =
  | Token<SyntaxKind.PlusToken>
  | Token<SyntaxKind.MinusToken>
  | Token<SyntaxKind.AsteriskToken>
  | Token<SyntaxKind.SlashToken>
  | Token<SyntaxKind.PercentToken>
  | Token<SyntaxKind.CaretToken>
  | Token<SyntaxKind.OpenParenthesisToken>
  | Token<SyntaxKind.CloseParenthesisToken>
  | Token<SyntaxKind.ColonToken>
  | Token<SyntaxKind.CommaToken>
  | Token<SyntaxKind.AmpersandToken>
  | Token<SyntaxKind.EqualsToken>
  | Token<SyntaxKind.NotEqualsToken>
  | Token<SyntaxKind.LessThanToken>
  | Token<SyntaxKind.LessEqualToken>
  | Token<SyntaxKind.GreaterThanToken>
  | Token<SyntaxKind.GreaterEqualToken>
  | Token<SyntaxKind.EndOfTokens>
  | NumberLiteralToken
  | StringLiteralToken
  | CellToken
  | RefToken
  | IdentToken;

// AST nodes
export interface NumberLiteralNode {
  kind: SyntaxKind.NumberLiteral;
  value: number;
}
export interface StringLiteralNode {
  kind: SyntaxKind.StringLiteral;
  value: string;
}
export interface RefNode {
  kind: SyntaxKind.Ref;
  ref: string;
}
/** A1:B5 — inclusive rectangle defined by two corner cell ids. */
export interface RangeNode {
  kind: SyntaxKind.Range;
  startRef: string;
  endRef: string;
}
export interface FunctionCallNode {
  kind: SyntaxKind.FunctionCall;
  name: string;
  args: AstNode[];
}

export interface NamedRefNode {
  kind: SyntaxKind.NamedRef;
  name: string;
}

export type UnaryOperator = SyntaxKind.PlusToken | SyntaxKind.MinusToken;
export type BinaryOperator =
  | SyntaxKind.PlusToken
  | SyntaxKind.MinusToken
  | SyntaxKind.AsteriskToken
  | SyntaxKind.SlashToken
  | SyntaxKind.PercentToken
  | SyntaxKind.CaretToken
  | SyntaxKind.AmpersandToken
  | SyntaxKind.EqualsToken
  | SyntaxKind.NotEqualsToken
  | SyntaxKind.LessThanToken
  | SyntaxKind.LessEqualToken
  | SyntaxKind.GreaterThanToken
  | SyntaxKind.GreaterEqualToken;

export interface UnaryExpressionNode {
  kind: SyntaxKind.UnaryExpression;
  operator: UnaryOperator;
  operand: AstNode;
}
export interface BinaryExpressionNode {
  kind: SyntaxKind.BinaryExpression;
  operator: BinaryOperator;
  left: AstNode;
  right: AstNode;
}

export type AstNode =
  | NumberLiteralNode
  | StringLiteralNode
  | RefNode
  | RangeNode
  | FunctionCallNode
  | NamedRefNode
  | UnaryExpressionNode
  | BinaryExpressionNode;

/**
 * A function's evaluated argument. Numbers and strings stay scalar; a range
 * expands to an array of `cellId`s the function can iterate over.
 */
export type FunctionArg =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean }
  | { type: "error" }
  | { type: "range"; refs: string[] };

export type ExpressionResult =
  | { type: "error" }
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "boolean"; value: boolean };
