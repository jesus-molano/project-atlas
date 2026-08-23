import { describe, expect, it } from "vitest";
import { normalizeLockedEvidenceHandles } from "./change-surface-lock.js";

describe("normalizeLockedEvidenceHandles", () => {
  it("keeps durable acceptance and Figma handles in the locked evidence set", () => {
    expect(
      normalizeLockedEvidenceHandles([
        "code:vue:apps/viewer/app/pages/index.vue#default",
        "contract:task-atlas-evidence:0123456789abcdef",
        "continuation:task-atlas-evidence:fedcba9876543210",
        "figma-snapshot:task-atlas-evidence:0011223344556677",
        "visual-review:task-atlas-evidence:8899aabbccddeeff",
      ]),
    ).toEqual([
      "code:vue:apps/viewer/app/pages/index.vue#default",
      "continuation:task-atlas-evidence:fedcba9876543210",
      "contract:task-atlas-evidence:0123456789abcdef",
      "figma-snapshot:task-atlas-evidence:0011223344556677",
      "visual-review:task-atlas-evidence:8899aabbccddeeff",
    ]);
  });
});
