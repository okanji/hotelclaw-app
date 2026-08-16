import { describe, it, expect } from "vitest";
import { SOP_TEMPLATES, selectSopTemplates } from "../templates";
import { hasSopBody, renderSopTemplate } from "../template-bodies";

describe("SOP template library", () => {
  it("every catalog entry has a body (catalog ↔ bodies drift guard)", () => {
    for (const t of SOP_TEMPLATES) {
      expect(hasSopBody(t.id), `missing body for template "${t.id}"`).toBe(true);
    }
  });

  it("fills the property name and injects an escaped intro under the H1", () => {
    const html = renderSopTemplate({
      templateId: "shift-handover",
      propertyName: "Pinewood <Lodge> & Spa",
      intro: 'Tailored for <script>alert("x")</script> Pinewood',
    });
    expect(html).toBeTruthy();
    expect(html).not.toContain("{{propertyName}}");
    expect(html).toContain("Pinewood &lt;Lodge&gt; &amp; Spa");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // Intro lands directly after the heading.
    expect(html).toMatch(/<\/h1>\s*<p><em>/);
  });

  it("returns null for unknown template ids", () => {
    expect(
      renderSopTemplate({ templateId: "nope", propertyName: "X" }),
    ).toBeNull();
  });

  it("selection: a hotel with rooms gets housekeeping; a café gets checklists", () => {
    const hotel = selectSopTemplates({
      propertyType: "hotel",
      operations: ["rooms"],
      priorities: ["Maintenance requests"],
    }).map((t) => t.id);
    expect(hotel).toContain("housekeeping-room");
    expect(hotel).toContain("maintenance-triage");
    expect(hotel).toContain("emergency-procedures");

    const cafe = selectSopTemplates({
      propertyType: "cafe-bar",
      operations: ["bar"],
      priorities: [],
    }).map((t) => t.id);
    expect(cafe).toContain("opening-checklist");
    expect(cafe).toContain("closing-checklist");
    expect(cafe).not.toContain("housekeeping-room");
  });
});
