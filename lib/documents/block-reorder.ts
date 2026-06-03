"use client";

/**
 * Pointer-based block reorder — Notion / "rails" sortable behavior.
 *
 * Why custom (not `tiptap-extension-global-drag-handle`):
 *   - HTML5 drag puts the drag preview wherever the cursor goes; we want
 *     the preview rail-locked to the block's column and only tracking Y.
 *   - HTML5 drag's interaction with Liveblocks/Yjs has produced silent
 *     drop failures in this codebase.
 *   - Direct pointer events + a single ProseMirror transaction is simpler
 *     to reason about, easier to debug, and gives us a drop-indicator line.
 *
 * Behavior:
 *   - On pointermove over the editor we find the top-level block under
 *     the cursor and position a `<div class="drag-handle">` next to its
 *     left edge. Empty paragraphs and the title are skipped.
 *   - On pointerdown on the handle we capture the source block's position,
 *     start tracking pointer movement at window level, and render two
 *     transient elements:
 *       • `.block-drag-ghost` — a faded clone of the source block, fixed
 *         to its original X (rail-locked) and following the cursor's Y.
 *       • `.block-drag-indicator` — a 2px horizontal bar showing the
 *         drop position (the gap before/after some sibling).
 *   - On pointerup we compute the target gap from cursor Y, run a single
 *     `delete + insert` transaction, and Yjs syncs the move.
 *
 * Constraints:
 *   - Title (first top-level node) is neither draggable nor a drop target.
 *   - Empty text blocks are not draggable (no content to move).
 *   - Dropping into the source's own range is a no-op.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

const PLUGIN_KEY = new PluginKey("blockReorder");
const HANDLE_WIDTH = 20;
const HANDLE_HEIGHT = 22;
const HANDLE_GAP = 6; // px between handle right edge and block left edge

type DragSession = {
  sourcePos: number;
  sourceSize: number;
  sourceRect: DOMRect;
  ghost: HTMLElement;
  indicator: HTMLElement;
  targetPos: number | null;
};

export const BlockReorder = Extension.create({
  name: "blockReorder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: PLUGIN_KEY,
        view(view) {
          const controller = new BlockReorderView(view);
          return {
            destroy: () => controller.destroy(),
          };
        },
      }),
    ];
  },
});

class BlockReorderView {
  private view: EditorView;
  private handle: HTMLButtonElement;
  private hoveredBlock: { pos: number; nodeSize: number; rect: DOMRect } | null =
    null;
  private drag: DragSession | null = null;

  constructor(view: EditorView) {
    this.view = view;

    // Single handle element, reused across hovers. Lives in the editor's
    // wrapper so it scrolls with the doc but doesn't interfere with the
    // editable surface.
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.setAttribute("aria-label", "Drag block");
    handle.style.display = "none";
    view.dom.parentElement?.appendChild(handle);
    this.handle = handle;

    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerLeave = this.onPointerLeave.bind(this);
    this.onHandlePointerDown = this.onHandlePointerDown.bind(this);
    this.onDragMove = this.onDragMove.bind(this);
    this.onDragEnd = this.onDragEnd.bind(this);
    this.onScroll = this.onScroll.bind(this);

    view.dom.addEventListener("pointermove", this.onPointerMove);
    view.dom.addEventListener("pointerleave", this.onPointerLeave);
    handle.addEventListener("pointerdown", this.onHandlePointerDown);
    // The handle is position: fixed, so when the editor scrolls we need
    // to either reposition or hide it. Hiding is simpler and matches
    // Notion's behavior.
    window.addEventListener("scroll", this.onScroll, true);
  }

  destroy() {
    this.endDrag(); // belt and braces if drag was in flight
    this.view.dom.removeEventListener("pointermove", this.onPointerMove);
    this.view.dom.removeEventListener("pointerleave", this.onPointerLeave);
    this.handle.removeEventListener("pointerdown", this.onHandlePointerDown);
    window.removeEventListener("scroll", this.onScroll, true);
    this.handle.remove();
  }

  // ── Hover ──────────────────────────────────────────────────────────────

  private onPointerMove(event: PointerEvent) {
    if (this.drag) return; // ignore hover while dragging
    const block = this.findBlockAtPoint(event.clientY);
    if (!block) {
      this.hideHandle();
      return;
    }
    this.hoveredBlock = block;
    this.positionHandle(block.rect);
  }

  private onPointerLeave() {
    if (this.drag) return;
    this.hideHandle();
  }

  private onScroll() {
    if (this.drag) {
      // During drag we want the ghost/indicator to track scroll; refresh.
      this.refreshDragVisuals();
      return;
    }
    // While not dragging, just hide the stale handle.
    this.hideHandle();
  }

  private hideHandle() {
    this.handle.style.display = "none";
    this.hoveredBlock = null;
  }

  private positionHandle(rect: DOMRect) {
    // Vertically center the handle on the first line of the block. Using
    // the block's font line-height when available; falls back to 24px.
    const lineHeight = this.firstLineHeight(rect.top, rect.left + 4) ?? 24;
    const verticalOffset = Math.max(0, (lineHeight - HANDLE_HEIGHT) / 2);
    this.handle.style.display = "flex";
    this.handle.style.left = `${rect.left - HANDLE_WIDTH - HANDLE_GAP}px`;
    this.handle.style.top = `${rect.top + verticalOffset}px`;
  }

  /** Best-effort line-height read at the given DOM point. */
  private firstLineHeight(y: number, x: number): number | null {
    const el = document.elementFromPoint(x, y);
    if (!(el instanceof HTMLElement)) return null;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight);
    if (!Number.isFinite(lh)) return null;
    return lh;
  }

  /** Find the top-level block (excluding title + empty paragraphs) at Y. */
  private findBlockAtPoint(
    y: number,
  ): { pos: number; nodeSize: number; rect: DOMRect } | null {
    const doc = this.view.dom;
    // Iterate direct children of .ProseMirror — each is a top-level node.
    const children = Array.from(doc.children) as HTMLElement[];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) continue;
      const rect = child.getBoundingClientRect();
      if (y < rect.top || y > rect.bottom) continue;
      // Skip the title (always the first top-level child).
      if (i === 0) return null;
      // Resolve the prosemirror position for this DOM node and walk up
      // to the top-level node containing it.
      const pos = this.view.posAtDOM(child, 0);
      if (pos == null || pos < 0) return null;
      const $pos = this.view.state.doc.resolve(pos);
      const topPos = $pos.depth > 0 ? $pos.before(1) : pos;
      const node = this.view.state.doc.nodeAt(topPos);
      if (!node) return null;
      // Skip truly empty text blocks (no content to drag).
      if (node.isTextblock && node.content.size === 0) return null;
      return { pos: topPos, nodeSize: node.nodeSize, rect };
    }
    return null;
  }

  // ── Drag start ─────────────────────────────────────────────────────────

  private onHandlePointerDown(event: PointerEvent) {
    if (event.button !== 0) return; // left button only
    if (!this.hoveredBlock) return;
    event.preventDefault();
    event.stopPropagation();

    const { pos, nodeSize, rect } = this.hoveredBlock;
    const source = this.view.nodeDOM(pos);
    if (!(source instanceof HTMLElement)) return;

    // Ghost — visually a clone of the source block, faded, position-fixed
    // at the source's X. Y follows pointer.
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.className = `block-drag-ghost ${ghost.className}`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    // Prevent ProseMirror from acting on the clone.
    ghost.removeAttribute("contenteditable");
    document.body.appendChild(ghost);

    // Indicator — a horizontal bar aligned with the source's column. Hidden
    // until a drop target is found.
    const indicator = document.createElement("div");
    indicator.className = "block-drag-indicator";
    indicator.style.left = `${rect.left}px`;
    indicator.style.width = `${rect.width}px`;
    indicator.style.display = "none";
    document.body.appendChild(indicator);

    this.drag = {
      sourcePos: pos,
      sourceSize: nodeSize,
      sourceRect: rect,
      ghost,
      indicator,
      targetPos: null,
    };

    document.body.classList.add("block-dragging");
    this.handle.style.display = "none";

    window.addEventListener("pointermove", this.onDragMove);
    window.addEventListener("pointerup", this.onDragEnd);
    window.addEventListener("pointercancel", this.onDragEnd);

    // Run an initial position update so the ghost shows immediately.
    this.onDragMove(event);
  }

  // ── Drag move ──────────────────────────────────────────────────────────

  private onDragMove(event: PointerEvent) {
    if (!this.drag) return;
    const { ghost, indicator, sourceRect } = this.drag;

    // Ghost Y follows the cursor — keep the same grab offset (cursor lands
    // where the user pressed, roughly the top of the block).
    const cursorY = event.clientY;
    ghost.style.top = `${cursorY - sourceRect.height / 2}px`;

    // Find the drop target (the gap with the smallest distance to cursorY).
    const target = this.computeDropTarget(cursorY);
    this.drag.targetPos = target?.pos ?? null;
    if (target) {
      indicator.style.display = "block";
      indicator.style.left = `${target.left}px`;
      indicator.style.width = `${target.width}px`;
      indicator.style.top = `${target.y - 1}px`;
    } else {
      indicator.style.display = "none";
    }
  }

  private refreshDragVisuals() {
    // No-op fallback for scroll — the ghost is fixed, so it just stays.
    // Reposition indicator since its target moved with scroll.
    if (!this.drag) return;
    // We'd need the last cursor position to recompute. Cheap path: hide
    // the indicator until next pointermove.
    this.drag.indicator.style.display = "none";
  }

  /**
   * Find the best drop "gap" — the position between two siblings whose
   * mid-line is closest to the cursor's Y. Skips positions that would
   * drop into the source block's own range.
   */
  private computeDropTarget(
    cursorY: number,
  ): { pos: number; y: number; left: number; width: number } | null {
    if (!this.drag) return null;
    const { sourcePos, sourceSize } = this.drag;
    const doc = this.view.state.doc;
    let best: { pos: number; y: number; left: number; width: number } | null =
      null;
    let bestDist = Infinity;

    doc.forEach((node, nodeOffset, index) => {
      const dom = this.view.nodeDOM(nodeOffset);
      if (!(dom instanceof HTMLElement)) return;
      const rect = dom.getBoundingClientRect();

      // Gap BEFORE this node. Skip the gap that's before the title.
      if (index !== 0) {
        const dist = Math.abs(cursorY - rect.top);
        if (dist < bestDist) {
          const pos = nodeOffset;
          if (!this.isInsideSource(pos, sourcePos, sourceSize)) {
            bestDist = dist;
            best = { pos, y: rect.top, left: rect.left, width: rect.width };
          }
        }
      }

      // Gap AFTER this node.
      const afterY = rect.bottom;
      const dist = Math.abs(cursorY - afterY);
      if (dist < bestDist) {
        const pos = nodeOffset + node.nodeSize;
        if (!this.isInsideSource(pos, sourcePos, sourceSize)) {
          bestDist = dist;
          best = { pos, y: afterY, left: rect.left, width: rect.width };
        }
      }
    });

    return best;
  }

  /** Treat positions immediately adjacent to source as no-op targets. */
  private isInsideSource(pos: number, sourcePos: number, sourceSize: number) {
    return pos >= sourcePos && pos <= sourcePos + sourceSize;
  }

  // ── Drag end ───────────────────────────────────────────────────────────

  private onDragEnd(_event: PointerEvent) {
    if (!this.drag) return;
    const { sourcePos, sourceSize, targetPos } = this.drag;

    // Tear down visuals BEFORE the transaction so the DOM is stable when
    // Yjs replays the change to other viewers.
    this.endDrag();

    if (targetPos == null) return;
    if (targetPos >= sourcePos && targetPos <= sourcePos + sourceSize) return;

    const view = this.view;
    const node = view.state.doc.nodeAt(sourcePos);
    if (!node) return;

    const tr = view.state.tr;
    tr.delete(sourcePos, sourcePos + sourceSize);
    const mappedTarget = tr.mapping.map(targetPos);
    tr.insert(mappedTarget, node);
    view.dispatch(tr);
  }

  private endDrag() {
    if (!this.drag) return;
    this.drag.ghost.remove();
    this.drag.indicator.remove();
    this.drag = null;
    document.body.classList.remove("block-dragging");
    window.removeEventListener("pointermove", this.onDragMove);
    window.removeEventListener("pointerup", this.onDragEnd);
    window.removeEventListener("pointercancel", this.onDragEnd);
  }
}
