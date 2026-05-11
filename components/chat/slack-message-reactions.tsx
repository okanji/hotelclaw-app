"use client";

import clsx from "clsx";
import type { ReactionGroupResponse } from "stream-chat";
import type { ComponentType } from "react";
import { useMemo } from "react";
import {
  defaultReactionOptions,
  useComponentContext,
  useMessageContext,
  useReactionHandler,
  useTranslationContext,
  type MessageReactionsProps,
} from "stream-chat-react";

export type SlackReactionDisplayRow = {
  reactionType: string;
  reactionCount: number;
  isOwnReaction: boolean;
  firstReactionAt: Date | null;
  EmojiComponent: ComponentType<object> | null;
};

function sortSlackReactionRows(a: SlackReactionDisplayRow, b: SlackReactionDisplayRow): number {
  if (a.firstReactionAt && b.firstReactionAt) {
    return +a.firstReactionAt - +b.firstReactionAt;
  }
  return a.reactionType.localeCompare(b.reactionType, "en");
}

function emojiComponentForType(
  reactionOptions: unknown,
  reactionType: string,
): ComponentType<object> | null {
  if (!reactionOptions || typeof reactionOptions !== "object") return null;

  const opts = reactionOptions as typeof defaultReactionOptions | Array<{ type: string; Component?: ComponentType<object> }>;

  if (Array.isArray(opts)) {
    const row = opts.find((option) => option.type === reactionType);
    return row?.Component ?? null;
  }

  const quickComp = opts.quick[reactionType]?.Component as ComponentType<object> | undefined;
  const extComp = opts.extended?.[reactionType]?.Component as ComponentType<object> | undefined;
  return quickComp ?? extComp ?? null;
}

function useSlackReactionDisplayRows(props: Pick<MessageReactionsProps, "reaction_groups">): SlackReactionDisplayRow[] {
  const { message } = useMessageContext("SlackMessageReactions");
  const { reactionOptions = defaultReactionOptions } = useComponentContext("SlackMessageReactions");

  const isSupportedReaction = useMemo(() => {
    return (reactionType: string) => {
      if (Array.isArray(reactionOptions)) {
        return reactionOptions.some((option) => option.type === reactionType);
      }
      return (
        typeof reactionOptions.quick[reactionType] !== "undefined" ||
        typeof reactionOptions.extended?.[reactionType] !== "undefined"
      );
    };
  }, [reactionOptions]);

  const groups = props.reaction_groups ?? message.reaction_groups;

  return useMemo(() => {
    const map = groups as Record<string, ReactionGroupResponse> | undefined;
    if (!map) return [];

    const own = new Set((message.own_reactions ?? []).map((r) => r.type));

    const rows: SlackReactionDisplayRow[] = Object.entries(map).flatMap(
      ([reactionType, { count, first_reaction_at }]) => {
        if (count === 0 || !isSupportedReaction(reactionType)) return [];
        const EmojiComponent = emojiComponentForType(reactionOptions, reactionType);
        return [
          {
            reactionType,
            reactionCount: count,
            isOwnReaction: own.has(reactionType),
            firstReactionAt: first_reaction_at ? new Date(first_reaction_at as string) : null,
            EmojiComponent,
          },
        ];
      },
    );

    rows.sort(sortSlackReactionRows);
    return rows;
  }, [groups, isSupportedReaction, message.own_reactions, reactionOptions]);
}

/**
 * Slack-style reaction pills: click toggles your reaction via Stream’s
 * {@link useReactionHandler} (add if absent, remove if yours). Opens no “who reacted” sheet.
 */
export function SlackMessageReactions(props: MessageReactionsProps) {
  const {
    flipHorizontalPosition = false,
    reverse = false,
    verticalPosition = "bottom",
    visualStyle = "segmented",
  } = props;

  const { message } = useMessageContext("SlackMessageReactions");
  const { t } = useTranslationContext("MessageReactions");
  const handleReaction = useReactionHandler(message);
  const rows = useSlackReactionDisplayRows(props);

  const ordered = reverse ? [...rows].reverse() : rows;

  if (ordered.length === 0) return null;

  return (
    <div
      aria-label={t("aria/Reaction list")}
      className={clsx(
        "str-chat__message-reactions",
        `str-chat__message-reactions--${verticalPosition}`,
        `str-chat__message-reactions--${visualStyle}`,
        {
          "str-chat__message-reactions--flipped-horizontally": flipHorizontalPosition,
        },
      )}
      data-testid="slack-message-reactions"
      role="figure"
    >
      <ul className="str-chat__message-reactions__list">
        {ordered.map((row) => {
          if (!row.EmojiComponent) return null;
          const EmojiComponent = row.EmojiComponent;

          return (
            <li
              key={row.reactionType}
              className="str-chat__message-reactions__list-item"
              data-testid="message-reactions-list-item"
            >
              <button
                type="button"
                aria-label={t("aria/Select Reaction: {{ reactionName }}", {
                  reactionName: row.reactionType,
                })}
                aria-pressed={row.isOwnReaction}
                className="str-chat__message-reactions__list-item-button"
                data-slack-own-reaction={row.isOwnReaction ? "true" : undefined}
                data-testid="message-reactions-list-item-button"
                onClick={(event) => {
                  event.preventDefault();
                  void handleReaction(row.reactionType, event);
                }}
              >
                <span className="str-chat__message-reactions__list-item-icon" data-testid="message-reactions-list-item-icon">
                  <EmojiComponent />
                </span>
                {row.reactionCount >= 1 ? (
                  <span className="str-chat__message-reactions__list-item-count" data-testclass="message-reactions-item-count">
                    {row.reactionCount}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
