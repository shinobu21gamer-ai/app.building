import { describe, expect, it } from "vitest";
import {
  COA_PROVENANCE,
  allotmentClassLabel,
  codeUsable,
  formatCoaCode,
  groupCodesByGroup,
  isMooeCode,
  isValidCoaCode,
  normalizeCoaCode,
  parseCoaCode,
  provenanceLine,
  verificationLabel,
} from "@/lib/treasury/coa";

describe("COA object-code parsing", () => {
  it("parses an eight-digit MOOE code", () => {
    const parsed = parseCoaCode("5-02-13-030");
    expect(parsed).not.toBeNull();
    expect(parsed?.allotmentClass).toBe("2");
    expect(parsed?.groupCode).toBe("13");
    expect(parsed?.objectCode).toBe("030");
    expect(parsed?.subObjectCode).toBeNull();
    expect(parsed?.digits).toBe("50213030");
  });

  it("parses a code with a sub-object", () => {
    const parsed = parseCoaCode("5-02-13-030-01");
    expect(parsed?.subObjectCode).toBe("01");
    expect(parsed?.digits).toBe("50213030");
    expect(parsed?.code).toBe("5-02-13-030-01");
  });

  it("accepts the digits typed straight through", () => {
    expect(normalizeCoaCode("50213030")).toBe("5-02-13-030");
    expect(normalizeCoaCode("5-02-13-030-01")).toBe("5-02-13-030-01");
    expect(normalizeCoaCode(" 5-02-16-010 ")).toBe("5-02-16-010");
  });

  it("rejects anything that is not an object-code shape", () => {
    expect(isValidCoaCode("5-02-13")).toBe(false);
    expect(isValidCoaCode("labor")).toBe(false);
    expect(isValidCoaCode("")).toBe(false);
    expect(parseCoaCode("5-02-13-03")).toBeNull();
  });

  it("recognizes MOOE from the allotment class", () => {
    expect(isMooeCode("5-02-16-010")).toBe(true);
    expect(isMooeCode("5-01-01-010")).toBe(false);
    expect(isMooeCode("5-02-16-010")).toBe(true);
    expect(allotmentClassLabel("5-02-16-010")).toContain("MOOE");
    expect(allotmentClassLabel("5-02-16-010")).toContain("Maintenance");
  });

  it("formats a code with an explicit sub-object", () => {
    expect(formatCoaCode("5-02-13-030", "05")).toBe("5-02-13-030-05");
    expect(formatCoaCode("5-02-13-030-01")).toBe("5-02-13-030-01");
  });
});

describe("code verification gate", () => {
  it("refuses an unverified code and says why", () => {
    const result = codeUsable({
      code: "5-02-13-030",
      verificationStatus: "UNVERIFIED",
      isActive: true,
    });
    expect(result.usable).toBe(false);
    expect(result.reason).toContain("has not been verified");
  });

  it("refuses a deprecated code", () => {
    const result = codeUsable({
      code: "5-02-13-030",
      verificationStatus: "DEPRECATED",
      isActive: true,
    });
    expect(result.usable).toBe(false);
    expect(result.reason).toContain("retired");
  });

  it("refuses a code that was turned off", () => {
    const result = codeUsable({
      code: "5-02-13-030",
      verificationStatus: "VERIFIED",
      isActive: false,
    });
    expect(result.usable).toBe(false);
    expect(result.reason).toContain("turned off");
  });

  it("allows a verified, active code", () => {
    expect(
      codeUsable({
        code: "5-02-13-030",
        verificationStatus: "VERIFIED",
        isActive: true,
      }).usable
    ).toBe(true);
  });

  it("records where the shipped codes come from", () => {
    expect(COA_PROVENANCE.url).toContain("coa.gov.ph");
    expect(provenanceLine({ verificationStatus: "VERIFIED" })).toContain(
      "COA GAM"
    );
    expect(provenanceLine({ verificationStatus: "UNVERIFIED" })).toBe(
      verificationLabel("UNVERIFIED")
    );
  });
});

describe("code grouping", () => {
  it("groups rows by their two-digit group and sorts the groups", () => {
    const groups = groupCodesByGroup([
      { code: "5-02-16-010", groupCode: "16" },
      { code: "5-02-13-030", groupCode: "13" },
      { code: "5-02-13-040", groupCode: "13" },
    ]);
    expect(groups.map((group) => group.groupCode)).toEqual(["13", "16"]);
    expect(groups[0].rows).toHaveLength(2);
  });
});
