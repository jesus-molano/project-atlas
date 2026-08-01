import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {
  END_MARKER,
  removeAgentsInstructions,
  START_MARKER,
} from "./remove-agents-instructions.mjs";

const helper = path.join(import.meta.dirname, "remove-agents-instructions.mjs");

async function withTemporaryDirectory(run) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "project-atlas agents migration with spaces "),
  );
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function markedBlock(newline = "\n") {
  return [START_MARKER, "obsolete Atlas routing", END_MARKER, ""].join(
    newline,
  );
}

async function pathExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

test("removes only the marked block and preserves a neighboring backup", async () => {
  await withTemporaryDirectory(async (root) => {
    const target = path.join(root, "Codex Home With Spaces", "AGENTS personal.md");
    await mkdir(path.dirname(target), { recursive: true });
    const original = `before\r\n${markedBlock("\r\n")}after\r\n`;
    await writeFile(target, original, "utf8");

    const result = await removeAgentsInstructions({
      targetPath: target,
      writeLine: () => undefined,
    });

    assert.equal(result.status, "removed");
    assert.equal(await readFile(target, "utf8"), "before\r\nafter\r\n");
    assert.equal(result.backupPath, `${target}.project-atlas.bak`);
    assert.equal(await readFile(result.backupPath, "utf8"), original);
  });
});

test("uses a numbered backup and is idempotent after migration", async () => {
  await withTemporaryDirectory(async (root) => {
    const target = path.join(root, "AGENTS.md");
    const firstBackup = `${target}.project-atlas.bak`;
    await writeFile(target, markedBlock(), "utf8");
    await writeFile(firstBackup, "pre-existing backup", "utf8");

    const first = await removeAgentsInstructions({
      targetPath: target,
      writeLine: () => undefined,
    });
    const migrated = await readFile(target, "utf8");
    const second = await removeAgentsInstructions({
      targetPath: target,
      writeLine: () => undefined,
    });

    assert.equal(first.backupPath, `${firstBackup}.1`);
    assert.equal(await readFile(firstBackup, "utf8"), "pre-existing backup");
    assert.equal(await readFile(first.backupPath, "utf8"), markedBlock());
    assert.equal(second.status, "unchanged");
    assert.equal(await readFile(target, "utf8"), migrated);
    assert.deepEqual(
      (await readdir(root)).sort(),
      ["AGENTS.md", "AGENTS.md.project-atlas.bak", "AGENTS.md.project-atlas.bak.1"],
    );
  });
});

test("dry-run through the CLI makes no changes on a path with spaces", async () => {
  await withTemporaryDirectory(async (root) => {
    const target = path.join(root, "Personal Codex", "AGENTS file.md");
    await mkdir(path.dirname(target), { recursive: true });
    const original = `keep\n${markedBlock()}tail\n`;
    await writeFile(target, original, "utf8");

    const result = spawnSync(
      process.execPath,
      [helper, "--target", target, "--dry-run"],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DRY RUN: remove legacy Atlas routing block/);
    assert.equal(await readFile(target, "utf8"), original);
    assert.equal(await pathExists(`${target}.project-atlas.bak`), false);
  });
});

test("missing targets and files without markers are no-ops", async () => {
  await withTemporaryDirectory(async (root) => {
    const missing = path.join(root, "missing", "AGENTS.md");
    const missingResult = await removeAgentsInstructions({
      targetPath: missing,
      writeLine: () => undefined,
    });
    assert.equal(missingResult.status, "missing");
    assert.equal(await pathExists(path.dirname(missing)), false);

    const target = path.join(root, "AGENTS.md");
    await writeFile(target, "personal instructions\n", "utf8");
    const unchangedResult = await removeAgentsInstructions({
      targetPath: target,
      writeLine: () => undefined,
    });
    assert.equal(unchangedResult.status, "unchanged");
    assert.equal(await readFile(target, "utf8"), "personal instructions\n");
    assert.equal(await pathExists(`${target}.project-atlas.bak`), false);
  });
});

test("rejects missing, unmatched, and reversed markers without writing", async () => {
  await withTemporaryDirectory(async (root) => {
    const cases = [
      `before\n${START_MARKER}\nunterminated\n`,
      `before\n${END_MARKER}\n`,
      `${END_MARKER}\ntext\n${START_MARKER}\n`,
    ];
    for (const [index, source] of cases.entries()) {
      const target = path.join(root, `malformed-${index}.md`);
      await writeFile(target, source, "utf8");
      await assert.rejects(
        removeAgentsInstructions({
          targetPath: target,
          writeLine: () => undefined,
        }),
        /markers are malformed or duplicated/,
      );
      assert.equal(await readFile(target, "utf8"), source);
      assert.equal(await pathExists(`${target}.project-atlas.bak`), false);
    }
  });
});

test("rejects duplicated blocks without writing", async () => {
  await withTemporaryDirectory(async (root) => {
    const target = path.join(root, "AGENTS.md");
    const source = `${markedBlock()}middle\n${markedBlock()}`;
    await writeFile(target, source, "utf8");

    await assert.rejects(
      removeAgentsInstructions({
        targetPath: target,
        writeLine: () => undefined,
      }),
      /markers are malformed or duplicated/,
    );
    assert.equal(await readFile(target, "utf8"), source);
    assert.equal(await pathExists(`${target}.project-atlas.bak`), false);
  });
});
