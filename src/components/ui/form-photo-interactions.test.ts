// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadedPhoto } from "./uploaded-photo";
import { ProfileForm } from "@/components/auth/profile-form";
import { RoleNav } from "./role-nav";

const mocks = vi.hoisted(() => ({ request: vi.fn(), pathname: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));
const user = { id: 1, email: "juan@example.com", firstName: "Juan", lastName: "Cruz", phone: "••••1234", address: null };
const src = "/api/v1/uploads/12345678-1234-1234-1234-123456789abc.png";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({ success: true, data: { user } });
  mocks.pathname.mockReturnValue("/admin/privacy");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
function button(text: string) {
  const found = [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text));
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
async function submit() {
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
function sentPayload() {
  return JSON.parse(mocks.request.mock.calls[0][1].body);
}

describe("profile phone interactions", () => {
  it("saves other profile details without sending the masked or untouched phone", async () => {
    await act(async () => root.render(createElement(ProfileForm, { user })));
    await submit();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(sentPayload()).not.toHaveProperty("phone");
    expect(container.textContent).toContain("Profile updated.");
  });
  it("only clears a saved number after an explicit removal and save", async () => {
    mocks.request.mockResolvedValue({ success: true, data: { user: { ...user, phone: null } } });
    await act(async () => root.render(createElement(ProfileForm, { user })));
    await act(async () => button("Remove saved number").click());
    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("will be removed when you save");
    await submit();
    expect(sentPayload().phone).toBeNull();
    expect(container.textContent).not.toContain("Saved number:");
  });
  it("validates and normalizes a replacement phone", async () => {
    await act(async () => root.render(createElement(ProfileForm, { user })));
    const input = container.querySelector<HTMLInputElement>("#phone")!;
    await act(async () => {
      // Bypass React's value tracker to model a real native input event.
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0917 123 4567");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(sentPayload().phone).toBe("+639171234567");
  });
});

describe("photo interactions", () => {
  function stubPhotoFetch(ok: boolean) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        ok
          ? {
              ok: true,
              blob: async () =>
                new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
            }
          : { ok: false, blob: async () => new Blob() }
      )
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:photo",
      revokeObjectURL: () => undefined,
    });
  }

  it("replaces broken images with a retry message and retries with the session cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, blob: async () => new Blob() });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: () => "blob:photo",
      revokeObjectURL: () => undefined,
    });
    await act(async () => root.render(createElement(UploadedPhoto, { src, alt: "Proof" })));
    await act(async () => {
      await fetchMock.mock.results[0]?.value;
      await Promise.resolve();
    });
    const broken = container.querySelector("img");
    if (broken) {
      await act(async () => {
        broken.dispatchEvent(new Event("error"));
      });
    }
    expect(container.textContent).toContain("This photo could not be loaded");
    fetchMock.mockResolvedValue({
      ok: true,
      blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
    });
    await act(async () => button("Try again").click());
    await act(async () => {
      await fetchMock.mock.results.at(-1)?.value;
    });
    expect(fetchMock).toHaveBeenCalledWith(src, expect.objectContaining({ credentials: "include" }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:photo");
    expect(container.textContent).not.toContain("This photo could not be loaded");
  });
  it("opens and closes a full-size modal using the photo controls", async () => {
    stubPhotoFetch(true);
    // jsdom has no top layer: stub only the native dialog methods; the React
    // click handlers and DOM controls are real. Browser focus trapping is not
    // asserted here.
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true, writable: true, value() { this.setAttribute("open", ""); },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true, writable: true, value() { this.removeAttribute("open"); },
    });
    const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    const close = vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); });
    await act(async () => root.render(createElement(UploadedPhoto, { src, alt: "Proof" })));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => button("View full photo").click());
    expect(show).toHaveBeenCalledOnce();
    expect(container.querySelector("dialog")!.open).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Close photo"]')!.click());
    expect(close).toHaveBeenCalledOnce();
    expect(container.querySelector("dialog")!.open).toBe(false);
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("sidebar scrolling", () => {
  it("scrolls a below-fold active destination inside its own bounded region", async () => {
    const bounds = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const top = this.tagName === "A" ? 600 : 80;
      return { top, bottom: top + 40, left: 0, right: 240, width: 240, height: 40, x: 0, y: top, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(250);
    await act(async () => root.render(createElement(RoleNav, { label: "Admin menu", items: [
      { href: "/admin", label: "Dashboard" }, { href: "/admin/privacy", label: "Privacy desk" },
    ] })));
    const region = container.querySelector<HTMLElement>("nav[aria-label='Admin menu']")!;
    expect(region.scrollTop).toBe(512);
    expect(region.tabIndex).toBe(0);
    expect(region.className).toContain("overflow-y-auto");
    expect(container.querySelector('[aria-current="page"]')!.textContent).toContain("Privacy desk");
    expect(bounds).toHaveBeenCalled();
  });
});
