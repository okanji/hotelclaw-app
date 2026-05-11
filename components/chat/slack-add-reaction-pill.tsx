"use client";

import React, { useState } from "react";
import {
  DialogAnchor,
  IconEmojiAdd,
  ReactionSelector as StreamReactionSelector,
  useComponentContext,
  useDialogIsOpen,
  useDialogOnNearestManager,
  useMessageContext,
  useTranslationContext,
} from "stream-chat-react";

/**
 * Inline “add reaction” control for the row under the message (Slack).
 * Pairs with filtering the quick-action emoji out of {@link MessageActions} when the message already has reactions.
 */
export function SlackAddReactionPill() {
  const { t } = useTranslationContext("ReactionSelectorWithButton");
  const { isMyMessage, message, threadList } = useMessageContext("SlackAddReactionPill");
  const { ReactionSelector: ReactionSelectorComponent = StreamReactionSelector } = useComponentContext(
    "SlackAddReactionPill",
  );
  const [anchorElement, setAnchorElement] = useState<HTMLButtonElement | null>(null);
  const dialogId = StreamReactionSelector.getDialogId({
    messageId: message.id,
    threadList,
  });
  const { dialog, dialogManager } = useDialogOnNearestManager({ id: dialogId });
  const dialogIsOpen = useDialogIsOpen(dialogId, dialogManager?.id);

  /** Re-run popper when opening or anchor mounts so first open matches Slack (anchored to the pill). */
  const positionKey = `${dialogIsOpen}:${anchorElement ? "mounted" : "none"}`;

  return (
    <>
      <DialogAnchor
        allowFlip
        dialogManagerId={dialogManager?.id}
        id={dialogId}
        offset={12}
        placement={isMyMessage() ? "top-end" : "top-start"}
        referenceElement={anchorElement}
        trapFocus
        updateKey={positionKey}
        updatePositionOnContentResize
      >
        <ReactionSelectorComponent />
      </DialogAnchor>
      <button
        ref={setAnchorElement}
        type="button"
        className="str-chat__slack-add-reaction-pill"
        aria-label={t("aria/Open Reaction Selector")}
        aria-expanded={dialogIsOpen}
        data-testid="slack-add-reaction-pill"
        onClick={() => dialog?.toggle()}
      >
        <IconEmojiAdd className="str-chat__slack-add-reaction-pill__icon" />
      </button>
    </>
  );
}
