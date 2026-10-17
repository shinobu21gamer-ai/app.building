// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FieldCheckDesk, type FieldCheckDeskItem } from "./field-check-desk";
import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/lib/i18n";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const t = copy.en.admin.fieldCheck;
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

function item(overrides: Partial<FieldCheckDeskItem>): FieldCheckDeskItem {
  return {
    id: 7,
    residentReplies: [],
    status: "SUBMITTED",
    instructions: "Check the street light near the chapel.",
    finding: "CONFIRMED",
    findingNotes: "The light is really there.",
    findingPhotoUrl: null,
    reviewNote: null,
    createdAt: "2026-10-17T00:00:00.000Z",
    caseId: 42,
    caseNumber: "BR-2026-0042",
    caseTitle: "Broken street light",
    caseStatus: "SUBMITTED",
    officeName: "Engineering",
    locationAddress: "123 Rizal St",
    locationPurok: "Purok 1",
    mapUrl: null,
    assigneeName: "Jose Santos",
    requestedByName: "Admin Ana",
    ...overrides,
  };
}

async function renderDesk(toReview: FieldCheckDeskItem[]) {
  await act(async () =>
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(FieldCheckDesk, {
          toReview,
          waiting: [],
          decided: [],
          cases: [],
          staff: [],
          locale: "en",
        })
      )
    )
  );
  // Let the photo viewer's effect settle.
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

describe("admin field-check desk site photo", () => {
  it("shows an inlined site photo without the broken-photo message", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    await renderDesk([item({ findingPhotoUrl: dataUrl })]);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(dataUrl);
    expect(container.textContent).toContain(t.photo);
    expect(container.textContent).not.toContain("This photo could not be loaded");
  });

  it("says plainly when the site photo's file is not on the server", async () => {
    await renderDesk([
      item({ findingPhotoUrl: null, findingPhotoMissing: true }),
    ]);
    expect(container.textContent).toContain(gone);
    expect(container.textContent).not.toContain("This photo could not be loaded");
    expect(container.querySelector("img")).toBeNull();
    // A finding the reviewer cannot see must not be approved blind; sending
    // it back for another check stays available.
    expect(button(t.approve).disabled).toBe(true);
    expect(button(t.sendBack).disabled).toBe(false);
  });
});
