import { describe, expect, it } from "vitest";
import { copy, parseLocale } from "./i18n";

describe("parseLocale", () => {
  it("defaults to English", () => {
    expect(parseLocale(undefined)).toBe("en");
    expect(parseLocale("es")).toBe("en");
  });

  it("accepts Filipino", () => {
    expect(parseLocale("fil")).toBe("fil");
  });
});

describe("copy", () => {
  it("keeps English and Filipino keys aligned", () => {
    expect(copy.fil.faqs).toHaveLength(copy.en.faqs.length);
    expect(copy.fil.home.workflow).toHaveLength(copy.en.home.workflow.length);
    expect(copy.fil.home.reportTypes).toHaveLength(copy.en.home.reportTypes.length);
    expect(Object.keys(copy.fil.resident)).toEqual(Object.keys(copy.en.resident));
    expect(Object.keys(copy.fil.submit.factors)).toEqual(
      Object.keys(copy.en.submit.factors)
    );
    expect(Object.keys(copy.fil.profile)).toEqual(Object.keys(copy.en.profile));
    expect(Object.keys(copy.fil.notifications)).toEqual(
      Object.keys(copy.en.notifications)
    );
    expect(Object.keys(copy.fil.official)).toEqual(Object.keys(copy.en.official));
    expect(Object.keys(copy.fil.admin)).toEqual(Object.keys(copy.en.admin));
    expect(Object.keys(copy.fil.admin.mgr)).toEqual(Object.keys(copy.en.admin.mgr));
    expect(Object.keys(copy.fil.register)).toEqual(Object.keys(copy.en.register));
    expect(Object.keys(copy.fil.reset)).toEqual(Object.keys(copy.en.reset));
    expect(Object.keys(copy.fil.login)).toEqual(Object.keys(copy.en.login));
    expect(Object.keys(copy.fil.filters)).toEqual(Object.keys(copy.en.filters));
    expect(Object.keys(copy.fil.alerts)).toEqual(Object.keys(copy.en.alerts));
    expect(copy.fil.privacy.sections).toHaveLength(copy.en.privacy.sections.length);
    expect(Object.keys(copy.fil.desk)).toEqual(Object.keys(copy.en.desk));
    expect(Object.keys(copy.fil.desk.types)).toEqual(Object.keys(copy.en.desk.types));
    expect(Object.keys(copy.fil.feedback)).toEqual(Object.keys(copy.en.feedback));
    expect(Object.keys(copy.fil.loading)).toEqual(Object.keys(copy.en.loading));
  });

  it("keeps the treasury desk aligned, including the earmark approval brief", () => {
    const en = copy.en.revamp.treasuryDesk;
    const fil = copy.fil.revamp.treasuryDesk;
    expect(Object.keys(fil)).toEqual(Object.keys(en));
    expect(Object.keys(fil.earmarkReview)).toEqual(Object.keys(en.earmarkReview));
    expect(Object.keys(fil.earmarkReview.verdicts)).toEqual(
      Object.keys(en.earmarkReview.verdicts)
    );
    expect(Object.keys(fil.earmarkReview.blocks)).toEqual(
      Object.keys(en.earmarkReview.blocks)
    );
    expect(Object.keys(fil.earmarkReview.roleNames)).toEqual(
      Object.keys(en.earmarkReview.roleNames)
    );
  });

  it("gives every earmark verdict and block a sentence in each language", () => {
    const enDesk = copy.en.revamp.treasuryDesk;
    const filDesk = copy.fil.revamp.treasuryDesk;
    const en = enDesk.earmarkReview;
    const fil = filDesk.earmarkReview;
    for (const verdict of Object.values(en.verdicts)) {
      expect(verdict.length).toBeGreaterThan(20);
    }
    for (const block of Object.values(fil.blocks)) {
      expect(block.length).toBeGreaterThan(20);
    }
    // The placeholders the screens fill in have to survive translation.
    expect(fil.verdicts.PART_FUNDS).toContain("{shortfall}");
    expect(fil.verdicts.UNBLOCKS).toContain("{case}");
    expect(fil.blocks.SELF_PREPARED).toContain("{desk}");
    expect(fil.blocks.OVER_AVAILABLE).toContain("{available}");
    expect(fil.confirmApprove).toContain("{amount}");
    expect(enDesk.fundingProposeShortfall).toContain("{shortfall}");
    expect(filDesk.fundingProposeShortfall).toContain("{shortfall}");
    expect(enDesk.fundingNeedsMore).toContain("{shortfall}");
    expect(filDesk.fundingNeedsMore).toContain("{shortfall}");
  });

  it("gives the loading status a real translation in each language", () => {
    expect(copy.en.loading.label).toBe("Loading…");
    expect(copy.fil.loading.label).toBe("Naglo-load…");
  });
});
