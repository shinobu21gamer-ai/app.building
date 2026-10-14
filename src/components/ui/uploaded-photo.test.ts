import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadedPhoto } from "./uploaded-photo";

const src = "/api/v1/uploads/12345678-1234-1234-1234-123456789abc.png";

describe("uploaded photo presentation", () => {
  it("loads the private image directly, not through the unauthenticated optimizer", () => {
    const html = renderToStaticMarkup(createElement(UploadedPhoto, { src, alt: "Case proof" }));
    expect(html).toContain(`src="${src}"`);
    expect(html).not.toContain("/_next/image");
    expect(html).toContain('alt="Case proof"');
  });
  it("provides a full-size dialog and bounded scroll regions without cropping", () => {
    const html = renderToStaticMarkup(createElement(UploadedPhoto, { src, alt: "Case proof" }));
    expect(html).toContain("View full photo");
    expect(html).toContain("overflow-auto");
    expect(html).toContain("max-h-80");
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-label="Close photo"');
    expect(html).not.toContain("object-cover");
  });
  it("translates the controls for Filipino readers", () => {
    const html = renderToStaticMarkup(createElement(UploadedPhoto, { src, alt: "Patunay", locale: "fil" }));
    expect(html).toContain("Tingnan ang buong larawan");
    expect(html).toContain("Isara ang larawan");
  });
});
