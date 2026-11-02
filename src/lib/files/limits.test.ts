import { describe, expect, it } from "vitest";
import { getFileExtension, isFileTooLarge, supportsPreview } from "./limits";
import { canAddToCategory, getCategoryFromExtension, getCompletenessStatus } from "./completeness";

describe("getFileExtension", () => {
  it("returns the lowercased extension", () => {
    expect(getFileExtension("Benchy.STL")).toBe("stl");
  });

  it("returns the last extension for names with multiple dots", () => {
    expect(getFileExtension("part.v2.3mf")).toBe("3mf");
  });

  it("returns empty string when name is undefined (drag-over items)", () => {
    expect(getFileExtension(undefined)).toBe("");
  });

  it("returns empty string for an empty name", () => {
    expect(getFileExtension("")).toBe("");
  });
});

describe("native CAD part storage", () => {
  it("accepts uppercase SLDPRT as a model source with a generated browser preview", () => {
    const extension = getFileExtension("camera body.SLDPRT");
    expect(getCategoryFromExtension(extension)).toBe("model");
    expect(supportsPreview(extension)).toBe(true);
    expect(getCompletenessStatus([{ extension, createdAt: new Date() }]).hasModel).toBe(true);
    expect(canAddToCategory([{ extension, createdAt: new Date() }], "model").allowed).toBe(true);
  });

  it("allows a native part at the size limit and rejects one over it", () => {
    expect(isFileTooLarge("camera body.SLDPRT", 100 * 1024 * 1024)).toBe(false);
    expect(isFileTooLarge("camera body.SLDPRT", 100 * 1024 * 1024 + 1)).toBe(true);
  });
});
