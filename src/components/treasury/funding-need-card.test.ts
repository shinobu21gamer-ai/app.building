import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `Card`'s action button is a `next/link`; outside the router there is no
// context for it, and the link is not what this test is about.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement("a", { href }, children),
}));

import { FundingNeedCard } from "./funding-need-card";
import { copy } from "@/lib/i18n";
import type { TreasuryDashboard } from "@/lib/treasury/query";

const t = copy.en.revamp.treasuryDesk;

function funding(
  overrides: Partial<TreasuryDashboard["funding"]> = {}
): TreasuryDashboard["funding"] {
  return {
    summary: {
      // 25,000 already with the Captain + 18,500 still to propose.
      cases: 3,
      need: 43_500,
      pending: 25_000,
      toPropose: 18_500,
      unestimated: 1,
    },
    needs: [
      {
        concernId: 3,
        caseNumber: "BR-20261009-0003",
        title: "Collapsed drainage on Purok 2",
        officeName: null,
        state: "PROPOSED_PENDING",
        estimate: 25_000,
        setAside: 0,
        pending: 25_000,
        need: 25_000,
        toPropose: 0,
        awaitingBudgetAt: new Date(2026, 9, 9),
        submittedAt: new Date(2026, 9, 9),
      },
      {
        concernId: 1,
        caseNumber: "BR-20261008-0001",
        title: "Deep potholes on Purok 3 main road",
        officeName: "Works and Infrastructure",
        state: "NEEDS_MONEY",
        estimate: 18_500,
        setAside: 0,
        pending: 0,
        need: 18_500,
        toPropose: 18_500,
        awaitingBudgetAt: new Date(2026, 9, 10),
        submittedAt: new Date(2026, 9, 8),
      },
    ],
    ...overrides,
  };
}

function render(data: TreasuryDashboard["funding"]): string {
  return renderToStaticMarkup(
    createElement(FundingNeedCard, { funding: data })
  );
}

describe("FundingNeedCard", () => {
  it("states the total the cases need before anything else", () => {
    const html = render(funding());

    expect(html).toContain(t.fundingNeedTitle);
    // The headline figure: what finding the money costs.
    expect(html).toContain("₱43,500.00");
    expect(html).toContain("3 case(s) are waiting on this money");
  });

  it("splits the need into what is proposed and what still is not", () => {
    const html = render(funding());

    expect(html).toContain("₱18,500.00 still to propose");
    expect(html).toContain("₱25,000.00 already with the Captain");
  });

  it("names the amount each case needs", () => {
    const html = render(funding());

    expect(html).toContain("BR-20261009-0003");
    expect(html).toContain("BR-20261008-0001");
    expect(html).toContain("₱25,000.00");
    // The case with no office still reads properly.
    expect(html).toContain("No office yet");
    expect(html).toContain("Works and Infrastructure");
    // …and says which part is already on the Captain's desk.
    expect(html).toContain("₱25,000.00 of it is with the Captain");
  });

  it("says how many cases the list leaves out", () => {
    const html = render(funding());

    // 3 cases in the queue, 2 listed.
    expect(html).toContain("1 more case(s) on the funding desk");
  });

  it("flags the cases whose cost nobody has worked out yet", () => {
    const html = render(funding());

    expect(html).toContain(
      "1 case(s) in Awaiting budget have no cost estimate yet"
    );
  });

  it("reads an empty queue as nothing waiting, not as a missing figure", () => {
    const html = render(
      funding({
        summary: {
          cases: 0,
          need: 0,
          pending: 0,
          toPropose: 0,
          unestimated: 0,
        },
        needs: [],
      })
    );

    expect(html).toContain(t.fundingNeedNone);
    expect(html).not.toContain("₱0.00");
  });

  it("gives the same figures in Filipino", () => {
    const html = renderToStaticMarkup(
      createElement(FundingNeedCard, { funding: funding(), locale: "fil" })
    );
    const fil = copy.fil.revamp.treasuryDesk;

    expect(html).toContain(fil.fundingNeedTitle);
    expect(html).toContain("₱43,500.00");
    expect(html).toContain(fil.fundingNeedPendingPart.replace("{amount}", "₱25,000.00"));
  });
});
