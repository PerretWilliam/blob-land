import { activityLog, type Segment } from "@blob-land/sim";
import { afterEach, describe, expect, it } from "vitest";
import { characterName, isLanguage, journalLine, setLanguage, t } from "@/i18n";

const seg = (start: number, activity: Segment["activity"], extra: Partial<Segment> = {}): Segment => ({
  start,
  end: start + 1,
  activity,
  expression: "idle",
  x: 0.5,
  y: 0.5,
  rng: 0,
  with: null,
  detail: null,
  ...extra,
});

const day = [
  seg(1, "sleep"),
  seg(2, "wake"),
  seg(3, "explore"),
  seg(4, "explore"),
  seg(5, "discover", { detail: "a smooth pebble" }),
  seg(6, "meet", { with: ["bob"], detail: "hug:good" }),
  seg(7, "meet", { with: ["ann", "bob", "cy"], detail: "chat:good" }),
];
const lines = () => activityLog(day).map((s) => journalLine(s, (seed) => seed.toUpperCase()));

describe("i18n", () => {
  afterEach(() => setLanguage("en"));

  it("words a blob's day in English", () => {
    setLanguage("en");
    expect(lines()).toEqual(["Fell asleep.", "Woke up.", "Went exploring.", "Found a smooth pebble.", "Hugged BOB.", "Had a lovely chat with ANN, BOB, and CY."]);
  });

  it("words it in French, finds included", () => {
    setLanguage("fr");
    expect(lines()).toEqual([
      "A filé au lit.",
      "A ouvert les yeux.",
      "A fait un tour d'exploration.",
      "A trouvé un galet tout lisse.",
      "A fait un câlin à BOB.",
      "A eu une super discussion avec ANN, BOB et CY.",
    ]);
    expect(t().errors["wrong password"]).toMatch(/mot de passe/);
  });

  it("names a character by its two most marked poles, in either language", () => {
    const p = { sociability: 0.5, temper: 0.5, playfulness: 0.95, romance: 0.5, chronotype: 0, kindness: 0.8, loyalty: 0.5, curiosity: 0.5 };
    expect(characterName(p)).toBe("Joker & heart of gold");
    setLanguage("fr");
    expect(characterName(p)).toBe("Boute-en-train et cœur d'or");
    expect(characterName({ ...p, playfulness: 0.5, kindness: 0.5 })).toBe("Âme équilibrée");
  });

  it("only takes the languages it speaks", () => {
    expect(["en", "fr"].every(isLanguage)).toBe(true);
    expect(isLanguage("toString")).toBe(false);
    expect(isLanguage("de")).toBe(false);
  });
});
