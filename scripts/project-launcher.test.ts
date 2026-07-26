import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listRecentProjects,
  rememberRecentProject,
  setActiveProjectRoot,
  validateProjectRoot,
} from "../apps/viewer/server/utils/project";

const temporaryRoots: string[] = [];

afterEach(async () => {
  delete process.env.ATLAS_RECENT_PROJECTS_PATH;
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
    `${JSON.stringify({ name }, null, 2)}\n`,
    "utf8",
  );
  return root;
}

describe("local project launcher", () => {
  it("validates project directories and keeps recent entries idempotent", async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), "atlas-recents-"));
    temporaryRoots.push(stateRoot);
    process.env.ATLAS_RECENT_PROJECTS_PATH = path.join(
      stateRoot,
      "recent-projects.json",
    );
    const first = await projectFixture("first-app");
    const second = await projectFixture("second-app");

    expect(await validateProjectRoot(first)).toBe(await pathReal(first));
    setActiveProjectRoot(first);
    await rememberRecentProject(first);
    await rememberRecentProject(second);
    await rememberRecentProject(first);

    const result = await listRecentProjects();
    expect(result.activeRoot).toBe(await pathReal(first));
    expect(result.projects.map((project) => project.name)).toEqual([
      "first-app",
      "second-app",
    ]);
    expect(result.projects.every((project) => project.available)).toBe(true);

    const persisted = JSON.parse(
      await readFile(process.env.ATLAS_RECENT_PROJECTS_PATH, "utf8"),
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
    await expect(validateProjectRoot("relative/project")).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});

async function pathReal(value: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(value);
}
