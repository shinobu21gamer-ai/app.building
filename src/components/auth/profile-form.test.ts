import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProfileForm } from "./profile-form";

const user = { id: 1, email: "juan@example.com", firstName: "Juan", lastName: "Cruz", phone: "••••1234", address: null };
describe("optional profile phone", () => {
  it("shows a masked saved phone as a hint, not as editable input", () => {
    const html = renderToStaticMarkup(createElement(ProfileForm, { user }));
    expect(html).toMatch(/id="phone"[^>]*placeholder="••••1234"[^>]*value=""/);
    expect(html).not.toContain('value="••••1234"');
    expect(html).toContain("Leave blank to keep it");
    expect(html).toContain("Remove saved number");
    expect(html).toContain("Phone (optional)");
  });
  it("does not require a phone or address when none is saved", () => {
    const html = renderToStaticMarkup(createElement(ProfileForm, { user: { ...user, phone: null } }));
    expect(html).not.toContain("Remove saved number");
    const phoneTag = html.match(/<input[^>]*id="phone"[^>]*>/)?.[0];
    expect(phoneTag).toBeDefined();
    expect(phoneTag).not.toContain("required");
  });
});
