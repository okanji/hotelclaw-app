import React, { createContext, useContext, useState, type ReactNode } from "react";
import type { Channel, LocalMessage } from "stream-chat";

type AppContextValue = {
  channel: Channel | undefined;
  setChannel: (channel: Channel | undefined) => void;
  thread: LocalMessage | null;
  setThread: (thread: LocalMessage | null) => void;
};

export const AppContext = createContext<AppContextValue>({
  channel: undefined,
  setChannel: () => {},
  thread: null,
  setThread: () => {},
});

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [channel, setChannel] = useState<Channel | undefined>(undefined);
  const [thread, setThread] = useState<LocalMessage | null>(null);

  return (
    <AppContext.Provider value={{ channel, setChannel, thread, setThread }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
