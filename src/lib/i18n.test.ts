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

  it("gives the loading status a real translation in each language", () => {
    expect(copy.en.loading.label).toBe("Loading…");
    expect(copy.fil.loading.label).toBe("Naglo-load…");
  });
});
