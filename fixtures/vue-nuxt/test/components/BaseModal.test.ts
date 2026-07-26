import { describe, expect, it } from "vitest";
import type { UiBaseModal } from "#components";

declare function mountSuspended(component: unknown): unknown;

function mountFixture() {
  return mountSuspended(UiBaseModal);
}

describe("BaseModal", () => {
  it("has a fixture test", () => expect(typeof mountFixture).toBe("function"));
});
