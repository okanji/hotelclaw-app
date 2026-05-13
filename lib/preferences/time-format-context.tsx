"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  updateTimeFormat,
  type TimeFormat,
} from "@/lib/auth/profile-actions";

type Ctx = {
  format: TimeFormat;
  setFormat: (next: TimeFormat) => Promise<void>;
};

const TimeFormatContext = createContext<Ctx | null>(null);

export function TimeFormatProvider({
  initial,
  children,
}: {
  initial: TimeFormat;
  children: ReactNode;
}) {
  const [format, setFormatState] = useState<TimeFormat>(initial);

  const setFormat = useCallback(async (next: TimeFormat) => {
    if (next === format) return;
    const prev = format;
    setFormatState(next);
    const result = await updateTimeFormat(next);
    if ("error" in result) {
      console.error("Failed to save time format:", result.error);
      setFormatState(prev);
    }
  }, [format]);

  return (
    <TimeFormatContext.Provider value={{ format, setFormat }}>
      {children}
    </TimeFormatContext.Provider>
  );
}

export function useTimeFormat(): Ctx {
  const ctx = useContext(TimeFormatContext);
  if (!ctx) {
    throw new Error("useTimeFormat must be used inside <TimeFormatProvider>");
  }
  return ctx;
}
