import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthContext";

export type PropertyMembership = {
  property_id: string;
  role: "owner" | "manager" | "staff";
  property: { id: string; name: string; slug: string };
};

type PropertyContextValue = {
  memberships: PropertyMembership[];
  // True until the first memberships fetch for the current session resolves.
  loading: boolean;
  // Set when the fetch FAILED. Distinct from an empty list: a network error
  // must not be presented as "you have no properties".
  error: string | null;
  activeProperty: PropertyMembership | null;
  setActivePropertyId: (propertyId: string) => void;
  reload: () => void;
};

const PropertyContext = createContext<PropertyContextValue>({
  memberships: [],
  loading: true,
  error: null,
  activeProperty: null,
  setActivePropertyId: () => {},
  reload: () => {},
});

const STORAGE_KEY = "hotelclaw.activePropertyId";

export const PropertyProvider = ({ children }: { children: ReactNode }) => {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [memberships, setMemberships] = useState<PropertyMembership[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) {
      setMemberships([]);
      setActiveId(null);
      setError(null);
      setLoading(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      // Filter to self: membership RLS also exposes teammates' rows for your
      // properties (same gotcha as apps/web/lib/auth/session.ts).
      const { data, error } = await supabase
        .from("memberships")
        .select(
          "property_id, role, property:properties!inner(id, name, slug, archived_at)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("memberships fetch failed", error);
        setMemberships([]);
        setError(error.message || "Couldn't load your properties.");
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as unknown as (PropertyMembership & {
        property: { archived_at: string | null };
      })[];
      const active = rows.filter((m) => !m.property.archived_at);
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (cancelled) return;
      setMemberships(active);
      setActiveId(
        active.some((m) => m.property_id === stored)
          ? stored
          : (active[0]?.property_id ?? null),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const setActivePropertyId = (propertyId: string) => {
    setActiveId(propertyId);
    AsyncStorage.setItem(STORAGE_KEY, propertyId).catch(() => {});
  };

  const activeProperty =
    memberships.find((m) => m.property_id === activeId) ?? null;

  return (
    <PropertyContext.Provider
      value={{
        memberships,
        loading,
        error,
        activeProperty,
        setActivePropertyId,
        reload: () => setAttempt((a) => a + 1),
      }}
    >
      {children}
    </PropertyContext.Provider>
  );
};

export const usePropertyContext = () => useContext(PropertyContext);
