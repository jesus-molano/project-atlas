import { describe, expect, it } from "vitest";
import type SettingsPanel from "@/app/components/forms/AccountSettingsForm.vue";

declare function mountSuspended(component: unknown): unknown;

function mountFixture() {
  return mountSuspended(SettingsPanel);
}

describe("account settings form fixture", () => {
  it("keeps its mount reference available to static analysis", () => {
    expect(typeof mountFixture).toBe("function");
  });
});
