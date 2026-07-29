import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectProjectAtlasStorage,
  forgetRecentProject,
  forgetRecentProjects,
  projectAtlasStorageRoot,
  projectStorageDirectory,
  readRecentProjects,
  rememberRecentProject,
} from "./storage.js";

describe("Project Atlas storage", () => {
  it("uses one ProjectAtlas root on Windows", () => {
    const root = projectAtlasStorageRoot({
      platform: "win32",
      homeDirectory: "C:\\Users\\atlas",
      env: { LOCALAPPDATA: "C:\\Users\\atlas\\AppData\\Local" },
    });
    expect(root).toBe(
      path.join("C:\\Users\\atlas\\AppData\\Local", "ProjectAtlas"),
    );
    expect(root).not.toContain("ComponentAtlas");
    expect(root).not.toContain(".codex");
  });

  it("honors only the canonical Project Atlas home override", () => {
    const root = projectAtlasStorageRoot({
      platform: "win32",
      homeDirectory: "C:\\Users\\atlas",
      env: {
        LOCALAPPDATA: "C:\\Users\\atlas\\AppData\\Local",
        PROJECT_ATLAS_HOME: "D:\\AtlasState",
        COMPONENT_ATLAS_HOME: "D:\\LegacyState",
      },
    });
    expect(root).toBe(path.resolve("D:\\AtlasState"));
    expect(projectStorageDirectory("project-42", {
      platform: "win32",
      homeDirectory: "C:\\Users\\atlas",
      env: { PROJECT_ATLAS_HOME: "D:\\AtlasState" },
    })).toBe(path.join(path.resolve("D:\\AtlasState"), "projects", "project-42"));
  });

  it("keeps recent project data and diagnostics under the same root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "project-atlas-storage-"));
    const options = {
      env: { PROJECT_ATLAS_HOME: root },
      platform: process.platform,
      homeDirectory: os.homedir(),
    };
    await rememberRecentProject(
      {
        id: "project-42",
        name: "Checkout",
        rootPath: "C:\\work\\checkout",
        lastOpenedAt: "2026-07-29T12:00:00.000Z",
      },
      options,
    );
    expect(await readRecentProjects(options)).toEqual([
      expect.objectContaining({ id: "project-42" }),
    ]);
    const diagnostic = await inspectProjectAtlasStorage(options);
    expect(diagnostic.rootPath).toBe(root);
    expect(diagnostic.projectsPath).toBe(path.join(root, "projects"));
    expect(diagnostic.tempPath).toBe(path.join(root, "temp"));
    expect(diagnostic.categories.find((item) => item.name === "temp")).toMatchObject({
      ephemeral: true,
    });
    expect(
      JSON.parse(
        await readFile(path.join(root, "recent-projects.json"), "utf8"),
      ),
    ).toMatchObject({ schemaVersion: 1 });
  });

  it("unlinks recent records without deleting repositories or project storage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "project-atlas-unlink-"));
    const options = {
      env: { PROJECT_ATLAS_HOME: root },
      platform: process.platform,
      homeDirectory: os.homedir(),
    };
    const firstRoot = path.join(root, "missing-one");
    const secondRoot = path.join(root, "missing-two");
    await rememberRecentProject(
      {
        id: "project-one",
        rootPath: firstRoot,
        lastOpenedAt: "2026-07-29T12:00:00.000Z",
      },
      options,
    );
    await rememberRecentProject(
      {
        id: "project-two",
        rootPath: secondRoot,
        lastOpenedAt: "2026-07-29T12:01:00.000Z",
      },
      options,
    );
    const projectStorage = projectStorageDirectory("project-one", options);
    await mkdir(projectStorage, { recursive: true });
    await writeFile(path.join(projectStorage, "keep.txt"), "keep", "utf8");

    expect(await forgetRecentProject(firstRoot, options)).toBe(true);
    expect(await readRecentProjects(options)).toEqual([
      expect.objectContaining({ id: "project-two" }),
    ]);
    await expect(
      access(path.join(projectStorage, "keep.txt")),
    ).resolves.toBeUndefined();
    expect(await forgetRecentProjects([secondRoot], options)).toBe(1);
    expect(await readRecentProjects(options)).toEqual([]);
    await expect(
      access(path.join(projectStorage, "keep.txt")),
    ).resolves.toBeUndefined();
  });
});
