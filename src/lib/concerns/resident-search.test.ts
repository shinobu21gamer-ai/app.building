import { describe, expect, it } from "vitest";
import { residentConcernWhere, residentSearch, residentSearchHref } from "./resident-search";
describe("resident concern search", () => {
  it("keeps every search scoped to the signed-in resident", () => {
    const search = residentSearch({ q: " BR-20261014 ", status: "AWAITING_BUDGET", page: "2" });
    expect(residentConcernWhere(9, search)).toEqual({
      userId: 9, status: "AWAITING_BUDGET", OR: [
        { caseNumber: { contains: "BR-20261014", mode: "insensitive" } },
        { title: { contains: "BR-20261014", mode: "insensitive" } },
      ],
    });
  });
  it.each(["-1", "0", "garbage", "1e99", "99999999999999999999"])("safely handles invalid page %s", (page) => {
    expect(residentSearch({ page }).page).toBe(1);
  });
  it("caps page and search length and ignores invalid/duplicate parameters", () => {
    expect(residentSearch({ q: "x".repeat(200), page: "200000", status: "UNKNOWN" })).toEqual({ q: "x".repeat(100), page: 100000, status: "" });
    expect(residentSearch({ q: ["one", "two"], page: ["2"], status: ["CLOSED"] })).toEqual({ q: "", page: 1, status: "" });
  });
  it("preserves and encodes filters in paging links", () => {
    const href = residentSearchHref(residentSearch({ q: "Road & drainage", status: "CLOSED" }), 3);
    const url = new URL(href, "https://app.test");
    expect(url.searchParams.get("q")).toBe("Road & drainage");
    expect(url.searchParams.get("status")).toBe("CLOSED");
    expect(url.searchParams.get("page")).toBe("3");
  });
});
