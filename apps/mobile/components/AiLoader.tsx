import React, { useEffect, useState, type ReactNode } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  ReduceMotion,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

/**
 * The house "AI is working" loader — the mobile twin of
 * `apps/web/components/ui/ai-loader.tsx` (adapted from Beautiful UI's
 * Loading State, beautifului.dev, © 2026 Shane Levine, MIT). The web
 * versions are DOM + Tailwind keyframes, so this ports the grammar to
 * Reanimated rather than reusing code: a 3×3 pixel grid with a chevron
 * wavefront, a shimmering label, and a live elapsed timer in mono tabular
 * figures. One visual for every bot surface, same as web.
 *
 * Every animation passes `ReduceMotion.System` so OS-level reduced motion
 * settles the loader to a static state — the RN twin of the web
 * `prefers-reduced-motion` blocks in globals.css.
 */

/** The one house easing — cubic-bezier(0.23, 1, 0.32, 1), a fast-out settle. */
export const AI_EASING = Easing.bezier(0.23, 1, 0.32, 1);

/**
 * Staggered fade-up entrance for list/card items — the RN twin of the web
 * `.ai-fade-up` class + per-index `animationDelay`. Cap mirrors web: items
 * past the 6th enter together so a long list doesn't crawl.
 */
export function fadeUpEntering(index = 0) {
  return FadeInDown.duration(320)
    .delay(Math.min(index, 6) * 80)
    .easing(AI_EASING)
    .withInitialValues({ opacity: 0, transform: [{ translateY: 4 }] })
    .reduceMotion(ReduceMotion.System);
}

/** 200ms status fade — status changes fade in, never snap. */
export function statusFadeIn() {
  return FadeIn.duration(200).reduceMotion(ReduceMotion.System);
}

/* Chevron wavefront: each cell's delay is its distance along a ">" front. */
const CHEVRON_DELAYS = Array.from({ length: 9 }, (_, i) => {
  const row = Math.floor(i / 3);
  const col = i % 3;
  return (col + Math.abs(row - 1)) * 90;
});

function PixelCell({ delay }: { delay: number }) {
  const on = useSharedValue(0);
  useEffect(() => {
    on.set(
      withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(1, { duration: 325, easing: Easing.inOut(Easing.ease) }),
            withTiming(0, { duration: 325, easing: Easing.inOut(Easing.ease) }),
          ),
          -1,
          false,
          undefined,
          ReduceMotion.System,
        ),
      ),
    );
  }, [delay, on]);
  const animated = useAnimatedStyle(() => ({
    opacity: 0.15 + on.get() * 0.85,
  }));
  return <Animated.View style={[styles.cell, animated]} />;
}

export function AiPixelGrid({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.grid, style]} accessibilityElementsHidden>
      {[0, 1, 2].map((row) => (
        <View key={row} style={styles.gridRow}>
          {[0, 1, 2].map((col) => (
            <PixelCell key={col} delay={CHEVRON_DELAYS[row * 3 + col]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Shimmering label. RN has no background-clip:text, so instead of the web's
 * gradient sweep this breathes the ink between muted and full — same
 * "alive, still working" read, no extra native deps (MaskedView would need
 * a rebuild).
 */
export function AiShimmerLabel({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
}) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
        undefined,
        ReduceMotion.System,
      ),
    );
  }, [t]);
  const animated = useAnimatedStyle(() => ({
    color: interpolateColor(t.get(), [0, 1], ["#6b7280", "#111827"]),
  }));
  return (
    // The animated color must come last — a static `color` in the caller's
    // style would freeze the shimmer.
    <Animated.Text style={[styles.shimmer, style, animated]} numberOfLines={1}>
      {children}
    </Animated.Text>
  );
}

/** Elapsed since mount — "3.2s", then "1m 12s". */
export function useAiElapsed(): string {
  const [tenths, setTenths] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTenths((t) => t + 1), 100);
    return () => clearInterval(timer);
  }, []);
  const total = tenths / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${Math.floor(total % 60)}s`;
}

export function AiElapsed({ style }: { style?: StyleProp<TextStyle> }) {
  const elapsed = useAiElapsed();
  return <Animated.Text style={[styles.elapsed, style]}>{elapsed}</Animated.Text>;
}

export function AiLoader({
  label = "Working…",
  showElapsed = true,
  style,
}: {
  label?: string;
  /** The timer starts when the loader mounts — turn on for real turns,
   *  off for indeterminate waits. */
  showElapsed?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.loaderRow, style]} accessibilityRole="progressbar">
      <AiPixelGrid />
      <AiShimmerLabel>{label}</AiShimmerLabel>
      {showElapsed ? <AiElapsed /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    gap: 1.5,
    flexShrink: 0,
  },
  gridRow: {
    flexDirection: "row",
    gap: 1.5,
  },
  cell: {
    width: 4,
    height: 4,
    borderRadius: 1,
    backgroundColor: "#111827",
  },
  shimmer: {
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  elapsed: {
    fontSize: 12,
    color: "#9ca3af",
    fontVariant: ["tabular-nums"],
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
  loaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    alignSelf: "flex-start",
  },
});
