import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadedPhoto } from "./uploaded-photo";

const src = "/api/v1/uploads/12345678-1234-1234-1234-123456789abc.png";

describe("uploaded photo presentation", () => {
  it("does not send private photos through the unauthenticated optimizer", () => {
    const html = renderToStaticMarkup(createElement(UploadedPhoto, { src, alt: "Case proof" }));
    expect(html).not.toContain("/_next/image");
    expect(html).toContain("Loading photo");
  });
  it("provides a full-size dialog and bounded scroll regions without cropping", () => {
    const html = renderToStaticMarkup(createElement(UploadedPhoto, { src, alt: "Case proof" }));
    const component = readFileSync(join(process.cwd(), "src/components/ui/uploaded-photo.tsx"), "utf8");
    // The scroll region and image are intentionally rendered only after the
    // authenticated image has loaded and the dialog opens, so SSR only contains
    // the closed dialog shell.
    expect(component).toContain("max-h-[70dvh] overflow-auto");
    expect(html).toContain("max-h-80");
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-label="Close photo"');
    expect(html).not.toContain("object-cover");
  });
  it("translates the controls for Filipino readers", () => {
    const html = renderToStaticMarkup(
      createElement(UploadedPhoto, { src, alt: "Patunay", locale: "fil" })
    );
    expect(html).toContain("Nilo-load ang larawan");
    expect(html).toContain("Isara ang larawan");
  });
});
