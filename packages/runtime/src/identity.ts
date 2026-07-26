import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ProjectIdentityMetadata,
  ProjectIdentitySource,
} from "@component-atlas/core";

const execFileAsync = promisify(execFile);
const identityCache = new Map<
  string,
  { resolvedAt: number; value: ResolvedProjectIdentity }
>();

export interface ResolveProjectIdentityOptions {
  projectKey?: string;
  gitExecutable?: string;
  fresh?: boolean;
}

export interface ResolvedProjectIdentity extends ProjectIdentityMetadata {
  legacyPathId: string;
}

function digest(value: string, length = 20): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function canonicalPath(value: string): string {
  const resolved = path.resolve(value).replaceAll("\\", "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function normalizeRepositoryRemote(remote: string): string | undefined {
  const value = remote.trim();
  if (!value) return undefined;
  const scp = value.match(/^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/);
  if (scp && !value.includes("://") && !/^[A-Za-z]:[\\/]/.test(value)) {
    const host = scp[1]!.toLowerCase();
    const repository = scp[2]!.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    return repository ? `${host}/${repository.toLowerCase()}` : undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "file:") {
      return `local/${canonicalPath(decodeURIComponent(url.pathname))}`;
    }
    const repository = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "");
    return repository
      ? `${url.hostname.toLowerCase()}/${repository.toLowerCase()}`
      : undefined;
  } catch {
    if (/^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|\/)/.test(value)) {
      return `local/${canonicalPath(value)}`;
    }
    return undefined;
  }
}

async function gitValue(
  rootPath: string,
  executable: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const result = await execFileAsync(executable, ["-C", rootPath, ...args], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    const value = result.stdout.trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export async function resolveProjectIdentity(
  inputPath: string,
  options: ResolveProjectIdentityOptions = {},
): Promise<ResolvedProjectIdentity> {
  const rootPath = await realpath(path.resolve(inputPath)).catch(() =>
    path.resolve(inputPath),
  );
  const git = options.gitExecutable ?? "git";
  const override = options.projectKey ?? process.env.PROJECT_ATLAS_PROJECT_KEY;
  const cacheKey = `${canonicalPath(rootPath)}\0${git}\0${override ?? ""}`;
  const cached = identityCache.get(cacheKey);
  if (!options.fresh && cached && Date.now() - cached.resolvedAt < 5_000) {
    return cached.value;
  }
  let pinnedOverride:
    | { logicalId: string; repositoryFingerprint: string }
    | undefined;
  if (!override) {
    try {
      const artifact = JSON.parse(
        await readFile(
          path.join(rootPath, ".component-atlas", "project.json"),
          "utf8",
        ),
      ) as {
        project?: {
          id?: string;
          rootPath?: string;
          identity?: {
            source?: string;
            repositoryFingerprint?: string;
          };
        };
      };
      if (
        artifact.project?.identity?.source === "override" &&
        /^[a-f0-9]{20}$/.test(artifact.project.id ?? "") &&
        /^[a-f0-9]{16}$/.test(
          artifact.project.identity.repositoryFingerprint ?? "",
        ) &&
        canonicalPath(artifact.project.rootPath ?? "") ===
          canonicalPath(rootPath)
      ) {
        pinnedOverride = {
          logicalId: artifact.project.id!,
          repositoryFingerprint:
            artifact.project.identity.repositoryFingerprint!,
        };
      }
    } catch {
      pinnedOverride = undefined;
    }
  }
  const remote = await gitValue(rootPath, git, [
    "config",
    "--get",
    "remote.origin.url",
  ]);
  const normalizedRemote = remote
    ? normalizeRepositoryRemote(remote)
    : undefined;
  const commonDirValue = await gitValue(rootPath, git, [
    "rev-parse",
    "--git-common-dir",
  ]);
  const commonDir = commonDirValue
    ? await realpath(
        path.isAbsolute(commonDirValue)
          ? commonDirValue
          : path.resolve(rootPath, commonDirValue),
      ).catch(() =>
        path.isAbsolute(commonDirValue)
          ? commonDirValue
          : path.resolve(rootPath, commonDirValue),
      )
    : undefined;
  const branch = await gitValue(rootPath, git, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  const head = await gitValue(rootPath, git, ["rev-parse", "--verify", "HEAD"]);

  let source: ProjectIdentitySource;
  let basis: string;
  if (override?.trim() || pinnedOverride) {
    source = "override";
    basis = override?.trim()
      ? `override:${override.trim().normalize("NFKC").toLowerCase()}`
      : "override:pinned";
  } else if (normalizedRemote) {
    source = "remote";
    basis = `remote:${normalizedRemote}`;
  } else if (commonDir) {
    source = "git-common-dir";
    basis = `git-common-dir:${canonicalPath(commonDir)}`;
  } else {
    source = "path";
    basis = `path:${canonicalPath(rootPath)}`;
  }

  const resolved: ResolvedProjectIdentity = {
    logicalId: pinnedOverride?.logicalId ?? digest(basis),
    repositoryFingerprint:
      pinnedOverride?.repositoryFingerprint ?? digest(basis, 16),
    source,
    checkoutId: digest(`checkout:${canonicalPath(rootPath)}`),
    worktreePath: rootPath,
    ...(branch ? { branch } : {}),
    ...(head ? { head } : {}),
    legacyPathId: digest(path.resolve(rootPath).toLowerCase()),
  };
  identityCache.set(cacheKey, { resolvedAt: Date.now(), value: resolved });
  return resolved;
}
