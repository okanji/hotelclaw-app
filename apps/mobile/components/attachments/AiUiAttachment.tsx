import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  validateChatUiSpec,
  type AiUiAttachmentPayload,
  type ChatUiElement,
  type ChatUiSpec,
  type ChatUiTone,
} from "@hotelclaw/chat-ui";

/**
 * Native renderer for the bot's `ai_ui` Stream attachment — the same
 * json-render spec the web renders in
 * `apps/web/components/chat/ai-ui-attachment.tsx`, drawn with plain RN
 * views. The catalog is tiny (Stack / DataTable / CardGrid / Card /
 * StatRow / Stat) and display-only, so we walk the validated spec with a
 * ~40-line recursive renderer instead of pulling `@json-render/react`'s
 * `Renderer` into the RN bundle (the shared `@hotelclaw/chat-ui` package
 * deliberately uses only its react-free `/schema` subpath).
 *
 * The spec is re-validated before rendering (exactly like web) so a
 * hand-crafted or version-drifted attachment degrades to nothing instead
 * of crashing the message list.
 */

const TONE_COLOR: Record<ChatUiTone, string> = {
  neutral: "#6b7280",
  success: "#16a34a",
  warning: "#d97706",
  info: "#2563eb",
  destructive: "#dc2626",
};

/**
 * Stored-spec hrefs are always web paths `/p/<propertyId>/<section>/<id>`
 * (enforced by INTERNAL_HREF_RX server-side). Mobile only has detail
 * screens for tasks and documents — map those to the native routes and
 * render everything else non-tappable. The property id in the href is
 * ignored: the channel screen already switches the active property to the
 * channel's property, and both native detail screens read the ACTIVE
 * property, so the ids line up in practice.
 */
function mobileRouteForHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = /^\/p\/[^/]+\/(tasks|documents)\/([0-9a-f-]{36})$/i.exec(href);
  if (!m) return null;
  return m[1] === "tasks" ? `/task/${m[2]}` : `/document/${m[2]}`;
}

// ─── Leaf components ─────────────────────────────────────────────────────

function DataTableView({
  props,
}: {
  props: {
    title?: string;
    columns: string[];
    rows: string[][];
    rowHrefs?: (string | null)[];
  };
}) {
  const router = useRouter();
  // ≤2 columns fit the chat column; wider tables scroll horizontally
  // inside their own container (fixed cell widths give them a natural
  // width for the ScrollView to pan).
  const wide = props.columns.length > 2;
  const cellStyle = (ci: number) =>
    wide
      ? [styles.cell, { width: ci === 0 ? 150 : 110 }]
      : [styles.cell, { flex: ci === 0 ? 1.4 : 1 }];

  const table = (
    <View>
      <View style={[styles.tableRow, styles.tableHeadRow]}>
        {props.columns.map((c, ci) => (
          <Text key={ci} style={[...cellStyle(ci), styles.headCell]} numberOfLines={1}>
            {c}
          </Text>
        ))}
      </View>
      {props.rows.map((row, ri) => {
        const route = mobileRouteForHref(props.rowHrefs?.[ri]);
        const cells = props.columns.map((_, ci) => (
          <Text
            key={ci}
            style={[...cellStyle(ci), ci === 0 ? styles.leadCell : styles.dataCell]}
            numberOfLines={2}
          >
            {row[ci] ?? ""}
          </Text>
        ));
        return route ? (
          <Pressable
            key={ri}
            style={({ pressed }) => [
              styles.tableRow,
              styles.tableBodyRow,
              pressed && styles.pressed,
            ]}
            onPress={() => router.navigate(route)}
          >
            {cells}
          </Pressable>
        ) : (
          <View key={ri} style={[styles.tableRow, styles.tableBodyRow]}>
            {cells}
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.block}>
      {props.title ? (
        <View style={styles.tableTitleRow}>
          <Text style={styles.tableTitle} numberOfLines={1}>
            {props.title}
          </Text>
          {props.rows.length > 1 ? (
            <Text style={styles.tableCount}>{props.rows.length}</Text>
          ) : null}
        </View>
      ) : null}
      {wide ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {table}
        </ScrollView>
      ) : (
        table
      )}
    </View>
  );
}

function CardView({
  props,
}: {
  props: {
    title: string;
    subtitle?: string;
    href?: string;
    badge?: { label: string; tone?: ChatUiTone };
    fields?: { label: string; value: string }[];
  };
}) {
  const router = useRouter();
  const route = mobileRouteForHref(props.href);
  const tone = props.badge?.tone ?? "neutral";

  const body = (
    <>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {props.title}
          </Text>
          {props.subtitle ? (
            <Text style={styles.cardSubtitle} numberOfLines={2}>
              {props.subtitle}
            </Text>
          ) : null}
        </View>
        {props.badge ? (
          <View style={[styles.badge, { borderColor: TONE_COLOR[tone] }]}>
            <Text style={[styles.badgeText, { color: TONE_COLOR[tone] }]}>
              {props.badge.label}
            </Text>
          </View>
        ) : null}
      </View>
      {props.fields && props.fields.length > 0 ? (
        <View style={styles.cardFields}>
          {props.fields.map((f, i) => (
            <View key={i} style={styles.cardFieldRow}>
              <Text style={styles.cardFieldLabel} numberOfLines={1}>
                {f.label}
              </Text>
              <Text style={styles.cardFieldValue} numberOfLines={1}>
                {f.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  return route ? (
    <Pressable
      style={({ pressed }) => [styles.block, styles.card, pressed && styles.pressed]}
      onPress={() => router.navigate(route)}
    >
      {body}
    </Pressable>
  ) : (
    <View style={[styles.block, styles.card]}>{body}</View>
  );
}

function StatView({
  props,
}: {
  props: { label: string; value: string; hint?: string };
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {props.label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {props.value}
      </Text>
      {props.hint ? (
        <Text style={styles.statHint} numberOfLines={1}>
          {props.hint}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Recursive walk ──────────────────────────────────────────────────────

function renderElement(spec: ChatUiSpec, key: string): React.ReactElement | null {
  const el: ChatUiElement | undefined = spec.elements[key];
  if (!el) return null;
  const children = (el.children ?? []).map((c) => (
    <React.Fragment key={c}>{renderElement(spec, c)}</React.Fragment>
  ));
  switch (el.type) {
    case "Stack":
      return <View style={styles.stack}>{children}</View>;
    case "CardGrid":
      // Phone column: cards stack vertically (web's 2-col grid collapses).
      return <View style={styles.stack}>{children}</View>;
    case "StatRow":
      return <View style={[styles.block, styles.statRow]}>{children}</View>;
    case "DataTable":
      return <DataTableView props={el.props as React.ComponentProps<typeof DataTableView>["props"]} />;
    case "Card":
      return <CardView props={el.props as React.ComponentProps<typeof CardView>["props"]} />;
    case "Stat":
      return <StatView props={el.props as React.ComponentProps<typeof StatView>["props"]} />;
    default:
      return null;
  }
}

export function AiUiAttachment({
  attachment,
}: {
  attachment: AiUiAttachmentPayload;
}) {
  const validated = React.useMemo(
    () => validateChatUiSpec(attachment.spec),
    [attachment.spec],
  );
  if (!validated.ok) return null;
  return (
    <View style={styles.root}>{renderElement(validated.spec, validated.spec.root)}</View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginVertical: 4,
    alignSelf: "stretch",
  },
  stack: {
    gap: 8,
  },
  // Shared framed surface for embedded objects (matches the house Row /
  // card language: white ground, hairline separation, 10px radius).
  block: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  pressed: {
    backgroundColor: "#f9fafb",
  },
  // DataTable
  tableTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#f9fafb",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  tableTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#111827",
    flexShrink: 1,
  },
  tableCount: {
    fontSize: 12,
    color: "#6b7280",
    fontVariant: ["tabular-nums"],
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: 4,
  },
  tableHeadRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  tableBodyRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f3f4f6",
  },
  cell: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  headCell: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6b7280",
  },
  leadCell: {
    fontSize: 13,
    fontWeight: "500",
    color: "#111827",
  },
  dataCell: {
    fontSize: 13,
    color: "#6b7280",
    fontVariant: ["tabular-nums"],
  },
  // Card
  card: {
    padding: 12,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardHeadText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  cardSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: "#6b7280",
  },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  cardFields: {
    marginTop: 8,
    gap: 4,
  },
  cardFieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  cardFieldLabel: {
    fontSize: 12,
    color: "#6b7280",
    flexShrink: 0,
  },
  cardFieldValue: {
    fontSize: 12,
    color: "#111827",
    flexShrink: 1,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  // Stats
  statRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    gap: 12,
  },
  stat: {
    minWidth: 84,
    flexGrow: 1,
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
  },
  statValue: {
    marginTop: 2,
    fontSize: 18,
    fontWeight: "600",
    color: "#111827",
    fontVariant: ["tabular-nums"],
  },
  statHint: {
    marginTop: 1,
    fontSize: 11,
    color: "#9ca3af",
  },
});
