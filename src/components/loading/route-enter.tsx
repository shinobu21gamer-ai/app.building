"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Replays the page-enter animation whenever the pathname changes.
 *
 * The wrapper is never remounted: Next.js keeps its router state and focus
 * handling attached to the DOM it rendered, so swapping the element out would
 * fight the router. Restarting the CSS animation with a forced reflow keeps the
 * same node. Filter changes keep the same pathname and so do not replay it.
 */
export function RouteEnter({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const hasMounted = useRef(false);

  useLayoutEffect(() => {
    // The first render already animates from the server-rendered class.
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    const element = ref.current;
    if (!element) return;
    element.classList.remove("route-enter");
    void element.offsetWidth;
    element.classList.add("route-enter");
  }, [pathname]);

  return (
    <div ref={ref} className="route-enter">
      {children}
    </div>
  );
}
