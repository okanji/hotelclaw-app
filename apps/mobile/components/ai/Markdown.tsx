import React from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { apiBaseUrl } from "../../chatConfig";

/**
 * Light markdown for AI replies on mobile: headings, bullet / numbered
 * lists, paragraphs, block quotes, fenced code, inline **bold**, *italic*,
 * `code`, and [links] — the phone-sized subset the personas actually use,
 * with no native dependency. The web renders the same replies with
 * Streamdown + Code Block (`apps/web/components/ai/markdown.tsx`).
 *
 * Links open: an app deep link (`/p/<pid>/tasks/<id>`, `/documents/<id>`)
 * navigates to the native screen when one exists, any other internal path
 * opens the web app, and absolute URLs open in the system browser.
 */
export function openMarkdownLink(href: string) {
  const native = /^\/p\/[^/]+\/(tasks|documents)\/([0-9a-f-]{36})$/i.exec(href);
  if (native) {
    router.navigate(native[1] === "tasks" ? `/task/${native[2]}` : `/document/${native[2]}`);
    return;
  }
  const url = href.startsWith("/") ? `${apiBaseUrl}${href}` : href;
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url);
}

const INLINE_RX = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*|~~[^~]+~~)/g;

function inline(text: string, baseStyle: object, key: string) {
  const parts = text.split(INLINE_RX).filter(Boolean);
  return (
    <Text key={key} style={baseStyle}>
      {parts.map((part, i) => {
        if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
          return (
            <Text key={i} style={styles.bold}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith("~~") && part.endsWith("~~")) {
          return (
            <Text key={i} style={styles.strike}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <Text key={i} style={styles.inlineCode}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const href = link[2];
          return (
            <Text
              key={i}
              style={styles.link}
              onPress={() => openMarkdownLink(href)}
              accessibilityRole="link"
            >
              {link[1]}
            </Text>
          );
        }
        if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
          return (
            <Text key={i} style={styles.italic}>
              {part.slice(1, -1)}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
}

export function Markdown({ children, size = 15 }: { children: string; size?: number }) {
  const lines = children.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let code: string[] | null = null;
  let codeLang = "";
  const body = { fontSize: size, lineHeight: Math.round(size * 1.5), color: "#111827" };

  const flush = () => {
    if (paragraph.length) {
      blocks.push(inline(paragraph.join(" "), [styles.p, body], `p${blocks.length}`));
      paragraph = [];
    }
    if (quote.length) {
      blocks.push(
        <View key={`q${blocks.length}`} style={styles.quote}>
          {inline(quote.join(" "), [styles.quoteText, body], "t")}
        </View>,
      );
      quote = [];
    }
  };

  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (line.startsWith("```")) {
        blocks.push(
          <View key={`c${blocks.length}`} style={styles.codeBlock}>
            {codeLang ? <Text style={styles.codeLang}>{codeLang}</Text> : null}
            <Text style={styles.code}>{code.join("\n")}</Text>
          </View>,
        );
        code = null;
        codeLang = "";
      } else code.push(raw);
      return;
    }
    if (line.startsWith("```")) {
      flush();
      code = [];
      codeLang = line.slice(3).trim();
      return;
    }
    if (!line.trim()) {
      flush();
      return;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push(<View key={`hr${blocks.length}`} style={styles.rule} />);
      return;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      blocks.push(
        inline(
          heading[2],
          [styles.heading, { fontSize: level === 1 ? size + 4 : level === 2 ? size + 2 : size + 1 }],
          `h${blocks.length}`,
        ),
      );
      return;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      if (paragraph.length) flush();
      quote.push(quoted[1]);
      return;
    }
    if (quote.length) flush();
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (task || bullet || numbered) {
      flush();
      const marker = task ? (task[1] === " " ? "☐" : "☑") : bullet ? "•" : `${numbered![1]}.`;
      const text = task ? task[2] : bullet ? bullet[1] : numbered![2];
      blocks.push(
        <View key={`l${blocks.length}`} style={styles.li}>
          <Text style={[styles.marker, body]}>{marker}</Text>
          <View style={styles.liBody}>{inline(text, body, "t")}</View>
        </View>,
      );
      return;
    }
    if (line.startsWith("|")) {
      // Table row → one line of cells (tables proper come via render_ui).
      if (/^\|\s*:?-+/.test(line)) return;
      flush();
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      blocks.push(
        <Text key={`r${blocks.length}`} style={[styles.p, body]}>
          {cells.join("  ·  ")}
        </Text>,
      );
      return;
    }
    paragraph.push(line.trim());
  });
  flush();
  return <View style={styles.root}>{blocks}</View>;
}

const styles = StyleSheet.create({
  root: { gap: 6 },
  p: {},
  heading: { fontWeight: "600", color: "#111827", marginTop: 6 },
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through", color: "#6b7280" },
  inlineCode: {
    fontFamily: "Menlo",
    fontSize: 13,
    backgroundColor: "#f3f4f6",
    color: "#111827",
  },
  link: { textDecorationLine: "underline", color: "#111827" },
  li: { flexDirection: "row", gap: 8, paddingLeft: 4 },
  marker: { color: "#6b7280", minWidth: 16 },
  liBody: { flex: 1 },
  quote: {
    borderLeftWidth: 2,
    borderLeftColor: "#d1d5db",
    paddingLeft: 10,
    marginVertical: 2,
  },
  quoteText: { color: "#6b7280" },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: "#e5e7eb", marginVertical: 6 },
  codeBlock: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  codeLang: { fontFamily: "Menlo", fontSize: 10, color: "#9ca3af" },
  code: { fontFamily: "Menlo", fontSize: 12, lineHeight: 17, color: "#111827" },
});
