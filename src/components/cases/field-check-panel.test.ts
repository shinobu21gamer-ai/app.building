// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldCheckPanel, type FieldCheckView } from "./field-check-panel";
import { copy } from "@/lib/i18n";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const t = copy.en.revamp.workflow.fieldCheck;
const gone = copy.en.photoViewer.gone;

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

function check(overrides: Partial<FieldCheckView>): FieldCheckView {
  return {
    id: 7,
    status: "SUBMITTED",
    instructions: "Check the street light near the chapel.",
    finding: "CONFIRMED",
    findingNotes: "The light is really there.",
    findingPhotoUrl: null,
    reviewNote: null,
    assigneeId: 9,
    assigneeName: "Jose Santos",
    requestedByName: "Admin Ana",
    ...overrides,
  };
}

async function renderPanel(checks: FieldCheckView[]) {
  await act(async () =>
    root.render(
      createElement(FieldCheckPanel, {
        concernId: 42,
        locale: "en",
        checks,
        roster: [],
        caseStatus: "SUBMITTED",
        canRequest: false,
        canReview: true,
        currentUserId: 1,
      })
    )
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function button(text: string) {
  const found = [...container.querySelectorAll("button")].find((element) =>
    element.textContent?.includes(text)
  );
  if (!found) throw new Error(`Button not found: ${text}`);
  return found as HTMLButtonElement;
}

describe("field-check panel site photo", () => {
  it("shows an inlined site photo without the broken-photo message", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    await renderPanel([check({ findingPhotoUrl: dataUrl })]);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(dataUrl);
    expect(container.textContent).toContain(t.sitePhoto);
    expect(container.textContent).not.toContain("This photo could not be loaded");
  });

  it("says plainly when the site photo's file is not on the server", async () => {
    await renderPanel([
      check({ findingPhotoUrl: null, findingPhotoMissing: true }),
    ]);
    expect(container.textContent).toContain(gone);
    expect(container.textContent).not.toContain("This photo could not be loaded");
    expect(container.querySelector("img")).toBeNull();
    // Approving stays blocked until there is a photo the reviewer can see.
    expect(button(t.approve).disabled).toBe(true);
    expect(button(t.sendBack).disabled).toBe(false);
  });
});
