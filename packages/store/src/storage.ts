import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const PROJECT_ATLAS_HOME_ENV = "PROJECT_ATLAS_HOME";
export const PROJECT_ATLAS_STORAGE_VERSION = 1 as const;

export interface StorageRootOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

export interface RecentProjectRecord {
  id: string;
  name?: string;
  rootPath: string;
  checkoutId?: string;
  lastOpenedAt: string;
}

export interface StorageCategoryDiagnostic {
  name: "projects" | "recent-projects" | "temp" | "other";
  path: string;
  bytes: number;
  ephemeral: boolean;
}

export interface ProjectAtlasStorageDiagnostic {
  schemaVersion: typeof PROJECT_ATLAS_STORAGE_VERSION;
  rootPath: string;
  projectsPath: string;
  tempPath: string;
  recentProjectsPath: string;
  totalBytes: number;
  categories: StorageCategoryDiagnostic[];
  legacyRoots: Array<{
    path: string;
    exists: boolean;
    readOnlyCompatibility: true;
  }>;
}

function checkedProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (/^[A-Za-z0-9._-]{1,160}$/u.test(normalized)) return normalized;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 40);
}

export function projectAtlasStorageRoot(
  options: StorageRootOptions = {},
): string {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const configured = environment[PROJECT_ATLAS_HOME_ENV]?.trim();
  if (configured) return path.resolve(configured);
  if (platform === "win32" && environment.LOCALAPPDATA?.trim()) {
    return path.join(environment.LOCALAPPDATA, "ProjectAtlas");
  }
  if (platform === "darwin") {
    return path.join(
      homeDirectory,
      "Library",
      "Application Support",
      "ProjectAtlas",
    );
  }
  return path.join(
    environment.XDG_DATA_HOME?.trim() ||
      path.join(homeDirectory, ".local", "share"),
    "ProjectAtlas",
  );
}

export function projectStorageDirectory(
  projectId: string,
  options: StorageRootOptions = {},
): string {
  return path.join(
    projectAtlasStorageRoot(options),
    "projects",
    checkedProjectId(projectId),
  );
}

export function projectStoragePath(
  projectId: string,
  ...segments: string[]
): string {
  return path.join(projectStorageDirectory(projectId), ...segments);
}

export function projectAtlasTempRoot(
  options: StorageRootOptions = {},
): string {
  return path.join(projectAtlasStorageRoot(options), "temp");
}

export function recentProjectsPath(
  options: StorageRootOptions = {},
): string {
  return path.join(projectAtlasStorageRoot(options), "recent-projects.json");
}

export function legacyProjectAtlasStorageRoots(
  options: StorageRootOptions = {},
): string[] {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const roots = new Set<string>();
  const configured = environment.COMPONENT_ATLAS_HOME?.trim();
  if (configured) roots.add(path.resolve(configured));
  if (platform === "win32" && environment.LOCALAPPDATA?.trim()) {
    roots.add(path.join(environment.LOCALAPPDATA, "ComponentAtlas"));
  } else if (platform === "darwin") {
    roots.add(
      path.join(
        homeDirectory,
        "Library",
        "Application Support",
        "ComponentAtlas",
      ),
    );
  } else {
    roots.add(
      path.join(
        environment.XDG_DATA_HOME?.trim() ||
          path.join(homeDirectory, ".local", "share"),
        "component-atlas",
      ),
    );
  }
  roots.delete(projectAtlasStorageRoot(options));
  return [...roots];
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function readRecentProjects(
  options: StorageRootOptions = {},
): Promise<RecentProjectRecord[]> {
  try {
    const parsed = JSON.parse(
      await readFile(recentProjectsPath(options), "utf8"),
    ) as {
      schemaVersion?: number;
      projects?: RecentProjectRecord[];
    };
    if (
      parsed.schemaVersion !== PROJECT_ATLAS_STORAGE_VERSION ||
      !Array.isArray(parsed.projects)
    ) {
      return [];
    }
    return parsed.projects
      .filter(
        (project) =>
          typeof project?.id === "string" &&
          typeof project.rootPath === "string" &&
          typeof project.lastOpenedAt === "string",
      )
      .slice(0, 100);
  } catch {
    return [];
  }
}

export async function rememberRecentProject(
  project: RecentProjectRecord,
  options: StorageRootOptions = {},
): Promise<void> {
  const projects = await readRecentProjects(options);
  const next = [
    project,
    ...projects.filter((candidate) => candidate.id !== project.id),
  ].slice(0, 100);
  await atomicJson(recentProjectsPath(options), {
    schemaVersion: PROJECT_ATLAS_STORAGE_VERSION,
    projects: next,
  });
}

async function directoryBytes(target: string): Promise<number> {
  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    return 0;
  }
  if (targetStat.isFile()) return targetStat.size;
  if (!targetStat.isDirectory()) return 0;
  let total = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    total += await directoryBytes(path.join(target, entry.name));
  }
  return total;
}

export async function inspectProjectAtlasStorage(
  options: StorageRootOptions = {},
): Promise<ProjectAtlasStorageDiagnostic> {
  const rootPath = projectAtlasStorageRoot(options);
  const projectsPath = path.join(rootPath, "projects");
  const tempPath = projectAtlasTempRoot(options);
  const recentPath = recentProjectsPath(options);
  const known = new Set(["projects", "temp", "recent-projects.json"]);
  const categories: StorageCategoryDiagnostic[] = [
    {
      name: "projects",
      path: projectsPath,
      bytes: await directoryBytes(projectsPath),
      ephemeral: false,
    },
    {
      name: "recent-projects",
      path: recentPath,
      bytes: await directoryBytes(recentPath),
      ephemeral: false,
    },
    {
      name: "temp",
      path: tempPath,
      bytes: await directoryBytes(tempPath),
      ephemeral: true,
    },
  ];
  let otherBytes = 0;
  if (await exists(rootPath)) {
    for (const entry of await readdir(rootPath, { withFileTypes: true })) {
      if (known.has(entry.name) || entry.isSymbolicLink()) continue;
      otherBytes += await directoryBytes(path.join(rootPath, entry.name));
    }
  }
  if (otherBytes > 0) {
    categories.push({
      name: "other",
      path: rootPath,
      bytes: otherBytes,
      ephemeral: false,
    });
  }
  return {
    schemaVersion: PROJECT_ATLAS_STORAGE_VERSION,
    rootPath,
    projectsPath,
    tempPath,
    recentProjectsPath: recentPath,
    totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
    categories,
    legacyRoots: await Promise.all(
      legacyProjectAtlasStorageRoots(options).map(async (legacyPath) => ({
        path: legacyPath,
        exists: await exists(legacyPath),
        readOnlyCompatibility: true as const,
      })),
    ),
  };
}
