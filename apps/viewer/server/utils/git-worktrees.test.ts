import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { filesystemPathsEquivalent } from "@component-atlas/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { projectRepositoryStateForRoot } from "./git-worktrees";

const temporaryRoots: string[] = [];

function run(rootPath: string, args: string[]): string {
  return execFileSync("git", ["-C", rootPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

async function fixtureRepository(): Promise<{
  rootPath: string;
  releasePath: string;
}> {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "atlas-worktrees-"),
  );
  temporaryRoots.push(temporaryRoot);
  const rootPath = path.join(temporaryRoot, "very-long-project-name");
  const releasePath = path.join(temporaryRoot, "release-checkout");
  await mkdir(rootPath);
  run(rootPath, ["init", "-b", "main"]);
  run(rootPath, ["config", "user.name", "Project Atlas Tests"]);
  run(rootPath, ["config", "user.email", "atlas@example.test"]);
  await writeFile(
    path.join(rootPath, "package.json"),
    "{\"name\":\"worktree-fixture\",\"private\":true}\n",
    "utf8",
  );
  await writeFile(path.join(rootPath, "README.md"), "main\n", "utf8");
  run(rootPath, ["add", "."]);
  run(rootPath, ["commit", "-m", "fixture"]);
  run(rootPath, ["branch", "feature/a-very-long-local-branch-name"]);
  run(rootPath, ["branch", "release"]);
  run(rootPath, ["worktree", "add", releasePath, "release"]);
  await writeFile(path.join(releasePath, "README.md"), "release dirty\n", "utf8");
  return { rootPath, releasePath };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) =>
      rm(rootPath, { recursive: true, force: true }),
    ),
  );
});

describe("Git branch and worktree inventory", () => {
  it("lists every local branch and associates existing worktrees", async () => {
    const { rootPath, releasePath } = await fixtureRepository();
    const repository = projectRepositoryStateForRoot(rootPath);

    expect(repository?.branches.map((branch) => branch.name)).toEqual([
      "main",
      "release",
      "feature/a-very-long-local-branch-name",
    ]);
    expect(repository?.branches[0]).toMatchObject({
      name: "main",
      isCurrent: true,
      hasProjectManifest: true,
    });
    const releaseWorktree = repository?.branches[1]?.worktree;
    expect(releaseWorktree).toMatchObject({
      branch: "release",
      isCurrent: false,
      available: true,
      git: {
        dirty: true,
        changedFiles: 1,
      },
    });
    expect(releaseWorktree?.path).toBeDefined();
    expect(filesystemPathsEquivalent(releaseWorktree!.path, releasePath)).toBe(
      true,
    );
    expect(repository?.branches[2]).toMatchObject({
      hasProjectManifest: true,
    });
    expect(repository?.branches[2]?.worktree).toBeUndefined();
  }, 15_000);
});
