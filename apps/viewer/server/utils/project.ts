import type { ProjectAtlasSnapshot } from "@component-atlas/runtime";
import { AtlasStore } from "@component-atlas/store";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createError } from "h3";
import os from "node:os";
import path from "node:path";

let activeProjectRoot = process.env.ATLAS_PROJECT_ROOT
  ? path.resolve(process.env.ATLAS_PROJECT_ROOT)
  : undefined;

export function projectRootPath(): string {
  const rootPath = activeProjectRoot;
  if (!rootPath) {
    throw createError({
      statusCode: 503,
      statusMessage:
        "ATLAS_PROJECT_ROOT is missing. Launch Project Atlas with the CLI open command.",
    });
  }
  return rootPath;
}

export interface RecentProject {
  rootPath: string;
  name: string;
  lastOpenedAt: string;
  available: boolean;
}

interface RecentProjectsFile {
  schemaVersion: 1;
  projects: Array<Omit<RecentProject, "available">>;
}

function recentProjectsPath(): string {
  if (process.env.ATLAS_RECENT_PROJECTS_PATH) {
    return path.resolve(process.env.ATLAS_RECENT_PROJECTS_PATH);
  }
  const dataRoot =
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), ".local", "share");
  return path.join(dataRoot, "ProjectAtlas", "recent-projects.json");
}

function projectName(rootPath: string): string {
  const packagePath = path.join(rootPath, "package.json");
  if (existsSync(packagePath)) {
    try {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
        name?: unknown;
      };
      if (typeof parsed.name === "string" && parsed.name.trim()) {
        return parsed.name.trim();
      }
    } catch {
      // A malformed manifest is reported by scanning. The launcher can still
      // identify the directory by name.
    }
  }
  return path.basename(rootPath);
}

function normalizedPathKey(rootPath: string): string {
  const resolved = path.resolve(rootPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export async function validateProjectRoot(inputPath: string): Promise<string> {
  const candidate = inputPath.trim();
  if (
    !candidate ||
    candidate.length > 1_024 ||
    /[\u0000-\u001f]/.test(candidate) ||
    !path.isAbsolute(candidate)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Choose an absolute local project folder.",
    });
  }
  let resolved: string;
  try {
    resolved = await realpath(candidate);
    if (!(await stat(resolved)).isDirectory()) throw new Error("not-directory");
  } catch {
    throw createError({
      statusCode: 404,
      statusMessage: "That project folder does not exist or is not accessible.",
    });
  }
  if (
    !existsSync(path.join(resolved, "package.json")) &&
    !existsSync(path.join(resolved, ".git"))
  ) {
    throw createError({
      statusCode: 422,
      statusMessage:
        "Choose a repository or frontend project containing .git or package.json.",
    });
  }
  return resolved;
}

export function setActiveProjectRoot(rootPath: string): void {
  activeProjectRoot = path.resolve(rootPath);
}

async function readRecentProjectsFile(): Promise<RecentProjectsFile> {
  try {
    const parsed = JSON.parse(
      await readFile(recentProjectsPath(), "utf8"),
    ) as Partial<RecentProjectsFile>;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) {
      return { schemaVersion: 1, projects: [] };
    }
    return {
      schemaVersion: 1,
      projects: parsed.projects
        .filter(
          (project): project is Omit<RecentProject, "available"> =>
            Boolean(
              project &&
                typeof project.rootPath === "string" &&
                typeof project.name === "string" &&
                typeof project.lastOpenedAt === "string",
            ),
        )
        .slice(0, 12),
    };
  } catch {
    return { schemaVersion: 1, projects: [] };
  }
}

export async function listRecentProjects(): Promise<{
  activeRoot?: string;
  projects: RecentProject[];
}> {
  const file = await readRecentProjectsFile();
  const projects = file.projects.map((project) => ({
    ...project,
    available: existsSync(project.rootPath),
  }));
  if (
    activeProjectRoot &&
    !projects.some(
      (project) =>
        normalizedPathKey(project.rootPath) ===
        normalizedPathKey(activeProjectRoot!),
    )
  ) {
    projects.unshift({
      rootPath: activeProjectRoot,
      name: projectName(activeProjectRoot),
      lastOpenedAt: new Date().toISOString(),
      available: existsSync(activeProjectRoot),
    });
  }
  return {
    ...(activeProjectRoot ? { activeRoot: activeProjectRoot } : {}),
    projects: projects.slice(0, 10),
  };
}

export async function rememberRecentProject(rootPath: string): Promise<void> {
  const targetPath = recentProjectsPath();
  const current = await readRecentProjectsFile();
  const key = normalizedPathKey(rootPath);
  const projects = [
    {
      rootPath,
      name: projectName(rootPath),
      lastOpenedAt: new Date().toISOString(),
    },
    ...current.projects.filter(
      (project) => normalizedPathKey(project.rootPath) !== key,
    ),
  ].slice(0, 10);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`,
    "utf8",
  );
  await rename(temporaryPath, targetPath);
}

export function projectAtlasCliEntry(): string {
  return process.env.ATLAS_CLI_ENTRY
    ? path.resolve(process.env.ATLAS_CLI_ENTRY)
    : path.resolve(process.cwd(), "packages", "cli", "dist", "index.js");
}

export interface ProjectGitState {
  branch?: string;
  head?: string;
  dirty: boolean;
  changedFiles: number;
  stagedFiles: number;
  untrackedFiles: number;
  checkedAt: string;
}

export function projectGitState(): ProjectGitState {
  const rootPath = projectRootPath();
  const run = (args: string[]): string | undefined => {
    try {
      return execFileSync("git", ["-C", rootPath, ...args], {
        encoding: "utf8",
        timeout: 2_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  };
  const status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
  const branch = run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const head = run(["rev-parse", "--short=10", "HEAD"]);
  const lines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  return {
    ...(branch ? { branch } : {}),
    ...(head ? { head } : {}),
    dirty: lines.length > 0,
    changedFiles: lines.length,
    stagedFiles: lines.filter((line) => line[0] && line[0] !== " ").length,
    untrackedFiles: lines.filter((line) => line.startsWith("??")).length,
    checkedAt: new Date().toISOString(),
  };
}

export function loadProjectAtlasSnapshot(): ProjectAtlasSnapshot {
  const rootPath = projectRootPath();
  let artifact:
    | {
        project?: {
          id?: string;
          rootPath?: string;
          identity?: { checkoutId?: string };
        };
      }
    | undefined;
  const artifactPath = path.join(rootPath, ".component-atlas", "project.json");
  if (existsSync(artifactPath)) {
    try {
      artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as typeof artifact;
    } catch {
      artifact = undefined;
    }
  }
  const artifactMatches =
    artifact?.project?.rootPath &&
    path.resolve(artifact.project.rootPath).toLowerCase() ===
      path.resolve(rootPath).toLowerCase();
  const id =
    process.env.ATLAS_PROJECT_ID ??
    (artifactMatches ? artifact?.project?.id : undefined) ??
    createHash("sha256")
      .update(path.resolve(rootPath).toLowerCase())
      .digest("hex")
      .slice(0, 20);
  const checkoutId =
    process.env.ATLAS_CHECKOUT_ID ??
    (artifactMatches ? artifact?.project?.identity?.checkoutId : undefined);
  const store = new AtlasStore(id);
  try {
    const stored = store.readProjectSnapshot(id, checkoutId);
    const graph = stored.graph;
    if (!graph) {
      throw createError({
        statusCode: 404,
        statusMessage: "No index found. Run project-atlas scan first.",
      });
    }
    const capturedAt = new Date().toISOString();
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          project: [graph.project.id, graph.project.scannedAt],
          graph: [graph.components.length, graph.edges.length, graph.tokens.length],
          design: stored.designIndexes.map((index) => [
            index.file.key,
            index.indexedAt,
            index.nodes.length,
          ]),
          memory: stored.memoryItems.map((item) => [item.id, item.updatedAt, item.status]),
          proposals: stored.memoryProposals.map((item) => [
            item.id,
            item.createdAt,
            item.status,
          ]),
          decisions: stored.componentDecisions.map((item) => [
            item.id,
            item.createdAt,
          ]),
        }),
      )
      .digest("hex")
      .slice(0, 16);
    return {
      fingerprint,
      capturedAt,
      graph,
      designIndexes: stored.designIndexes,
      memoryItems: stored.memoryItems,
      memoryProposals: stored.memoryProposals,
      componentDecisions: stored.componentDecisions,
    };
  } finally {
    store.close();
  }
}
