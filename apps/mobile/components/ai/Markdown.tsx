import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Light markdown for AI replies on mobile: headings, bullet / numbered
 * lists, paragraphs, fenced code, inline **bold**, `code`, and [links]
 * (rendered as text — deep links open via the ai_ui cards instead). The
 * web renders the same replies with Streamdown; this is the phone-sized
 * subset the personas actually use, with no native dependency.
 */
function inline(text: string, baseStyle: object, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return (
    <Text key={key} style={baseStyle}>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text key={i} style={styles.bold}>
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
          return (
            <Text key={i} style={styles.link}>
              {link[1]}
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
  let code: string[] | null = null;
  const body = { fontSize: size, lineHeight: Math.round(size * 1.5), color: "#111827" };

  const flush = () => {
    if (paragraph.length) {
      blocks.push(inline(paragraph.join(" "), [styles.p, body], `p${blocks.length}`));
      paragraph = [];
    }
  };

  lines.forEach((raw) => {
    const line = raw.replace(/\s+$/, "");
    if (code) {
      if (line.startsWith("```")) {
        blocks.push(
          <View key={`c${blocks.length}`} style={styles.codeBlock}>
            <Text style={styles.code}>{code.join("\n")}</Text>
          </View>,
        );
        code = null;
      } else code.push(raw);
      return;
    }
    if (line.startsWith("```")) {
      flush();
      code = [];
      return;
    }
    if (!line.trim()) {
      flush();
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
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flush();
      const marker = bullet ? "•" : `${numbered![1]}.`;
      const text = bullet ? bullet[1] : numbered![2];
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
  codeBlock: {
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    padding: 10,
  },
  code: { fontFamily: "Menlo", fontSize: 12, lineHeight: 17, color: "#111827" },
});
