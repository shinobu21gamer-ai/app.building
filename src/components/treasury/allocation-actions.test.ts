// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AllocationActions } from "./allocation-actions";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  mocks.request.mockResolvedValue({ success: true, data: { available: 419_450 } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: Partial<Parameters<typeof AllocationActions>[0]> = {}) {
  await act(async () =>
    root.render(
      createElement(AllocationActions, {
        allocationId: 5,
        status: "APPROVED",
        appropriated: 1_099_012_100,
        committed: 80_550,
        available: 1_098_931_550,
        canApprove: false,
        canAdjust: true,
        canClose: false,
        ...props,
      })
    )
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(label)
  );
  if (!found) throw new Error(`button not rendered: ${label}`);
  return found as HTMLButtonElement;
}

async function openAdjust() {
  await act(async () => button("Adjust").click());
}

async function setAmount(value: string) {
  const input = container.querySelector<HTMLInputElement>("#adjust-amount");
  if (!input) throw new Error("adjust amount input not rendered");
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(memo: string) {
  const memoField = container.querySelector<HTMLTextAreaElement>("#adjust-memo");
  if (!memoField) throw new Error("memo field not rendered");
  memoField.value = memo;
  await act(async () => button("Save").click());
}

describe("AllocationActions appropriation editor", () => {
  it("prefills the current appropriation and previews the decrease", async () => {
    await render();
    await openAdjust();

    const input = container.querySelector<HTMLInputElement>("#adjust-amount");
    expect(input?.value).toBe("1099012100");

    await setAmount("500000");
    expect(container.textContent).toContain("Decrease of");
    expect(container.textContent).toContain("available becomes");
  });

  it("sends only the difference to the ledger endpoint, with the memo", async () => {
    await render();
    await openAdjust();
    await setAmount("500000");
    await submit("Correcting the inflated test appropriation");

    expect(mocks.request).toHaveBeenCalledWith("/api/v1/treasury/allocations/5", {
      method: "PATCH",
      body: JSON.stringify({
        action: "ADJUST",
        amount: 500_000 - 1_099_012_100,
        memo: "Correcting the inflated test appropriation",
      }),
    });
  });

  it("refuses to drop the appropriation below what is reserved or spent", async () => {
    await render();
    await openAdjust();
    // ₱80,550 is committed; 50,000 would leave it uncovered.
    await setAmount("50000");
    await submit("Trying to cut below the reserved money");

    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("already reserved or spent");
  });

  it("refuses a no-change adjustment", async () => {
    await render();
    await openAdjust();
    await submit("Memo that changes nothing at all");

    expect(mocks.request).not.toHaveBeenCalled();
    expect(container.textContent).toContain("nothing to adjust");
  });

  it("hides the editor from roles without the adjust permission", async () => {
    await render({ canAdjust: false });
    expect(container.textContent).not.toContain("Adjust");
  });
});
