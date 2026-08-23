import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureGitBaseline,
  captureGitDelta,
  compareGitDelta,
} from "./git-delta.js";

const run = promisify(execFile);
const roots: string[] = [];
let previousDataHome: string | undefined;

async function put(root: string, relative: string, source: string): Promise<void> {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source, "utf8");
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-git-delta-"));
  roots.push(root);
  await put(root, "src/App.tsx", "export const App = () => <main>Initial</main>;\n");
  await put(root, "src/Old.tsx", "export const Old = () => <aside>Old</aside>;\n");
  await run("git", ["init"], { cwd: root, windowsHide: true });
  await run("git", ["add", "."], { cwd: root, windowsHide: true });
  await run(
    "git",
    [
      "-c",
      "user.name=Atlas Test",
      "-c",
      "user.email=atlas@example.invalid",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: root, windowsHide: true },
  );
  return root;
}

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-git-state-"));
  roots.push(dataHome);
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Git task baselines and complete deltas", () => {
  it("captures staged-only changes after a clean baseline", async () => {
    const root = await fixture();
    const baseline = await captureGitBaseline(root, { taskId: "task-staged" });
    await put(root, "src/App.tsx", "export const App = () => <main>Staged</main>;\n");
    await run("git", ["add", "src/App.tsx"], { cwd: root, windowsHide: true });

    const direct = await captureGitDelta(root);
    const delta = await compareGitDelta(root, baseline);

    expect(direct.entries).toEqual([
      expect.objectContaining({ path: "src/App.tsx", staged: true }),
    ]);
    expect(delta).toMatchObject({ files: 1, additions: 1, deletions: 1 });
    expect(delta.entries[0]).toMatchObject({
      path: "src/App.tsx",
      status: "modified",
      staged: true,
      unstaged: false,
    });
    expect(delta.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "addition", text: expect.stringContaining("Staged") }),
      ]),
    );
  });

  it("does not collapse divergent index and working-tree layers", async () => {
    const root = await fixture();
    const baseline = await captureGitBaseline(root, {
      taskId: "task-divergent-index",
    });
    const initial = "export const App = () => <main>Initial</main>;\n";
    await put(root, "src/App.tsx", "export const App = () => <main>Staged</main>;\n");
    await run("git", ["add", "src/App.tsx"], { cwd: root, windowsHide: true });
    await put(root, "src/App.tsx", initial);

    const delta = await compareGitDelta(root, baseline);

    expect(delta.entries).toEqual([
      expect.objectContaining({
        path: "src/App.tsx",
        staged: true,
        unstaged: true,
      }),
    ]);
    expect(delta.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "addition",
          text: expect.stringContaining("Staged"),
        }),
      ]),
    );
  });

  it("reports tracked deletions and exact renames", async () => {
    const deletedRoot = await fixture();
    const deletedBaseline = await captureGitBaseline(deletedRoot, {
      taskId: "task-delete",
    });
    await rm(path.join(deletedRoot, "src/Old.tsx"));
    const deletion = await compareGitDelta(deletedRoot, deletedBaseline);
    expect(deletion.entries).toEqual([
      expect.objectContaining({ path: "src/Old.tsx", status: "deleted" }),
    ]);
    expect(deletion.deletions).toBeGreaterThan(0);

    const renamedRoot = await fixture();
    const renamedBaseline = await captureGitBaseline(renamedRoot, {
      taskId: "task-rename",
    });
    await run("git", ["mv", "src/Old.tsx", "src/New.tsx"], {
      cwd: renamedRoot,
      windowsHide: true,
    });
    const rename = await compareGitDelta(renamedRoot, renamedBaseline);
    expect(rename.renames).toBe(1);
    expect(rename.entries).toEqual([
      expect.objectContaining({
        path: "src/New.tsx",
        previousPath: "src/Old.tsx",
        status: "renamed",
      }),
    ]);
  });

  it("subtracts dirty baseline content and tracks later untracked edits", async () => {
    const root = await fixture();
    await put(
      root,
      "src/App.tsx",
      "export const App = () => <main>Initial</main>;\n// before-lock\n",
    );
    await put(root, "src/Draft.tsx", "export const Draft = 1;\n");
    const baseline = await captureGitBaseline(root, { taskId: "task-dirty" });
    expect((await compareGitDelta(root, baseline)).files).toBe(0);

    await put(
      root,
      "src/App.tsx",
      "export const App = () => <main>Initial</main>;\n// before-lock\n// after-lock\n",
    );
    await put(root, "src/Draft.tsx", "export const Draft = 2;\n");
    const delta = await compareGitDelta(root, baseline);

    expect(delta.entries.map((entry) => entry.path)).toEqual([
      "src/App.tsx",
      "src/Draft.tsx",
    ]);
    const additions = delta.lines
      .filter((line) => line.kind === "addition")
      .map((line) => line.text)
      .filter(Boolean);
    expect(additions).toContain("// after-lock");
    expect(additions).not.toContain("// before-lock");
    expect(additions).toContain("export const Draft = 2;");
  });

  it("ignores preexisting untracked files that disappear after the baseline", async () => {
    const root = await fixture();
    await put(root, "pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    await put(root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n");
    const baseline = await captureGitBaseline(root, {
      taskId: "task-untracked-removed",
    });

    await rm(path.join(root, "pnpm-lock.yaml"));
    await rm(path.join(root, "pnpm-workspace.yaml"));
    const delta = await compareGitDelta(root, baseline);

    expect(delta).toMatchObject({ files: 0, additions: 0, deletions: 0 });
    expect(delta.entries).toEqual([]);
    expect(delta.lines).toEqual([]);
  });

  it("signals file and line truncation instead of silently claiming completeness", async () => {
    const root = await fixture();
    await put(root, "src/App.tsx", "one\ntwo\nthree\n");
    await put(root, "src/Old.tsx", "four\nfive\nsix\n");

    const delta = await captureGitDelta(root, { maxFiles: 1, maxLines: 1 });
    const baseline = await captureGitBaseline(root, {
      taskId: "task-truncated",
      limits: { maxFiles: 1, maxLines: 1 },
    });

    expect(delta.truncated).toBe(true);
    expect(delta.truncationReasons).toEqual(
      expect.arrayContaining(["file-limit", "line-limit"]),
    );
    expect(baseline.truncated).toBe(true);
    expect(await readFile(path.join(root, "src/App.tsx"), "utf8")).toContain("three");
  });

  it("bounds worktree hashing instead of reading an arbitrarily large changed file", async () => {
    const root = await fixture();
    await put(root, "src/App.tsx", "x".repeat(2_048));

    const delta = await captureGitDelta(root, { maxFileHashBytes: 1_024 });

    expect(delta.truncated).toBe(true);
    expect(delta.truncationReasons).toContain("file-hash-size");
  });

  it("rejects a baseline when the same project task is opened from another worktree", async () => {
    const root = await fixture();
    const sibling = `${root}-sibling`;
    roots.push(sibling);
    await run(
      "git",
      ["worktree", "add", "-b", `baseline-${Date.now()}`, sibling],
      { cwd: root, windowsHide: true },
    );
    const baseline = await captureGitBaseline(root, {
      taskId: "task-checkout-bound",
    });

    await expect(compareGitDelta(sibling, baseline)).rejects.toThrow(/checkout/i);
  });
});
