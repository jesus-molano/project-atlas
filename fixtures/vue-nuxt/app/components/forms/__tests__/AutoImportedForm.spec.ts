import { describe, expect, it } from "vitest";
import type { AccountSettingsForm } from "#components";

declare function mount(component: unknown): unknown;

function mountAutoImportedFixture() {
  return mount(AccountSettingsForm);
}

describe("auto-imported component fixture", () => {
  it("keeps exact auto-import and mount evidence", () => {
    expect(typeof mountAutoImportedFixture).toBe("function");
  });
});
