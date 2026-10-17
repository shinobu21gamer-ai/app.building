// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentForm } from "./assessment-form";
import { copy } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const t = copy.en.revamp.workflow;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({
    success: true,
    data: { caseNumber: "BR-2026-0001", cost: { totalCost: 18000 } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderForm() {
  await act(async () =>
    root.render(
      createElement(AssessmentForm, {
        concernId: 42,
        locale: "en",
        defaults: null,
        suggestions: [],
        equipmentSuggestions: [
          {
            name: "Dump truck",
            quantity: "2",
            unit: "days",
            unitPrice: "6000",
            amount: "12000",
          },
        ],
        needs: { crew: true, budget: true, equipment: true, materials: true },
      })
    )
  );
}

function field<T extends HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector);
  if (!found) throw new Error(`Field not found: ${selector}`);
  return found;
}

async function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("assessment equipment list", () => {
  it("names the equipment with a rate and totals the lines, with no bare figure input", async () => {
    await renderForm();
    const name = field<HTMLInputElement>('[id^="equipment-name-"]');
    expect(name.value).toBe("Dump truck");
    expect(container.querySelector("#equipmentCost")).toBeNull();
    expect(container.textContent).toContain(t.equipmentTotal);
    expect(container.textContent).toContain("₱12000.00");
  });

  it("recomputes a line and the equipment total when the quantity changes", async () => {
    await renderForm();
    await setValue(field<HTMLInputElement>('[id^="equipment-qty-"]'), "3");
    expect(field<HTMLInputElement>('[id^="equipment-amount-"]').value).toBe(
      "18000.00"
    );
    expect(container.textContent).toContain("₱18000.00");
  });

  it("submits the named equipment lines instead of a bare equipment figure", async () => {
    await renderForm();
    await setValue(field<HTMLInputElement>("#workersNeeded"), "2");
    await setValue(field<HTMLInputElement>("#durationHours"), "8");
    await setValue(field<HTMLTextAreaElement>("#equipmentNotes"), "From the depot");

    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.request).toHaveBeenCalledOnce();
    const [, options] = mocks.request.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.equipmentCost).toBe("");
    expect(payload.equipment).toEqual([
      {
        name: "Dump truck",
        quantity: 2,
        unit: "days",
        unitPrice: 6000,
        amount: 12000,
        note: "",
      },
    ]);
  });
});
