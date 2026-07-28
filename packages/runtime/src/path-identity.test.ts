import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalFilesystemPath,
  filesystemPathKey,
  filesystemPathsEquivalent,
} from "./path-identity.js";

describe("filesystem path identity", () => {
  it("treats textual variants of the same directory as one scope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-path-identity-"));
    const alias = `${root}-alias`;
    try {
      const dotted = path.join(root, ".");
      expect(canonicalFilesystemPath(dotted)).toBe(path.resolve(root));
      expect(filesystemPathsEquivalent(root, dotted)).toBe(true);
      expect(filesystemPathKey(root)).toBe(filesystemPathKey(dotted));
      await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
      expect(filesystemPathsEquivalent(root, alias)).toBe(true);
      expect(filesystemPathKey(root)).toBe(filesystemPathKey(alias));

      if (process.platform === "win32") {
        const shortPath = execFileSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/c", `for %I in ("${root}") do @echo %~sI`],
          { encoding: "utf8", windowsHide: true },
        ).trim();
        if (existsSync(shortPath)) {
          expect(filesystemPathsEquivalent(root, shortPath)).toBe(true);
          expect(filesystemPathKey(root)).toBe(filesystemPathKey(shortPath));
        }
      }
    } finally {
      await Promise.all([
        rm(alias, { recursive: true, force: true }),
        rm(root, { recursive: true, force: true }),
      ]);
    }
  });
});
