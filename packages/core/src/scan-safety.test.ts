import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ScanSafetyError,
  createScanSafetySession,
  readSafeScanText,
  safeScanFiles,
} from "./scan-safety.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-scan-safety-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("scan safety", () => {
  it("orders regular files deterministically and reads them", async () => {
    const root = await fixture();
    const first = path.join(root, "a.ts");
    const second = path.join(root, "b.ts");
    await Promise.all([writeFile(first, "one"), writeFile(second, "two")]);

    expect(await safeScanFiles(root, [second, first])).toEqual([first, second]);
    await expect(readSafeScanText(root, first)).resolves.toBe("one");
  });

  it("rejects symlinks, path escapes, and declared byte budgets", async () => {
    const root = await fixture();
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-scan-outside-"));
    roots.push(outsideRoot);
    const outside = path.join(outsideRoot, "outside.ts");
    const link = path.join(root, "linked.ts");
    await writeFile(outside, "outside");
    await symlink(outside, link);
    await writeFile(path.join(root, "large.ts"), "12345");
    await writeFile(path.join(root, "small.ts"), "123");

    await expect(safeScanFiles(root, [link])).rejects.toBeInstanceOf(ScanSafetyError);
    await expect(safeScanFiles(root, [outside])).rejects.toBeInstanceOf(ScanSafetyError);
    await expect(
      safeScanFiles(root, [path.join(root, "large.ts")], { maxFileBytes: 4 }),
    ).rejects.toThrow("file limit");
    await expect(
      safeScanFiles(
        root,
        [path.join(root, "large.ts"), path.join(root, "small.ts")],
        { maxTotalBytes: 7 },
      ),
    ).rejects.toThrow("total limit");
  });

  it("charges bytes at read time when a discovered file grows", async () => {
    const root = await fixture();
    const source = path.join(root, "source.ts");
    await writeFile(source, "1234");
    const session = await createScanSafetySession(root, {
      maxFileBytes: 8,
      maxTotalBytes: 6,
    });

    await session.files([source]);
    await writeFile(source, "1234567");

    await expect(session.readText(source)).rejects.toThrow("total limit");
    expect(session.bytesRead).toBe(6);
  });

  it("shares file and byte limits across discovered and auxiliary reads", async () => {
    const root = await fixture();
    const primary = path.join(root, "primary.ts");
    const imported = path.join(root, "imported.ts");
    const testFile = path.join(root, "primary.test.ts");
    await Promise.all([
      writeFile(primary, "1234"),
      writeFile(imported, "5678"),
      writeFile(testFile, "test"),
    ]);
    const bytes = await createScanSafetySession(root, { maxTotalBytes: 7 });
    await bytes.files([primary]);
    await bytes.readText(primary);
    await expect(bytes.readText(imported)).rejects.toThrow("total limit");

    const files = await createScanSafetySession(root, { maxFiles: 2 });
    await files.files([primary]);
    await files.readText(primary);
    await files.readText(imported);
    await expect(files.readText(testFile)).rejects.toThrow("file limit");
  });
});
