import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  filesystemPathsEquivalent,
  scanProject,
} from "../packages/runtime/src/index";
import {
  listRecentProjects,
  loadProjectAtlasSnapshot,
  projectGitStateForRoot,
  rememberRecentProject,
  setActiveProjectRoot,
  unlinkRecentProject,
  unlinkUnavailableRecentProjects,
  validateProjectRoot,
} from "../apps/viewer/server/utils/project";

const temporaryRoots: string[] = [];
let previousDataHome: string | undefined;

beforeEach(async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-launcher-data-"));
  temporaryRoots.push(dataHome);
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  process.env.PROJECT_ATLAS_HOME = dataHome;
});
afterEach(async () => {
  delete process.env.ATLAS_PROJECT_ID;
  delete process.env.ATLAS_CHECKOUT_ID;
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

async function projectFixture(name: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "atlas-project-launcher-"));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name, dependencies: { react: "^19.0.0" } }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

describe("local project launcher", () => {
  it("validates project directories and keeps recent entries idempotent", async () => {
    const first = await projectFixture("first-app");
    const second = await projectFixture("second-app");

    expect(
      filesystemPathsEquivalent(await validateProjectRoot(first), first),
    ).toBe(true);
    setActiveProjectRoot(first);
    await rememberRecentProject(first);
    await rememberRecentProject(second);
    await rememberRecentProject(first);

    const result = await listRecentProjects();
    expect(filesystemPathsEquivalent(result.activeRoot!, first)).toBe(true);
    expect(result.projects.map((project) => project.name)).toEqual([
      "first-app",
      "second-app",
    ]);
    expect(result.projects.every((project) => project.available)).toBe(true);

    const persisted = JSON.parse(
      await readFile(
        path.join(process.env.PROJECT_ATLAS_HOME!, "recent-projects.json"),
        "utf8",
      ),
    ) as { projects: Array<{ rootPath: string }> };
    expect(persisted.projects).toHaveLength(2);
  });

  it("rejects missing and non-project folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-invalid-project-"));
    temporaryRoots.push(root);
    await expect(validateProjectRoot(path.join(root, "missing"))).rejects.toMatchObject({
      statusCode: 404,
    });
    await mkdir(path.join(root, "plain"));
    await expect(validateProjectRoot(path.join(root, "plain"))).rejects.toMatchObject({
      statusCode: 422,
    });
    await mkdir(path.join(root, "git-only", ".git"), { recursive: true });
    await expect(
      validateProjectRoot(path.join(root, "git-only")),
    ).rejects.toMatchObject({
      statusCode: 422,
    });
    await expect(validateProjectRoot("relative/project")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("unlinks one or all unavailable recent paths without deleting Atlas project data", async () => {
    const storageHome = process.env.PROJECT_ATLAS_HOME!;
    const missingOne = path.join(storageHome, "fixture-missing-one");
    const missingTwo = path.join(storageHome, "fixture-missing-two");
    const retainedStorage = path.join(
      storageHome,
      "projects",
      "fixture-project",
    );
    await mkdir(retainedStorage, { recursive: true });
    await writeFile(path.join(retainedStorage, "keep.txt"), "keep", "utf8");
    await writeFile(
      path.join(storageHome, "recent-projects.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          projects: [
            {
              id: "fixture-project",
              name: "Missing one",
              rootPath: missingOne,
              lastOpenedAt: "2026-07-29T12:00:00.000Z",
            },
            {
              id: "fixture-project-two",
              name: "Missing two",
              rootPath: missingTwo,
              lastOpenedAt: "2026-07-29T12:01:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(await unlinkRecentProject(missingOne)).toBe(true);
    expect((await listRecentProjects()).projects).toContainEqual(
      expect.objectContaining({ rootPath: missingTwo, available: false }),
    );
    await expect(
      readFile(path.join(retainedStorage, "keep.txt"), "utf8"),
    ).resolves.toBe("keep");
    expect(await unlinkUnavailableRecentProjects()).toBe(1);
    expect((await listRecentProjects()).projects).toEqual([]);
    await expect(
      readFile(path.join(retainedStorage, "keep.txt"), "utf8"),
    ).resolves.toBe("keep");
  });

  it("does not reuse launch identity after switching to another project", async () => {
    const first = await projectFixture("launch-app");
    const second = await projectFixture("switched-app");
    const firstGraph = await scanProject(first);
    const secondGraph = await scanProject(second);

    process.env.ATLAS_PROJECT_ID = firstGraph.project.id;
    process.env.ATLAS_CHECKOUT_ID = firstGraph.project.identity?.checkoutId;
    setActiveProjectRoot(second);

    const snapshot = loadProjectAtlasSnapshot();
    expect(snapshot.graph.project.id).toBe(secondGraph.project.id);
    expect(snapshot.graph.project.name).toBe("switched-app");
    expect(snapshot.graph.project.rootPath).toBe(second);
  }, 15_000);

  it("preserves porcelain columns and separates a linked worktree from its logical project", async () => {
    const repository = await projectFixture("logical-atlas-project");
    const worktree = `${repository}-linked-checkout-with-a-long-name`;
    temporaryRoots.push(worktree);
    const git = (cwd: string, args: string[]) =>
      execFileSync("git", ["-C", cwd, ...args], {
        encoding: "utf8",
        windowsHide: true,
      });
    git(repository, ["init", "-b", "main"]);
    git(repository, ["config", "user.name", "Atlas Test"]);
    git(repository, ["config", "user.email", "atlas-test@example.invalid"]);
    git(repository, ["add", "package.json"]);
    git(repository, ["commit", "-m", "Initial fixture"]);
    git(repository, [
      "worktree",
      "add",
      worktree,
      "-b",
      "feature/linked-worktree-with-a-very-long-branch-name",
    ]);
    await writeFile(
      path.join(worktree, "package.json"),
      `${JSON.stringify({ name: "logical-atlas-project", dirty: true }, null, 2)}\n`,
      "utf8",
    );

    const state = projectGitStateForRoot(worktree);
    expect(state).toMatchObject({
      branch: "feature/linked-worktree-with-a-very-long-branch-name",
      isLinkedWorktree: true,
      dirty: true,
      changedFiles: 1,
      stagedFiles: 0,
      untrackedFiles: 0,
      logicalProjectName: path.basename(repository),
      worktreeName: path.basename(worktree),
    });
    expect(
      filesystemPathsEquivalent(state.logicalProjectPath!, repository),
    ).toBe(true);
  });
});
