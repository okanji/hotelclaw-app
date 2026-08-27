"use client";

import { useEffect, useState } from "react";
import {
  Channel,
  ChatView,
  MessageList,
  Window,
  useChatContext,
} from "stream-chat-react";
import { SlackThread } from "./threads/slack-thread";
import type {
  Channel as StreamChannel,
  ChannelFilters,
  StreamChat,
} from "stream-chat";
import { ChannelHeader } from "./channel-header";
import { ChannelTabs } from "./channel-tabs";
import { ChannelInfoPanel } from "./info-panel/info-panel";
import { ArtifactAutoOpen } from "./artifact-auto-open";
import { ArtifactSidePanel } from "./artifact-side-panel";
import { ChannelSkeleton } from "./channel-skeleton";
import { SlackComposer } from "./slack-composer";
import { AiThinkingIndicator } from "./ai-thinking-indicator";
import { MessageJumper } from "./search/message-jumper";
import { JumpToLatestOverride } from "./jump-to-latest";
import { slackRenderText } from "./slack-render-text";
import { CLUSTER_TIME_GAP_MS, slackGroupStyles } from "./slack-message-ui";

type Props = {
  channelId: string;
  propertyId: string;
  messageId?: string | null;
};

/** Result of the cold-path query, tagged with the channelId it answers. */
type ColdResult = { channelId: string; channel: StreamChannel | null };

/**
 * Find a channel the sidebar <ChannelList> has already watched. Stream keeps
 * every watched channel in `client.activeChannels`, keyed by cid (`type:id`);
 * the route only carries the bare id, so scan by `.id`. An already-
 * `initialized` channel can be handed straight to <Channel> with no network
 * call — that's what makes switching feel instant.
 */
function findWarmChannel(
  client: StreamChat,
  channelId: string,
): StreamChannel | null {
  return (
    Object.values(client.activeChannels).find(
      (c) => c.id === channelId && c.initialized && !c.disconnected,
    ) ?? null
  );
}

/**
 * Renders one chat channel.
 *
 * Switching channels is instant because the target is almost always already
 * watched + fully in memory: the sidebar <ChannelList> mounts persistently
 * with `watch: true`, so every visible channel's state (messages, members)
 * lives in `client.activeChannels`. The warm path resolves that channel
 * synchronously during render — no `watch()` round-trip, no loading flash.
 *
 * The cold path (a deep link / hard refresh to a channel not yet in
 * `activeChannels`) does a single `queryChannels` and shows a skeleton.
 */
export function ChannelView({
  channelId,
  propertyId,
  messageId = null,
}: Props) {
  const { client } = useChatContext();

  // Warm path — derived synchronously, no effect, no state.
  const warmChannel = client ? findWarmChannel(client, channelId) : null;

  // Cold path — populated only from the effect's async callback below.
  const [cold, setCold] = useState<ColdResult | null>(null);

  useEffect(() => {
    // Warm channel already in hand (or no client yet) → nothing to fetch.
    if (!client || warmChannel) return;

    let cancelled = false;
    (async () => {
      const userID = client.userID;
      if (!userID) return;
      const filters: ChannelFilters = {
        id: channelId,
        members: { $in: [userID] },
      };
      try {
        const results = await client.queryChannels(
          filters,
          {},
          { watch: true, state: true },
        );
        if (cancelled) return;
        setCold({ channelId, channel: results[0] ?? null });
      } catch (e) {
        // Strict-mode double-mount: a query can resolve after the first
        // mount's disconnectUser(). The second mount re-queries on a fresh
        // client, so swallow the stale rejection.
        if (cancelled) return;
        console.error("queryChannels for channel failed", e);
      }
    })();

    return () => {
      cancelled = true;
      // Deliberately no stopWatching(): the channel object is shared with the
      // sidebar ChannelList — stopping it would kill its live updates and
      // unread counts.
    };
  }, [client, channelId, warmChannel]);

  // Ignore a cold result left over from a previous channelId (the route
  // remounts on channel change, but guard the rare client-reconnect case).
  const coldForThis = cold && cold.channelId === channelId ? cold : null;
  const channel = warmChannel ?? coldForThis?.channel ?? null;

  if (!channel) {
    // Cold query finished and found nothing → not a member / archived / gone.
    if (coldForThis) {
      return (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          This channel doesn’t exist or you don’t have access.
        </div>
      );
    }
    return <ChannelSkeleton />;
  }

  // <ChatView> wrapper: Stream's default <ThreadHeader> calls
  // useChatViewContext() and warns when no provider is found. Wrapping here
  // silences the warning without changing layout — ChatView just adds a
  // `display:flex; width:100%; height:100%` div around the Channel.
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ChatView>
        <Channel channel={channel}>
          {/* Swap Stream's stock scroll-down UI (grey label + circle/badge)
              for the house JumpToLatest pill — covers the main list AND the
              thread panel, both under this Channel. */}
          <JumpToLatestOverride>
          <Window>
            {/* Group consecutive rows from the same user (`noGroupByUser` unset).
                Stream marks cluster segments as top / middle / bottom; globals.css + SlackMessageUI
                flip avatar/metadata visibility so only the first row matches Slack (like Slack desktop).

                showAvatar is set but Stream's `<Message>` does not forward it; SlackMessageUI defaults to true. */}
            <ChannelHeader />
            <ChannelTabs />
            <MessageList
              showAvatar
              disableDateSeparator={false}
              renderText={slackRenderText}
              // Slack grouping rules, not Stream's: attachments and reactions
              // do NOT break a cluster (upstream getGroupStyles forces any
              // message with an attachment to `single`, which split one agent
              // turn's artifact cards into one avatar row each), and messages
              // sharing an `eve_turn` marker stay in one cluster however long
              // the turn ran. `slack-message-ui.tsx` recomputes each row's
              // role with this same function so the two layers can't drift.
              groupStyles={slackGroupStyles as never}
              // Break the cluster when same-author messages are more than
              // ~2 min apart. Sets the `str-chat__li--middle/--bottom` classes
              // the CSS overrides in `stream-chat-overrides.css` key off (with
              // `!important`) to hide avatars/metadata on continuations.
              // Without this, a stale double-text would still be hidden under
              // the previous one regardless of how long ago that was.
              maxTimeBetweenGroupedMessages={CLUSTER_TIME_GAP_MS}
            />
            {/* DB-driven "AI is thinking" row — spans the WHOLE eve turn
                (Stream's native typing indicator expires after seconds). */}
            <AiThinkingIndicator streamChannelId={channelId} />
            <SlackComposer />
          </Window>
          {/* Slack-styled thread panel — same SlackComposer + SlackMessageUI
              as the main channel so the reply input doesn't visually break
              out of the channel UI. */}
          <SlackThread />
          <ChannelInfoPanel propertyId={propertyId} />
          <ArtifactSidePanel propertyId={propertyId} />
          {/* Pops the panel open on the first record the AI starts writing in
              this turn, so the live edit is visible without clicking. */}
          <ArtifactAutoOpen />
          <MessageJumper messageId={messageId} />
          </JumpToLatestOverride>
        </Channel>
      </ChatView>
    </div>
  );
}
