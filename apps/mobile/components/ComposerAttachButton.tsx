import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import {
  useAttachmentPickerContext,
  useAttachmentPickerState,
  useMessageInputContext,
} from "stream-chat-expo";

/**
 * The composer's "+" — a bare glyph, not Stream's default 48pt outlined
 * circle, so the text field gets the row. iMessage, WhatsApp, Slack and
 * Messenger all draw it this way: a ~24pt icon with no border in a ~36pt
 * tap target.
 *
 * Press behaviour mirrors Stream's AttachButton exactly (custom handler,
 * else toggle the picker, refocusing the input on close when configured).
 */
export function ComposerAttachButton() {
  const { attachmentPickerStore } = useAttachmentPickerContext();
  const { selectedPicker } = useAttachmentPickerState();
  const {
    closeAttachmentPicker,
    focusInputOnPickerClose,
    handleAttachButtonPress,
    inputBoxRef,
    openAttachmentPicker,
  } = useMessageInputContext();
  const open = !!selectedPicker;

  const onPress = () => {
    if (handleAttachButtonPress) {
      handleAttachButtonPress();
      return;
    }
    if (attachmentPickerStore.state.getLatestValue().selectedPicker) {
      if (focusInputOnPickerClose) inputBoxRef.current?.focus();
      else closeAttachmentPicker();
    } else {
      openAttachmentPicker();
    }
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={open ? "Close attachments" : "Add attachment"}
      testID="attach-button"
    >
      <Ionicons name="add" size={26} color="#6b7280" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Stream bottom-aligns the composer's buttons (so they stay put as the input
  // grows); matching the input's 48pt single-line height centres the glyph on
  // the text field instead of sitting it 7pt low.
  button: {
    width: 34,
    height: 48,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { backgroundColor: "#f3f4f6" },
});
