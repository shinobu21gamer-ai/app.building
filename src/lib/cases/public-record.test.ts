import { describe, expect, it } from "vitest";

import {
  TRANSPARENCY_CONSENT_PURPOSE,
  publicationDecision,
} from "@/lib/cases/public-record";

// The live path and the historical backfill script must agree on when a case is
// published, so the decision is a function of exactly two inputs.
describe("publicationDecision", () => {
  it("publishes only when the resident consented and the title survived scrubbing", () => {
    expect(publicationDecision(true, "Pothole on Mabini Street")).toBe(
      "published"
    );
  });

  it("never publishes without consent, however safe the title", () => {
    expect(publicationDecision(false, "Pothole on Mabini Street")).toBe(
      "consent_missing"
    );
  });

  it("skips a title that scrubs to nothing (the resident's own name)", () => {
    expect(publicationDecision(true, null)).toBe("no_safe_title");
  });

  it("reports the missing consent before the unsafe title", () => {
    expect(publicationDecision(false, null)).toBe("consent_missing");
  });

  it("uses the transparency publication purpose, not a new one", () => {
    expect(TRANSPARENCY_CONSENT_PURPOSE).toBe("TRANSPARENCY_PUBLICATION");
  });
});
