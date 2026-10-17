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
      "Other Concern",
    ]);
    // A health category belongs to Assistance and may never appear under
    // Repair / Public Works. An unconnected category is not a wildcard
    // either: it sits in its own labelled group, and choosing it connects
    // it to the picked type.
    expect(optionLabels(categorySelect)).not.toContain("Health Concern");
    const group = categorySelect.querySelector("optgroup");
    expect(group?.label).toBe(t.validationUnconnectedGroup);
    expect(
      [...(group?.querySelectorAll("option") ?? [])].map(
        (option) => option.textContent
      )
    ).toEqual(["Other Concern"]);
    expect(container.textContent).toContain(t.validationUnconnectedHint);

    await choose(typeSelect, "1");
    expect(optionLabels(categorySelect)).toEqual([
      t.validationCategoryPlaceholder,
      "Health Concern",
      "Other Concern",
    ]);
  });

  it("stays usable when the chosen type has only unconnected categories", async () => {
    // Regression: a type whose categories were never connected (the
    // pre-connection data) disabled the picker with "No active category is
    // configured", so the case in the screenshot could not be validated.
    await act(async () =>
      root.render(
        createElement(ValidationForm, {
          concernId: 42,
          locale: "en",
          types: [{ id: 3, label: "Budget / Fund Release" }],
          categories: [
            { id: 11, label: "Road Damage", typeId: null },
            { id: 12, label: "Health Concern", typeId: 1 },
          ],
          currentTypeLabel: "Budget / Fund Release",
          currentCategoryLabel: "Road Damage",
          currentPriority: null,
        })
      )
    );
    const typeSelect = selectById("validation-type");
    const categorySelect = selectById("validation-category");

    await choose(typeSelect, "3");
    expect(categorySelect.disabled).toBe(false);
    expect(container.textContent).not.toContain(t.validationNoCategories);
    expect(optionLabels(categorySelect)).toEqual([
      t.validationCategoryPlaceholder,
      "Road Damage",
    ]);

    await choose(categorySelect, "11");
    expect(categorySelect.value).toBe("11");
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
