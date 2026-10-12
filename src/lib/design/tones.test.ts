import { describe, expect, it } from "vitest";

import {
  STAT_TONES,
  statCardClasses,
  statValueClasses,
  type StatTone,
} from "@/lib/design/tones";

describe("stat tones", () => {
  it("gives every tone a card and a value treatment", () => {
    for (const tone of STAT_TONES) {
      expect(statCardClasses(tone).length).toBeGreaterThan(0);
      expect(statValueClasses(tone).length).toBeGreaterThan(0);
    }
  });

  it("makes every tone's tile distinguishable", () => {
    const cards = STAT_TONES.map((tone) => statCardClasses(tone));
    expect(new Set(cards).size).toBe(STAT_TONES.length);

    const values = STAT_TONES.map((tone) => statValueClasses(tone));
    // "default" and "brand" share the ink colour on purpose; the tinted tones
    // must not, or the colour would say nothing.
    expect(values[0]).toBe(values[1]);
    expect(new Set(values.slice(2)).size).toBe(STAT_TONES.length - 2);
  });

  it("uses design tokens, never palette literals", () => {
    for (const tone of STAT_TONES) {
      expect(`${statCardClasses(tone)} ${statValueClasses(tone)}`).not.toMatch(
        /slate-|bg-white|from-white/
      );
    }
  });

  it("falls back to the plain tile", () => {
    expect(statCardClasses()).toBe(statCardClasses("default"));
    expect(statValueClasses()).toBe(statValueClasses("default"));
    // An unknown tone at runtime (a stored document from before) is plain too.
    expect(statValueClasses("nonsense" as StatTone)).toBe(
      statValueClasses("default")
    );
  });
});
