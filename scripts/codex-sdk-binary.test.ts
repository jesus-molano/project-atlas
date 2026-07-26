import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveBundledCodexBinary } from "../packages/cli/src/index.js";

describe("Codex SDK transport", () => {
  it("resolves the installed native CLI without using the desktop app executable", async () => {
    const repositoryRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    const binary = await resolveBundledCodexBinary(repositoryRoot);
    expect(binary).toBeTruthy();
    await expect(access(binary!)).resolves.toBeUndefined();
    expect(path.basename(binary!).toLowerCase()).toMatch(/^codex(?:\.exe)?$/);
    expect(binary!.toLowerCase()).toContain(`${path.sep}node_modules${path.sep}.pnpm`);
  });
});
