/** Table structure tags where `<br>` is invalid HTML and triggers React hydration errors. */
const TABLE_STRUCTURE_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
]);

type HastNode = {
  type?: string;
  tagName?: string;
  children?: HastNode[];
};

function isBrElement(node: HastNode): boolean {
  return node.type === "element" && node.tagName === "br";
}

function stripBrFromTableParents(node: HastNode): void {
  const children = node.children;
  if (!children?.length) return;

  if (node.type === "element" && TABLE_STRUCTURE_TAGS.has(node.tagName ?? "")) {
    node.children = children.filter((child) => !isBrElement(child));
  }

  for (const child of node.children ?? []) {
    stripBrFromTableParents(child);
  }
}

/**
 * Stream's `keepLineBreaksPlugin` inserts `<br>` between mdast siblings when the
 * source has extra blank lines — including between `tableRow` nodes. That yields
 * `<tbody><br><tr>…</tr></tbody>`, which is invalid HTML and fails hydration.
 */
export function rehypeSanitizeTableBr() {
  return (tree: HastNode) => {
    stripBrFromTableParents(tree);
  };
}
