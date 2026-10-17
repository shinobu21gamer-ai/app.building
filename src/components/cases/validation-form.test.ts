// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValidationForm } from "./validation-form";
import { copy } from "@/lib/i18n";

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
      createElement(ValidationForm, {
        concernId: 42,
        locale: "en",
        types: [
          { id: 1, label: "Assistance (Ayuda)" },
          { id: 2, label: "Repair / Public Works" },
        ],
        categories: [
          { id: 10, label: "Drainage / Flooding", typeId: 2 },
          { id: 11, label: "Road Damage", typeId: 2 },
          { id: 12, label: "Health Concern", typeId: 1 },
          { id: 13, label: "Other Concern", typeId: null },
        ],
        currentTypeLabel: "Repair / Public Works",
        currentCategoryLabel: "Barangay Document Request",
        currentPriority: null,
      })
    )
  );
}

function selectById(id: string): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(`#${id}`);
  if (!found) throw new Error(`Select not found: ${id}`);
  return found;
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    // Bypass React's value tracker to model a real native change event.
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function optionLabels(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.textContent ?? "");
}

describe("validation category choices", () => {
  it("offers only the categories connected to the chosen service type", async () => {
    await renderForm();
    const typeSelect = selectById("validation-type");
    const categorySelect = selectById("validation-category");

    // No type chosen yet: the category picker stays closed.
    expect(categorySelect.disabled).toBe(true);

    await choose(typeSelect, "2");
    expect(categorySelect.disabled).toBe(false);
    expect(optionLabels(categorySelect)).toEqual([
      t.validationCategoryPlaceholder,
      "Drainage / Flooding",
      "Road Damage",
    ]);
    // A health category belongs to Assistance, and an unconnected category
    // is not a wildcard: neither may appear under Repair / Public Works.
    expect(optionLabels(categorySelect)).not.toContain("Health Concern");
    expect(optionLabels(categorySelect)).not.toContain("Other Concern");

    await choose(typeSelect, "1");
    expect(optionLabels(categorySelect)).toEqual([
      t.validationCategoryPlaceholder,
      "Health Concern",
    ]);
  });

  it("clears the picked category when the service type changes", async () => {
    await renderForm();
    const typeSelect = selectById("validation-type");
    const categorySelect = selectById("validation-category");

    await choose(typeSelect, "2");
    await choose(categorySelect, "10");
    expect(categorySelect.value).toBe("10");

    await choose(typeSelect, "1");
    expect(categorySelect.value).toBe("");
  });
});
