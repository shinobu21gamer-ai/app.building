"use client";

import { useEffect, useReducer, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  hasRoleNav,
  routeKeyFor,
  routeSkeletonVariant,
} from "@/lib/loading/route-skeleton";
import { cn } from "@/lib/utils";
import { LoadingPill } from "./loading-pill";
import { PageSkeleton } from "./page-skeleton";

/** Navigations that finish sooner than this show no feedback at all. */
const BAR_DELAY_MS = 80;
/** Navigations slower than this cover the page with a skeleton. */
const OVERLAY_DELAY_MS = 160;
/** Never leave the screen covered if a navigation stalls. */
const SAFETY_TIMEOUT_MS = 15_000;
/** Time for the fade-out to play before the overlay unmounts. */
const HIDE_DELAY_MS = 280;

type Phase = "idle" | "pending" | "done";

type State = {
  phase: Phase;
  /** Route key being navigated to. It picks the skeleton shape. */
  target: string;
  /** Viewport offset that keeps the site header visible above the overlay. */
  top: number;
  barVisible: boolean;
  overlayVisible: boolean;
};

type Action =
  | { type: "start"; target: string; top: number }
  | { type: "showBar" }
  | { type: "showOverlay" }
  | { type: "settle" }
  | { type: "hide" };

const INITIAL_STATE: State = {
  phase: "idle",
  target: "/",
  top: 0,
  barVisible: false,
  overlayVisible: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "start":
      return {
        ...state,
        phase: "pending",
        target: action.target,
        top: action.top,
      };
    case "showBar":
      return state.phase === "pending" && !state.barVisible
        ? { ...state, barVisible: true }
        : state;
    case "showOverlay":
      return state.phase === "pending"
        ? { ...state, barVisible: true, overlayVisible: true }
        : state;
    case "settle":
      // A committed route change, or the safety timeout, ends the wait.
      return state.phase === "pending" ? { ...state, phase: "done" } : state;
    case "hide":
      return state.phase === "done" ? INITIAL_STATE : state;
    default:
      return state;
  }
}

/**
 * Global feedback for in-app navigation. It starts when a client-side link is
 * clicked (or history is traversed) and ends when the route commits:
 *
 *   - a thin indeterminate bar appears at the top of the viewport, and
 *   - for slower navigations, a route-shaped skeleton covers the content
 *     below the header, with a "Loading" status pill.
 *
 * It never calls preventDefault and never suspends rendering, so routing and
 * notFound() behaviour are unchanged.
 */
export function NavigationProgress({ label }: { label: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = routeKeyFor(pathname, searchParams.toString());
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  // The route currently on screen, read by the click and popstate listeners.
  const committedKey = useRef(routeKey);

  // A committed route change is what ends a pending navigation.
  useEffect(() => {
    committedKey.current = routeKey;
    dispatch({ type: "settle" });
  }, [routeKey]);

  useEffect(() => {
    if (state.phase !== "pending") return;
    const barTimer = window.setTimeout(
      () => dispatch({ type: "showBar" }),
      BAR_DELAY_MS
    );
    const overlayTimer = window.setTimeout(
      () => dispatch({ type: "showOverlay" }),
      OVERLAY_DELAY_MS
    );
    const safetyTimer = window.setTimeout(
      () => dispatch({ type: "settle" }),
      SAFETY_TIMEOUT_MS
    );
    return () => {
      window.clearTimeout(barTimer);
      window.clearTimeout(overlayTimer);
      window.clearTimeout(safetyTimer);
    };
  }, [state.phase]);

  useEffect(() => {
    if (state.phase !== "done") return;
    const hideTimer = window.setTimeout(
      () => dispatch({ type: "hide" }),
      HIDE_DELAY_MS
    );
    return () => window.clearTimeout(hideTimer);
  }, [state.phase]);

  useEffect(() => {
    function begin(target: string) {
      if (target === committedKey.current) {
        // Going back to the page already on screen supersedes any navigation
        // still in flight, and that navigation will never commit.
        dispatch({ type: "settle" });
        return;
      }
      const header = document.getElementById("site-header");
      const top = Math.max(
        0,
        Math.round(header?.getBoundingClientRect().bottom ?? 0)
      );
      dispatch({ type: "start", target, top });
    }

    function handleClick(event: MouseEvent) {
      // <Link/> calls preventDefault() only for client-side navigations, and
      // this listener runs after React's handlers. Clicks that were not handled
      // by the router (downloads, /api routes, external links) are ignored.
      if (!event.defaultPrevented) return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin) return;
      begin(routeKeyFor(url.pathname, url.search));
    }

    function handlePopState() {
      begin(routeKeyFor(window.location.pathname, window.location.search));
    }

    window.addEventListener("click", handleClick);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const { phase, target, top, barVisible, overlayVisible } = state;

  return (
    <>
      {barVisible ? (
        <div
          aria-hidden="true"
          className={cn(
            "no-print pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden transition-opacity duration-200",
            phase === "done" && "opacity-0"
          )}
        >
          <div className="nav-bar-sweep" />
        </div>
      ) : null}
      {overlayVisible ? (
        <div
          style={{ top }}
          className={cn(
            "no-print fixed inset-x-0 bottom-0 z-40 overflow-y-auto overscroll-contain bg-white",
            phase === "done" ? "animate-fade-out" : "animate-fade-in"
          )}
        >
          <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center px-4">
            <LoadingPill label={label} />
          </div>
          <div className="pt-16">
            <PageSkeleton
              variant={routeSkeletonVariant(target)}
              withNav={hasRoleNav(target)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

