import { describe, expect, it } from "vitest";
import { runBoundedProcess } from "./bounded-process.js";

describe("bounded viewer processes", () => {
  it("captures a successful bounded child process", async () => {
    const result = await runBoundedProcess(process.execPath, [
      "-e",
      "process.stdout.write('ok')",
    ]);
    expect(result).toEqual({ stdout: "ok", stderr: "" });
  });

  it("terminates child processes that exceed time or output limits", async () => {
    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 100 },
      ),
    ).rejects.toThrow(/100ms timeout/);

    await expect(
      runBoundedProcess(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(5000))"],
        { maxOutputChars: 100 },
      ),
    ).rejects.toThrow(/100-character output limit/);
  });

  it("propagates request cancellation to the child process", async () => {
    const controller = new AbortController();
    const result = runBoundedProcess(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { signal: controller.signal },
    );
    controller.abort();
    await expect(result).rejects.toThrow(/cancelled/);
  });
});
