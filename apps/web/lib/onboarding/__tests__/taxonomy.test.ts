import { describe, expect, it } from "vitest";
import {
  GENERIC_TEAM_TITLES,
  LEADERSHIP_TITLES,
  defaultDeptIcon,
  departmentFamily,
  isSameDepartment,
  titlesForDepartment,
} from "@/lib/onboarding/taxonomy";

/**
 * The taxonomy is an ordered regex table, which is precisely the kind of thing
 * that breaks silently when someone inserts a pattern in the wrong place. Each
 * case below is a real collision from the onboarding wizard.
 */

describe("departmentFamily", () => {
  it("collapses the synonyms the presets actually disagree on", () => {
    // The bug: the hotel preset says "Front Office", the hostel preset says
    // "Front Desk", and the wizard offered the second to someone who already
    // had the first.
    expect(isSameDepartment("Front Office", "Front Desk")).toBe(true);
    expect(isSameDepartment("Front Office", "Reception")).toBe(true);
    expect(isSameDepartment("Engineering & Maintenance", "Maintenance")).toBe(true);
    expect(isSameDepartment("Sales & Events", "Events")).toBe(true);
    expect(isSameDepartment("Housekeeping", "Housekeeping Team")).toBe(true);
  });

  it("keeps genuinely different teams apart", () => {
    // Families are SYNONYMS, not a hierarchy: a restaurant runs Kitchen and
    // Bar as separate teams, so collapsing them into Food & Beverage would
    // hide real choices to fix a cosmetic duplicate.
    expect(isSameDepartment("Food & Beverage", "Kitchen")).toBe(false);
    expect(isSameDepartment("Food & Beverage", "Bar")).toBe(false);
    expect(isSameDepartment("Kitchen", "Bar")).toBe(false);
    expect(isSameDepartment("Management", "Operations")).toBe(false);
    expect(isSameDepartment("Spa & Wellness", "Gym")).toBe(false);
  });

  it("resolves the ordering traps", () => {
    // "Front of House" contains "front"; "Food & Beverage" contains
    // "beverage"; the management pattern must not claim "Front Office".
    expect(departmentFamily("Front of House")).toBe("front_of_house");
    expect(departmentFamily("Front Office")).toBe("front_office");
    expect(departmentFamily("Food & Beverage")).toBe("food_beverage");
    expect(departmentFamily("Bar")).toBe("bar");
    expect(departmentFamily("Management")).toBe("management");
  });

  it("falls back to normalized text for names it doesn't know", () => {
    // Two unrecognised names must not collapse into one shared bucket.
    expect(departmentFamily("  Dive   Centre ")).toBe("dive centre");
    expect(isSameDepartment("Dive Centre", "Dive centre")).toBe(true);
    expect(isSameDepartment("Dive Centre", "Kids Club")).toBe(false);
  });
});

describe("defaultDeptIcon", () => {
  it("keeps each front-of-property team visually distinct", () => {
    expect(defaultDeptIcon("Front Office")).toBe("🛎️");
    expect(defaultDeptIcon("Front of House")).toBe("🤝");
    expect(defaultDeptIcon("Housekeeping")).toBe("🧹");
    expect(defaultDeptIcon("Kitchen")).toBe("👨‍🍳");
  });

  it("falls back rather than throwing on an unknown name", () => {
    expect(defaultDeptIcon("Dive Centre")).toBe("🏷️");
  });
});

describe("titlesForDepartment", () => {
  it("offers leadership when there is no team", () => {
    // A General Manager isn't IN Housekeeping — they run the property across
    // every team. "No team" is the answer for them, not a missing value.
    expect(titlesForDepartment(null)).toBe(LEADERSHIP_TITLES);
    expect(titlesForDepartment("")).toBe(LEADERSHIP_TITLES);
    expect(titlesForDepartment("   ")).toBe(LEADERSHIP_TITLES);
    expect(LEADERSHIP_TITLES[0]).toBe("General Manager");
  });

  it("offers that department's own ladder for a known team", () => {
    expect(titlesForDepartment("Kitchen")).toContain("Sous Chef");
    expect(titlesForDepartment("Front Desk")).toContain("Receptionist");
    expect(titlesForDepartment("Housekeeping")).toContain("Head Housekeeper");
    // …and NOT another department's.
    expect(titlesForDepartment("Kitchen")).not.toContain("Receptionist");
  });

  it("does not offer leadership titles for an unrecognised team", () => {
    // "General Manager" as the top suggestion for a team called "Dive Centre"
    // is worse than offering nothing specific.
    const titles = titlesForDepartment("Dive Centre");
    expect(titles).toBe(GENERIC_TEAM_TITLES);
    expect(titles).not.toContain("General Manager");
  });
});
