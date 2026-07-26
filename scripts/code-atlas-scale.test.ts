import { describe, expect, it } from "vitest";
import {
  CODE_ATLAS_PAGE_SIZE,
  codeAtlasPageCount,
  codeAtlasPageForIndex,
  codeAtlasPageSlice,
} from "../apps/viewer/app/utils/code-atlas";

describe("Code Atlas large catalog navigation", () => {
  it("keeps hundreds of components bounded and makes edge selections addressable", () => {
    const components = Array.from({ length: 487 }, (_, index) => ({
      id: `component-${index}`,
    }));
    expect(CODE_ATLAS_PAGE_SIZE).toBe(80);
    expect(codeAtlasPageCount(components.length)).toBe(7);

    for (const index of [0, 243, 486]) {
      const page = codeAtlasPageForIndex(index);
      const visible = codeAtlasPageSlice(components, page);
      expect(visible).toHaveLength(
        index === 486 ? 7 : CODE_ATLAS_PAGE_SIZE,
      );
      expect(visible.some((component) => component.id === `component-${index}`)).toBe(
        true,
      );
    }
  });

  it("clamps invalid pages without returning an unbounded catalog", () => {
    const components = Array.from({ length: 240 }, (_, index) => index);
    expect(codeAtlasPageSlice(components, -20)).toEqual(
      components.slice(0, CODE_ATLAS_PAGE_SIZE),
    );
    expect(codeAtlasPageSlice(components, 99)).toEqual(
      components.slice(160, 240),
    );
  });
});
