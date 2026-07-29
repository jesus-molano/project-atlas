import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNewProjectBranchWorktree,
  createProjectWorktree,
  previewNewProjectBranchWorktree,
  previewProjectWorktree,
  projectRepositoryStateForRoot,
} from "./git-worktrees";

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
    '{"name":"worktree-fixture","private":true}\n',
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
    expect(repository?.branches[1]?.worktree).toMatchObject({
      path: releasePath,
      branch: "release",
      isCurrent: false,
      available: true,
      git: {
        dirty: true,
        changedFiles: 1,
      },
    });
    expect(repository?.branches[2]).toMatchObject({
      hasProjectManifest: true,
    });
    expect(repository?.branches[2]?.worktree).toBeUndefined();
  }, 15_000);

  it("previews and creates a sibling worktree without switching the source checkout", async () => {
    const { rootPath } = await fixtureRepository();
    const branch = "feature/a-very-long-local-branch-name";
    const preview = previewProjectWorktree(rootPath, branch);

    expect(preview.branch).toBe(branch);
    expect(preview.worktreePath).toContain(
      "very-long-project-name--feature-a-very-long-local-branch-name",
    );
    expect(run(rootPath, ["branch", "--show-current"])).toBe("main");

    const created = createProjectWorktree(rootPath, {
      branch,
      expectedHead: preview.head,
      worktreePath: preview.worktreePath,
    });

    expect(created).toMatchObject({
      path: preview.worktreePath,
      branch,
      isCurrent: true,
      available: true,
    });
    expect(run(rootPath, ["branch", "--show-current"])).toBe("main");
    expect(run(preview.worktreePath, ["branch", "--show-current"])).toBe(
      branch,
    );
  }, 15_000);

  it("creates a convention-prefixed branch in a separate worktree", async () => {
    const { rootPath, releasePath } = await fixtureRepository();
    run(releasePath, ["add", "README.md"]);
    run(releasePath, ["commit", "-m", "release base"]);
    const releaseHead = run(releasePath, ["rev-parse", "HEAD"]);
    const mainHead = run(rootPath, ["rev-parse", "HEAD"]);
    const preview = previewNewProjectBranchWorktree(
      rootPath,
      "fix",
      "Selector focus state",
      "release",
    );

    expect(preview).toMatchObject({
      creationMode: "new-branch",
      branch: "fix/selector-focus-state",
      baseBranch: "release",
      baseHead: releaseHead,
      branchType: "fix",
    });
    expect(preview.baseHead).not.toBe(mainHead);

    const created = createNewProjectBranchWorktree(rootPath, {
      branchType: "fix",
      branchNameInput: "Selector focus state",
      baseBranch: "release",
      expectedBaseHead: preview.baseHead!,
      sourceWorktreePath: preview.sourceWorktreePath,
      worktreePath: preview.worktreePath,
    });

    expect(created).toMatchObject({
      branch: "fix/selector-focus-state",
      path: preview.worktreePath,
      isCurrent: true,
    });
    expect(run(rootPath, ["branch", "--show-current"])).toBe("main");
    expect(run(preview.worktreePath, ["branch", "--show-current"])).toBe(
      "fix/selector-focus-state",
    );
    expect(run(preview.worktreePath, ["rev-parse", "HEAD"])).toBe(releaseHead);
  }, 15_000);

  it("rejects confirmation after the selected base branch moves", async () => {
    const { rootPath, releasePath } = await fixtureRepository();
    const preview = previewNewProjectBranchWorktree(
      rootPath,
      "feat",
      "Explicit stale base",
      "release",
    );
    run(releasePath, ["add", "README.md"]);
    run(releasePath, ["commit", "-m", "move release base"]);

    expect(() =>
      createNewProjectBranchWorktree(rootPath, {
        branchType: "feat",
        branchNameInput: "Explicit stale base",
        baseBranch: "release",
        expectedBaseHead: preview.baseHead!,
        sourceWorktreePath: preview.sourceWorktreePath,
        worktreePath: preview.worktreePath,
      }),
    ).toThrow("base branch moved after the preview");
    expect(run(rootPath, ["branch", "--list", preview.branch])).toBe("");
    expect(run(rootPath, ["branch", "--show-current"])).toBe("main");
  }, 15_000);

  it("rejects stale confirmations before creating anything", async () => {
    const { rootPath } = await fixtureRepository();
    const preview = previewProjectWorktree(
      rootPath,
      "feature/a-very-long-local-branch-name",
    );

    expect(() =>
      createProjectWorktree(rootPath, {
        branch: preview.branch,
        expectedHead: "0".repeat(40),
        worktreePath: preview.worktreePath,
      }),
    ).toThrow("branch moved after the preview");
    expect(run(rootPath, ["branch", "--show-current"])).toBe("main");
  }, 15_000);
});
