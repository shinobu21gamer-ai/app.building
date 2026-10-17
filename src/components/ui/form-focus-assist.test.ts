// @vitest-environment jsdom
import { act, createElement, Fragment, useState, type FormEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormFocusAssist } from "./form-focus-assist";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function waitForFrame() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 30));
}

describe("FormFocusAssist", () => {
  it("focuses and scrolls to the first required field left empty on submit", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(FormFocusAssist),
          createElement(
            "form",
            { noValidate: true, onSubmit: (event: FormEvent) => event.preventDefault() },
            createElement("label", { htmlFor: "required-name" },
              createElement("span", { "aria-label": "Required" }, "*"),
              " Name"
            ),
            createElement("input", { id: "required-name", "aria-required": "true" }),
            createElement("button", { type: "submit" }, "Save")
          )
        )
      )
    );

    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await waitForFrame();
    });

    expect(document.activeElement).toBe(container.querySelector("#required-name"));
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("focuses an invalid field when a server-style error appears after submit", async () => {
    function AsyncValidationForm() {
      const [invalid, setInvalid] = useState(false);
      return createElement(
        "form",
        { noValidate: true, onSubmit: (event: FormEvent) => { event.preventDefault(); setInvalid(true); } },
        createElement("input", {
          id: "email-address",
          "aria-describedby": invalid ? "email-error" : undefined,
        }),
        invalid ? createElement("p", { id: "email-error", role: "alert" }, "Enter a valid email.") : null,
        createElement("button", { type: "submit" }, "Save")
      );
    }

    await act(async () =>
      root.render(
        createElement(
          Fragment,
          null,
          createElement(FormFocusAssist),
          createElement(AsyncValidationForm)
        )
      )
    );
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true })
      );
      await waitForFrame();
    });

    expect(document.activeElement).toBe(container.querySelector("#email-address"));
  });
});
