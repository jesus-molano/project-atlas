import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ProjectIdentityMetadata,
  ProjectIdentitySource,
} from "@component-atlas/core";
import {
  canonicalFilesystemPath,
  filesystemPathKey,
} from "./path-identity.js";

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
      return `local/${filesystemPathKey(decodeURIComponent(url.pathname))}`;
    }
    const repository = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "");
    return repository
      ? `${url.hostname.toLowerCase()}/${repository.toLowerCase()}`
      : undefined;
  } catch {
    if (/^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|\/)/.test(value)) {
      return `local/${filesystemPathKey(value)}`;
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
  const rootPath = canonicalFilesystemPath(inputPath);
  const git = options.gitExecutable ?? "git";
  const override = options.projectKey ?? process.env.PROJECT_ATLAS_PROJECT_KEY;
  const cacheKey = `${filesystemPathKey(rootPath)}\0${git}\0${override ?? ""}`;
  const cached = identityCache.get(cacheKey);
  if (!options.fresh && cached && Date.now() - cached.resolvedAt < 5_000) {
    return cached.value;
  }
  let pinnedIdentity:
    | {
        logicalId: string;
        repositoryFingerprint: string;
        source: ProjectIdentitySource;
        checkoutId?: string;
      }
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
            checkoutId?: string;
          };
        };
      };
      const artifactProject = artifact.project;
      const artifactIdentity = artifactProject?.identity;
      if (
        ["override", "remote", "git-common-dir", "path"].includes(
          artifactIdentity?.source ?? "",
        ) &&
        /^[a-f0-9]{20}$/.test(artifactProject?.id ?? "") &&
        /^[a-f0-9]{16}$/.test(
          artifactIdentity?.repositoryFingerprint ?? "",
        ) &&
        filesystemPathKey(artifactProject?.rootPath ?? "") ===
          filesystemPathKey(rootPath)
      ) {
        pinnedIdentity = {
          logicalId: artifactProject!.id!,
          repositoryFingerprint:
            artifactIdentity!.repositoryFingerprint!,
          source: artifactIdentity!.source as ProjectIdentitySource,
          ...(artifactIdentity!.checkoutId
            ? { checkoutId: artifactIdentity!.checkoutId }
            : {}),
        };
      }
    } catch {
      pinnedIdentity = undefined;
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
  if (override?.trim() || pinnedIdentity?.source === "override") {
    source = "override";
    basis = override?.trim()
      ? `override:${override.trim().normalize("NFKC").toLowerCase()}`
      : "override:pinned";
  } else if (normalizedRemote) {
    source = "remote";
    basis = `remote:${normalizedRemote}`;
  } else if (commonDir) {
    source = "git-common-dir";
    basis = `git-common-dir:${filesystemPathKey(commonDir)}`;
  } else {
    source = "path";
    basis = `path:${filesystemPathKey(rootPath)}`;
  }
  const currentFingerprint = digest(basis, 16);
  const reusablePinnedIdentity =
    pinnedIdentity &&
    pinnedIdentity.source === source &&
    (source === "override" ||
      source === "path" ||
      source === "git-common-dir" ||
      pinnedIdentity.repositoryFingerprint === currentFingerprint)
      ? pinnedIdentity
      : undefined;

  const resolved: ResolvedProjectIdentity = {
    logicalId: reusablePinnedIdentity?.logicalId ?? digest(basis),
    repositoryFingerprint:
      reusablePinnedIdentity?.repositoryFingerprint ?? currentFingerprint,
    source,
    checkoutId:
      reusablePinnedIdentity?.checkoutId ??
      digest(`checkout:${filesystemPathKey(rootPath)}`),
    worktreePath: rootPath,
    ...(branch ? { branch } : {}),
    ...(head ? { head } : {}),
    legacyPathId: digest(path.resolve(rootPath).toLowerCase()),
  };
  identityCache.set(cacheKey, { resolvedAt: Date.now(), value: resolved });
  return resolved;
}
