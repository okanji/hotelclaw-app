import React, { type ReactNode } from "react";
import { Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chat, OverlayProvider, useCreateChatClient } from "stream-chat-expo";
import {
  chatApiKey,
  chatUserId,
  chatUserName,
  chatUserToken,
} from "../chatConfig";

const user = {
  id: chatUserId,
  name: chatUserName,
};

const chatTheme = {
  channelPreview: {
    container: {
      backgroundColor: "transparent",
    },
  },
};

export const ChatWrapper = ({ children }: { children: ReactNode }) => {
  const chatClient = useCreateChatClient({
    apiKey: chatApiKey,
    userData: user,
    tokenOrProvider: chatUserToken,
  });

  if (!chatClient) {
    return (
      <SafeAreaView>
        <Text>Loading chat ...</Text>
      </SafeAreaView>
    );
  }

  return (
    <OverlayProvider value={{ style: chatTheme }}>
      <Chat client={chatClient}>{children}</Chat>
    </OverlayProvider>
  );
};
