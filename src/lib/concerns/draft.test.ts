// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { saveConcernDraft, readConcernDraft, removeConcernDraft, clearConcernDrafts } from "./draft";
afterEach(() => sessionStorage.clear());
describe("opt-in private concern drafts", () => {
  it("saves only allowed text fields, excluding photos and precise GPS", () => {
    const data = new FormData();
    data.set("title", "Broken street light"); data.set("description", "The light is not working.");
    data.set("locationLat", "14.1"); data.set("image", new File(["image"], "proof.png"));
    data.set("password", "must not be saved");
    saveConcernDraft(sessionStorage, 1, data, 1000);
    expect(readConcernDraft(sessionStorage, 1, 1001)?.fields).toEqual({ title: "Broken street light", description: "The light is not working." });
  });
  it("never restores another resident's draft", () => {
    saveConcernDraft(sessionStorage, 1, new FormData(), 1000);
    expect(readConcernDraft(sessionStorage, 2, 1001)).toBeNull();
  });
  it("expires drafts after 24 hours", () => {
    saveConcernDraft(sessionStorage, 1, new FormData(), 1000);
    expect(readConcernDraft(sessionStorage, 1, 1000 + 86400000)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });
  it("rejects corrupt, future-dated, and unsupported drafts", () => {
    for (const raw of ["broken", JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, savedAt: 2000, fields: {} })]) {
      sessionStorage.setItem("barangayresolve.concernDraft.1", raw);
      expect(readConcernDraft(sessionStorage, 1, 1000)).toBeNull();
    }
  });
  it("clears only concern drafts on sign-out, leaving unrelated preferences", () => {
    saveConcernDraft(sessionStorage, 1, new FormData(), 1000);
    saveConcernDraft(sessionStorage, 2, new FormData(), 1000);
    sessionStorage.setItem("preference", "fil");
    clearConcernDrafts(sessionStorage);
    expect(sessionStorage.length).toBe(1); expect(sessionStorage.getItem("preference")).toBe("fil");
  });
  it("can discard one resident's draft", () => {
    saveConcernDraft(sessionStorage, 1, new FormData(), 1000);
    removeConcernDraft(sessionStorage, 1);
    expect(readConcernDraft(sessionStorage, 1, 1001)).toBeNull();
  });
});
