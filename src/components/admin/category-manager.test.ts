// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CategoryManager,
  type AdminCategoryItem,
} from "./category-manager";
import { copy } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const t = copy.en.admin.mgr;

const categories: AdminCategoryItem[] = [
  {
    id: 5,
    name: "Drainage / Flooding",
    code: "DRAINAGE",
    description: null,
    isActive: true,
    typeId: 2,
    typeName: "Repair / Public Works",
    references: { concerns: 0, routingRules: 0, total: 0 },
  },
  {
    id: 6,
    name: "Health Concern",
    code: "HEALTH",
    description: null,
    isActive: true,
    typeId: null,
    typeName: null,
    references: { concerns: 0, routingRules: 0, total: 0 },
  },
];

const types = [
  { id: 1, label: "Assistance (Ayuda)" },
  { id: 2, label: "Repair / Public Works" },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({
    success: true,
    data: { category: categories[0] },
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

async function renderManager() {
  await act(async () =>
    root.render(
      createElement(CategoryManager, { categories, types, locale: "en" })
    )
  );
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(text)
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement) {
  await act(async () => element.click());
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value"
    )!.set!.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function submitForm() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function sentPayload() {
  const [, options] = mocks.request.mock.calls[0];
  return JSON.parse(options.body);
}

describe("category service type connection", () => {
  it("shows each category's service type, or that it is not assigned yet", async () => {
    await renderManager();
    expect(container.textContent).toContain("Repair / Public Works");
    expect(container.textContent).toContain(t.categoryTypeUnassigned);
  });

  it("keeps the connected service type when an existing category is saved", async () => {
    await renderManager();
    const row = [...container.querySelectorAll("tr")].find((element) =>
      element.textContent?.includes("Drainage / Flooding")
    );
    const edit = [...row!.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(t.edit)
    );
    if (!edit) throw new Error("Edit button not found");
    await click(edit);

    const select = container.querySelector<HTMLSelectElement>("#category-type");
    expect(select?.value).toBe("2");

    await submitForm();
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(sentPayload().typeId).toBe(2);
  });

  it("connects a new category to the chosen service type", async () => {
    await renderManager();
    await click(button(t.addCategory));
    await typeInto(container.querySelector<HTMLInputElement>("#category-name")!, "Noise Complaint");
    await typeInto(container.querySelector<HTMLInputElement>("#category-code")!, "NOISE2");
    await choose(container.querySelector<HTMLSelectElement>("#category-type")!, "1");

    await submitForm();
    expect(mocks.request).toHaveBeenCalledOnce();
    const [path, options] = mocks.request.mock.calls[0];
    expect(path).toBe("/api/v1/admin/concern-categories");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body).typeId).toBe(1);
  });
});
