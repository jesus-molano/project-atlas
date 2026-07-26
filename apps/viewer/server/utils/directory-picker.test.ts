import { describe, expect, it, vi } from "vitest";
import {
  normalizeSelectedDirectory,
  selectLocalProjectDirectory,
} from "./directory-picker";

describe("loopback native directory picker", () => {
  it("runs one bounded allowlisted Windows picker and returns its path", async () => {
    const runner = vi.fn(async () => ({
      stdout: "C:\\work\\frontend",
      stderr: "",
    }));
    await expect(selectLocalProjectDirectory("win32", runner)).resolves.toEqual({
      status: "selected",
      absolutePath: "C:\\work\\frontend",
    });
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]?.[1]).toContain("-STA");
    expect(runner.mock.calls[0]?.[2]).toEqual({
      timeoutMs: 300_000,
      maxOutputChars: 2_048,
    });
  });

  it("treats a closed picker as cancellation", async () => {
    await expect(
      selectLocalProjectDirectory("win32", async () => ({
        stdout: "",
        stderr: "",
      })),
    ).resolves.toEqual({ status: "cancelled" });
  });

  it("rejects relative, control-character, and unsupported selections", async () => {
    expect(() => normalizeSelectedDirectory("relative/project")).toThrow(
      "invalid path",
    );
    expect(() => normalizeSelectedDirectory("C:\\bad\u0000path")).toThrow(
      "invalid path",
    );
    await expect(selectLocalProjectDirectory("linux")).rejects.toThrow(
      "currently available on Windows",
    );
  });
});
