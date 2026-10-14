// @vitest-environment jsdom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DraftControls } from "./draft-controls";
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); sessionStorage.clear(); });
function button(text: string) { return [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(text))!; }
async function mount(userId = 1) {
  const formRef = createRef<HTMLFormElement>();
  await act(async () => root.render(createElement("form", { ref: formRef },
    createElement(DraftControls, { userId, formRef, locale: "en" }),
    createElement("input", { name: "title", defaultValue: "Streetlight not working" }),
    createElement("textarea", { name: "description", defaultValue: "The light is broken" }),
  )));
}
describe("resident draft controls", () => {
  it("saves only on request and restores text without submitting the form", async () => {
    await mount(); expect(sessionStorage.length).toBe(0);
    await act(async () => button("Save draft").click());
    expect(container.textContent).toContain("has not been submitted");
    const title = container.querySelector<HTMLInputElement>('[name="title"]')!;
    title.value = "Different unsaved text";
    await act(async () => button("Restore draft").click());
    expect(title.value).toBe("Streetlight not working");
    expect(document.activeElement).toBe(title);
  });
  it("can discard a draft without clearing unrelated data", async () => {
    await mount(); sessionStorage.setItem("language", "fil");
    await act(async () => button("Save draft").click());
    await act(async () => button("Discard draft").click());
    expect(sessionStorage.length).toBe(1); expect(sessionStorage.getItem("language")).toBe("fil");
    expect(button("Restore draft")).toBeUndefined();
  });
  it("shows an offline notice and removes it after reconnecting", async () => {
    await mount();
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
    try {
      Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
      await act(async () => window.dispatchEvent(new Event("offline")));
      expect(container.textContent).toContain("You are offline");
      Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
      await act(async () => window.dispatchEvent(new Event("online")));
      expect(container.textContent).not.toContain("You are offline");
    } finally {
      if (descriptor) Object.defineProperty(navigator, "onLine", descriptor);
      else Reflect.deleteProperty(navigator, "onLine");
    }
  });
});
