import { forwardRef } from "react";
import {
  StyleSheet,
  Text,
  TextInput as RNTextInput,
  type TextInputProps,
} from "react-native";
import { useMessageComposer, useStateStore } from "stream-chat-expo";
import type { TextComposerState } from "stream-chat";

/**
 * Drop-in `TextInputComponent` override for Stream's MessageComposer that
 * renders committed @-mentions bold + blue WHILE TYPING, matching how the web
 * composer styles them in its rich editor.
 *
 * Mechanism: an RN TextInput displays its `children` as (stylable) rich text
 * in place of `value` — the same technique mention libraries use. The SDK's
 * AutoCompleteInput stays the controlled owner of the text (it passes `value`
 * + `onChangeText`); we only swap how that value is DISPLAYED, splitting it
 * into spans around each mentioned user's `@Name` token. Mention ranges come
 * from the composer's own state (`textComposer.state.mentionedUsers`), so
 * only committed mentions light up — a half-typed "@Yuk" stays plain until
 * picked from the suggestion list.
 */
const textComposerStateSelector = (state: TextComposerState) => ({
  mentionedUsers: state.mentionedUsers,
  mentions: state.mentions,
});

type Segment = { text: string; mention: boolean };

function splitByMentions(text: string, names: string[]): Segment[] {
  // Longest-first so "@Yuki Tanaka" wins over a hypothetical "@Yuki".
  const tokens = names
    .filter(Boolean)
    .map((n) => `@${n}`)
    .sort((a, b) => b.length - a.length);
  if (!text || tokens.length === 0) return [{ text, mention: false }];

  const segments: Segment[] = [];
  let i = 0;
  while (i < text.length) {
    let matchAt = -1;
    let matchToken = "";
    for (const token of tokens) {
      const at = text.indexOf(token, i);
      if (at !== -1 && (matchAt === -1 || at < matchAt)) {
        matchAt = at;
        matchToken = token;
      }
    }
    if (matchAt === -1) {
      segments.push({ text: text.slice(i), mention: false });
      break;
    }
    if (matchAt > i) {
      segments.push({ text: text.slice(i, matchAt), mention: false });
    }
    segments.push({ text: matchToken, mention: true });
    i = matchAt + matchToken.length;
  }
  return segments;
}

export const MentionTextInput = forwardRef<RNTextInput, TextInputProps>(
  function MentionTextInput({ value, ...props }, ref) {
    const { textComposer } = useMessageComposer();
    const { mentionedUsers, mentions } = useStateStore(
      textComposer.state,
      textComposerStateSelector,
    );

    // `mentions` (when present) also carries non-user entities like @channel;
    // fall back to mentionedUsers — the same rule as the SDK's
    // getMentionsFromState. Inserted form is `@${name ?? id}` in both.
    const names = (mentions ?? mentionedUsers).map((m) => m.name ?? m.id);
    const segments = splitByMentions(value ?? "", names);

    // RN forbids `value` together with children — children carry the text.
    return (
      <RNTextInput {...props} ref={ref}>
        <Text>
          {segments.map((s, i) =>
            s.mention ? (
              <Text key={i} style={styles.mention}>
                {s.text}
              </Text>
            ) : (
              <Text key={i}>{s.text}</Text>
            ),
          )}
        </Text>
      </RNTextInput>
    );
  },
);

const styles = StyleSheet.create({
  mention: { color: "#2563eb", fontWeight: "600" },
});
