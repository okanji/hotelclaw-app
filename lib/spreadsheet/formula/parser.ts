import {
  SyntaxKind,
  type AnyToken,
  type AstNode,
  type BinaryOperator,
  type FunctionCallNode,
  type IdentToken,
  type NumberLiteralToken,
  type RangeNode,
  type RefToken,
  type StringLiteralToken,
  type UnaryOperator,
} from "./syntax";

/**
 * Recursive-descent parser. Precedence low→high:
 *   1. + -
 *   2. * / %
 *   3. ^      (right-assoc)
 *   4. unary +/-
 *   5. NumberLiteral | StringLiteral | functionCall | rangeOrRef | (...)
 */
export function parse(tokens: AnyToken[]): AstNode {
  let pos = 0;
  function peek(): AnyToken {
    return tokens[pos]!;
  }
  function consume(): AnyToken {
    return tokens[pos++]!;
  }
  function expect<K extends SyntaxKind>(kind: K): AnyToken & { kind: K } {
    const tok = consume();
    if (tok.kind !== kind) {
      throw new Error(
        `Expected token ${SyntaxKind[kind]}, got ${SyntaxKind[tok.kind]}`,
      );
    }
    return tok as AnyToken & { kind: K };
  }

  function parseExpression(): AstNode {
    let left = parseTerm();
    while (
      peek().kind === SyntaxKind.PlusToken ||
      peek().kind === SyntaxKind.MinusToken
    ) {
      const op = consume().kind as BinaryOperator;
      const right = parseTerm();
      left = { kind: SyntaxKind.BinaryExpression, operator: op, left, right };
    }
    return left;
  }

  function parseTerm(): AstNode {
    let left = parseExponent();
    while (
      peek().kind === SyntaxKind.AsteriskToken ||
      peek().kind === SyntaxKind.SlashToken ||
      peek().kind === SyntaxKind.PercentToken
    ) {
      const op = consume().kind as BinaryOperator;
      const right = parseExponent();
      left = { kind: SyntaxKind.BinaryExpression, operator: op, left, right };
    }
    return left;
  }

  function parseExponent(): AstNode {
    let left = parseUnary();
    while (peek().kind === SyntaxKind.CaretToken) {
      const op = consume().kind as BinaryOperator;
      const right = parseExponent(); // right-assoc
      left = { kind: SyntaxKind.BinaryExpression, operator: op, left, right };
    }
    return left;
  }

  function parseUnary(): AstNode {
    if (
      peek().kind === SyntaxKind.PlusToken ||
      peek().kind === SyntaxKind.MinusToken
    ) {
      const op = consume().kind as UnaryOperator;
      const operand = parseUnary();
      return { kind: SyntaxKind.UnaryExpression, operator: op, operand };
    }
    return parseAtom();
  }

  function parseAtom(): AstNode {
    const tok = peek();
    if (tok.kind === SyntaxKind.NumberLiteralToken) {
      consume();
      return {
        kind: SyntaxKind.NumberLiteral,
        value: (tok as NumberLiteralToken).value,
      };
    }
    if (tok.kind === SyntaxKind.StringLiteralToken) {
      consume();
      return {
        kind: SyntaxKind.StringLiteral,
        value: (tok as StringLiteralToken).value,
      };
    }
    if (tok.kind === SyntaxKind.RefToken) {
      consume();
      const ref = (tok as RefToken).ref;
      // Range if followed by a `:` and another ref.
      if (peek().kind === SyntaxKind.ColonToken) {
        consume();
        const next = consume();
        if (next.kind !== SyntaxKind.RefToken) {
          throw new Error("Expected cell reference after ':' in range");
        }
        const range: RangeNode = {
          kind: SyntaxKind.Range,
          startRef: ref,
          endRef: (next as RefToken).ref,
        };
        return range;
      }
      return { kind: SyntaxKind.Ref, ref };
    }
    if (tok.kind === SyntaxKind.IdentToken) {
      consume();
      const name = (tok as IdentToken).name;
      // Boolean literals — TRUE / FALSE — surface as NumberLiteral 1/0
      // for the existing arithmetic operators. The evaluator special-cases
      // logical functions (IF, AND, OR, NOT) to read 1/0 as truthy/falsy.
      const upper = name.toUpperCase();
      if (upper === "TRUE") {
        return { kind: SyntaxKind.NumberLiteral, value: 1 };
      }
      if (upper === "FALSE") {
        return { kind: SyntaxKind.NumberLiteral, value: 0 };
      }
      // Function call (the only other valid ident in atom position).
      expect(SyntaxKind.OpenParenthesisToken);
      const args: AstNode[] = [];
      if (peek().kind !== SyntaxKind.CloseParenthesisToken) {
        args.push(parseExpression());
        while (peek().kind === SyntaxKind.CommaToken) {
          consume();
          args.push(parseExpression());
        }
      }
      expect(SyntaxKind.CloseParenthesisToken);
      const call: FunctionCallNode = {
        kind: SyntaxKind.FunctionCall,
        name: upper,
        args,
      };
      return call;
    }
    if (tok.kind === SyntaxKind.OpenParenthesisToken) {
      consume();
      const expr = parseExpression();
      expect(SyntaxKind.CloseParenthesisToken);
      return expr;
    }
    throw new Error(`Unexpected token ${SyntaxKind[tok.kind]}`);
  }

  const ast = parseExpression();
  if (peek().kind !== SyntaxKind.EndOfTokens) {
    throw new Error("Trailing tokens after expression");
  }
  return ast;
}
