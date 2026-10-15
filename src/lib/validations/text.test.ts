import { describe, expect, it } from "vitest";
import {
  describeFieldProblem,
  isContactLike,
  isEmailLike,
  isPhMobile,
  isPhoneLike,
  officeContactSchema,
  personNameSchema,
  readableTextSchema,
} from "./text";
import { officeCreateSchema, officeUpdateSchema } from "./admin";
import { crewRosterUpsertSchema } from "./crew";

describe("substance rules", () => {
  it("rejects symbol soup in free text", () => {
    for (const junk of ["++++", "@@@", "....", "-----", "$$$"]) {
      expect(readableTextSchema("Office name", 120).safeParse(junk).success).toBe(false);
    }
  });

  it("accepts text that reads as text, digits included", () => {
    for (const value of ["Committee on Infrastructure", "Purok 3 Office", "Office 12-A"]) {
      expect(readableTextSchema("Office name", 120).safeParse(value).success).toBe(true);
    }
  });

  it("rejects digits and symbols in a person's name", () => {
    for (const junk of ["Juan 2", "++ Marites", "Ana@home", "Juan+Maria"]) {
      expect(personNameSchema("First name").safeParse(junk).success).toBe(false);
    }
  });

  it("accepts names with the punctuation real names carry", () => {
    for (const value of ["Ana", "Maria Clara", "Jose Rizal Jr.", "Niña", "O'Neil", "Dela Cruz-Santos"]) {
      expect(personNameSchema("First name").safeParse(value).success).toBe(true);
    }
  });
});

describe("contact rules", () => {
  it("accepts Philippine mobile, landline and international numbers", () => {
    for (const value of [
      "0917 123 4567",
      "0917-000-0001",
      "+63 917 123 4567",
      "(02) 8888 7777",
      "028888777",
      "+1 415 555 0132",
    ]) {
      expect(isPhoneLike(value)).toBe(true);
    }
  });

  it("rejects half-typed numbers, words and stray symbols", () => {
    for (const value of ["+", "091", "call the office", "n/a", "@", "1234567890123456789"]) {
      expect(isPhoneLike(value)).toBe(false);
    }
  });

  it("accepts a real email and rejects a malformed one", () => {
    expect(isEmailLike("office@barangay.gov.ph")).toBe(true);
    expect(isEmailLike("office@barangay")).toBe(false);
    expect(isEmailLike("office@@barangay.gov.ph")).toBe(false);
  });

  it("treats a contact as valid only when it is a phone number or an email", () => {
    expect(isContactLike("engineering@barangay.gov.ph")).toBe(true);
    expect(isContactLike("0917 123 4567")).toBe(true);
    expect(isContactLike("look for Ate Susan")).toBe(false);
    expect(isContactLike("+")).toBe(false);
  });

  it("explains what is wrong, per field kind", () => {
    expect(describeFieldProblem("", "contact")).toBeNull();
    expect(describeFieldProblem("+", "contact")).toMatch(/valid phone number/);
    expect(describeFieldProblem("Juan 2", "name")).toMatch(/letters only/);
    expect(describeFieldProblem("+++", "text")).toMatch(/letters or numbers/);
    expect(describeFieldProblem("Maria Santos", "name")).toBeNull();
  });
});

describe("office schema with the stricter rules", () => {
  const base = { name: "Infrastructure Office", code: "INFRA" };

  it("still creates an office from a plain phone number or an email", () => {
    expect(officeCreateSchema.safeParse({ ...base, contact: "0917-000-0001" }).success).toBe(true);
    expect(
      officeCreateSchema.safeParse({ ...base, contact: "infra@barangay.gov.ph" }).success
    ).toBe(true);
  });

  it("refuses an incomplete or symbolic contact", () => {
    for (const contact of ["", "+", "0917", "not a contact", "..."]) {
      expect(officeCreateSchema.safeParse({ ...base, contact }).success).toBe(false);
    }
  });

  it("refuses a head officer that is not a name, but still allows a blank one", () => {
    expect(officeCreateSchema.safeParse({ ...base, contact: "0917-000-0001", headOfficer: "" }).success).toBe(true);
    expect(
      officeCreateSchema.safeParse({ ...base, contact: "0917-000-0001", headOfficer: "###" }).success
    ).toBe(false);
  });

  it("keeps status-only updates valid and validates a changed contact", () => {
    expect(officeUpdateSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(officeUpdateSchema.safeParse({ contact: "0917 123 4567" }).success).toBe(true);
    expect(officeUpdateSchema.safeParse({ contact: "++++" }).success).toBe(false);
  });

  it("normalises a blank optional contact schema from the form", () => {
    const result = officeContactSchema(120).safeParse("0917 123 4567");
    expect(result.success).toBe(true);
  });
});

describe("isPhMobile", () => {
  it("accepts every shape the server normaliser accepts", () => {
    for (const good of [
      "+639171234567",
      "639171234567",
      "09171234567",
      "9171234567",
      "0917 123 4567",
      "(0917) 123-4567",
      "+63 917 123 4567",
      " +63 917 123 4567 ",
    ]) {
      expect(isPhMobile(good), good).toBe(true);
    }
  });

  it("rejects landlines, emails, symbols and foreign numbers", () => {
    for (const bad of [
      "",
      "   ",
      "02 8888 7777", // PH landline
      "88887777",
      "office@barangay.gov.ph",
      "call the office",
      "0917", // too short
      "091712345678", // 12 digits, not a PH mobile
      "+1 555 123 4567", // US number
      "917123456", // 9 digits
      "8171234567", // ten digits but not 9XXXXXXXXX
      "+++ 09171234567", // leading plus plus plus
    ]) {
      expect(isPhMobile(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("crew roster schema", () => {
  it("only accepts configured trades and employment types", () => {
    expect(crewRosterUpsertSchema.safeParse({ userId: 1, trade: "PLUMBING" }).success).toBe(true);
    expect(crewRosterUpsertSchema.safeParse({ userId: 1, trade: "ASTROLOGY" }).success).toBe(false);
    expect(
      crewRosterUpsertSchema.safeParse({ userId: 1, employmentType: "CASUAL" }).success
    ).toBe(true);
    expect(
      crewRosterUpsertSchema.safeParse({ userId: 1, employmentType: "freelance" }).success
    ).toBe(false);
  });

  it("refuses a notes field made of symbols", () => {
    expect(crewRosterUpsertSchema.safeParse({ userId: 1, notes: "+++" }).success).toBe(false);
    expect(
      crewRosterUpsertSchema.safeParse({ userId: 1, notes: "Certified electrician" }).success
    ).toBe(true);
  });

  it("keeps a blank trade meaning 'not set'", () => {
    const result = crewRosterUpsertSchema.safeParse({ userId: 1, trade: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trade).toBeUndefined();
  });
});
