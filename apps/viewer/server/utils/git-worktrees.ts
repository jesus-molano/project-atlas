import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createError } from "h3";
import type { ProjectGitState } from "./project";
import {
  canonicalFilesystemPath,
  filesystemPathKey,
} from "@component-atlas/runtime";
import {
  branchNameFromParts,
  type BranchPrefix,
} from "../../shared/branch-conventions";

const GIT_TIMEOUT_MS = 5_000;
const GIT_OUTPUT_LIMIT = 2 * 1024 * 1024;

export interface ProjectWorktree {
  path: string;
  name: string;
  branch?: string;
  head: string;
  isCurrent: boolean;
  isPrimary: boolean;
  available: boolean;
  locked: boolean;
  prunable: boolean;
  git?: ProjectGitState;
}

export interface ProjectLocalBranch {
  name: string;
  head: string;
  shortHead: string;
  isCurrent: boolean;
  hasProjectManifest: boolean;
  worktree?: ProjectWorktree;
}

export interface ProjectRepositoryState {
  logicalProjectPath: string;
  logicalProjectName: string;
  activeRoot: string;
  branches: ProjectLocalBranch[];
  worktrees: ProjectWorktree[];
  checkedAt: string;
}

export interface WorktreeCreationPreview {
  creationMode: "existing-branch" | "new-branch";
  branch: string;
  head: string;
  shortHead: string;
  logicalProjectPath: string;
  logicalProjectName: string;
  sourceWorktreePath: string;
  worktreePath: string;
  worktreeName: string;
  hasProjectManifest: boolean;
  branchType?: BranchPrefix;
  branchNameInput?: string;
  baseBranch?: string;
  baseHead?: string;
  baseShortHead?: string;
}

interface PorcelainWorktree {
  path: string;
  head: string;
  branch?: string;
  locked: boolean;
  prunable: boolean;
}

function git(
  rootPath: string,
  args: string[],
  options: {
    allowFailure?: boolean;
    preserveLeadingWhitespace?: boolean;
  } = {},
): string | undefined {
  try {
    const output = execFileSync("git", ["-C", rootPath, ...args], {
      encoding: "utf8",
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: GIT_OUTPUT_LIMIT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return options.preserveLeadingWhitespace
      ? output.trimEnd()
      : output.trim();
  } catch (caught) {
    if (options.allowFailure) return undefined;
    const stderr =
      typeof caught === "object" &&
      caught !== null &&
      "stderr" in caught &&
      typeof caught.stderr === "string"
        ? caught.stderr.trim()
        : "";
    throw createError({
      statusCode: 409,
      statusMessage:
        stderr || "Git could not complete the requested worktree operation.",
    });
  }
}

function parseWorktreePorcelain(output: string): PorcelainWorktree[] {
  const records: PorcelainWorktree[] = [];
  let current: Partial<PorcelainWorktree> | undefined;
  const finish = () => {
    if (current?.path && current.head) {
      records.push({
        path: current.path,
        head: current.head,
        ...(current.branch ? { branch: current.branch } : {}),
        locked: current.locked ?? false,
        prunable: current.prunable ?? false,
      });
    }
    current = undefined;
  };

  for (const token of output.split("\0")) {
    if (!token) {
      finish();
      continue;
    }
    const separator = token.indexOf(" ");
    const key = separator < 0 ? token : token.slice(0, separator);
    const value = separator < 0 ? "" : token.slice(separator + 1);
    if (key === "worktree") {
      finish();
      current = {
        path: value,
        locked: false,
        prunable: false,
      };
    } else if (current && key === "HEAD") {
      current.head = value;
    } else if (current && key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (current && key === "locked") {
      current.locked = true;
    } else if (current && key === "prunable") {
      current.prunable = true;
    }
  }
  finish();
  return records;
}

function localBranches(rootPath: string): Array<{
  name: string;
  head: string;
  shortHead: string;
}> {
  const output = git(rootPath, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)%09%(objectname:short=10)",
    "refs/heads",
  ]);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.split("\t"))
    .filter(
      (parts): parts is [string, string, string] =>
        parts.length === 3 && Boolean(parts[0] && parts[1] && parts[2]),
    )
    .map(([name, head, shortHead]) => ({ name, head, shortHead }));
}

function branchHasProjectManifest(rootPath: string, branch: string): boolean {
  return Boolean(
    git(
      rootPath,
      ["cat-file", "-e", `refs/heads/${branch}:package.json`],
      { allowFailure: true },
    ) !== undefined,
  );
}

function branchesWithProjectManifest(
  rootPath: string,
  branches: string[],
): Set<string> {
  if (!branches.length) return new Set();
  const objectNames = branches.map(
    (branch) => `refs/heads/${branch}:package.json`,
  );
  try {
    const output = execFileSync(
      "git",
      ["-C", rootPath, "cat-file", "--batch-check=%(objectname)"],
      {
        encoding: "utf8",
        input: `${objectNames.join("\n")}\n`,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_OUTPUT_LIMIT,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const lines = output.trimEnd().split(/\r?\n/);
    return new Set(
      branches.filter((branch, index) => {
        const line = lines[index] ?? "";
        return Boolean(line && !line.endsWith(" missing"));
      }),
    );
  } catch {
    return new Set(
      branches.filter((branch) =>
        branchHasProjectManifest(rootPath, branch),
      ),
    );
  }
}

function worktreeGitState(
  worktree: PorcelainWorktree,
  worktreePath: string,
  logicalProjectPath: string,
  isPrimary: boolean,
): ProjectGitState {
  const status = git(
    worktreePath,
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { allowFailure: true, preserveLeadingWhitespace: true },
  );
  const lines = status ? status.split(/\r?\n/).filter(Boolean) : [];
  return {
    ...(worktree.branch ? { branch: worktree.branch } : {}),
    head: worktree.head.slice(0, 10),
    worktreePath,
    worktreeName: path.basename(worktreePath),
    logicalProjectPath,
    logicalProjectName: path.basename(logicalProjectPath),
    isLinkedWorktree: !isPrimary,
    dirty: lines.length > 0,
    changedFiles: lines.length,
    stagedFiles: lines.filter((line) => line[0] && line[0] !== " ").length,
    untrackedFiles: lines.filter((line) => line.startsWith("??")).length,
    checkedAt: new Date().toISOString(),
  };
}

function worktreePathSlug(branch: string): string {
  const readable = branch
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 52)
    .replace(/[. ]+$/g, "");
  const digest = createHash("sha256").update(branch).digest("hex").slice(0, 6);
  return `${readable || "branch"}-${digest}`;
}

function proposedWorktreePath(
  repository: ProjectRepositoryState,
  branch: string,
): string {
  const parent = path.dirname(repository.logicalProjectPath);
  const project = path.basename(repository.logicalProjectPath);
  const base = path.join(parent, `${project}--${worktreePathSlug(branch)}`);
  const occupied = new Set(
    repository.worktrees.map((worktree) => filesystemPathKey(worktree.path)),
  );
  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!existsSync(candidate) && !occupied.has(filesystemPathKey(candidate))) {
      return candidate;
    }
  }
  throw createError({
    statusCode: 409,
    statusMessage:
      "Atlas could not find a safe sibling folder for this worktree.",
  });
}

export function projectRepositoryStateForRoot(
  inputRootPath: string,
): ProjectRepositoryState | undefined {
  const rootPath = canonicalFilesystemPath(inputRootPath);
  const commonGitDirectory = git(
    rootPath,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { allowFailure: true },
  );
  const topLevel = git(rootPath, ["rev-parse", "--show-toplevel"], {
    allowFailure: true,
  });
  if (!commonGitDirectory || !topLevel) return undefined;

  const logicalProjectPath = path.dirname(commonGitDirectory);
  const currentKey = filesystemPathKey(topLevel);
  const primaryKey = filesystemPathKey(logicalProjectPath);
  const porcelain = git(rootPath, [
    "worktree",
    "list",
    "--porcelain",
    "-z",
  ]);
  const worktrees = parseWorktreePorcelain(porcelain ?? "").map(
    (worktree): ProjectWorktree => {
      const worktreePath = canonicalFilesystemPath(worktree.path);
      const available = existsSync(worktreePath);
      const isPrimary = filesystemPathKey(worktreePath) === primaryKey;
      return {
        path: worktreePath,
        name: path.basename(worktreePath),
        ...(worktree.branch ? { branch: worktree.branch } : {}),
        head: worktree.head,
        isCurrent: filesystemPathKey(worktreePath) === currentKey,
        isPrimary,
        available,
        locked: worktree.locked,
        prunable: worktree.prunable,
        ...(available
          ? {
              git: worktreeGitState(
                worktree,
                worktreePath,
                logicalProjectPath,
                isPrimary,
              ),
            }
          : {}),
      };
    },
  );
  const worktreeByBranch = new Map(
    worktrees
      .filter(
        (worktree): worktree is ProjectWorktree & { branch: string } =>
          Boolean(worktree.branch),
      )
      .map((worktree) => [worktree.branch, worktree]),
  );
  const localBranchRows = localBranches(rootPath);
  const branchesWithManifest = branchesWithProjectManifest(
    rootPath,
    localBranchRows.map((branch) => branch.name),
  );
  const branches = localBranchRows
    .map(
      (branch): ProjectLocalBranch => ({
        ...branch,
        isCurrent: worktreeByBranch.get(branch.name)?.isCurrent ?? false,
        hasProjectManifest: branchesWithManifest.has(branch.name),
        ...(worktreeByBranch.has(branch.name)
          ? { worktree: worktreeByBranch.get(branch.name)! }
          : {}),
      }),
    )
    .sort((left, right) => {
      const priority = (branch: ProjectLocalBranch) =>
        branch.isCurrent ? 0 : branch.worktree ? 1 : 2;
      return (
        priority(left) - priority(right) ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
      );
    });
  return {
    logicalProjectPath,
    logicalProjectName: path.basename(logicalProjectPath),
    activeRoot: topLevel,
    branches,
    worktrees,
    checkedAt: new Date().toISOString(),
  };
}

export function previewProjectWorktree(
  rootPath: string,
  branchName: string,
): WorktreeCreationPreview {
  const repository = projectRepositoryStateForRoot(rootPath);
  if (!repository) {
    throw createError({
      statusCode: 422,
      statusMessage: "The active project is not a Git worktree.",
    });
  }
  const branch = repository.branches.find(
    (candidate) => candidate.name === branchName,
  );
  if (!branch) {
    throw createError({
      statusCode: 404,
      statusMessage: "That local branch no longer exists.",
    });
  }
  if (branch.worktree) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "That branch already has a worktree. Review and open its existing checkout instead.",
    });
  }
  if (!branch.hasProjectManifest) {
    throw createError({
      statusCode: 422,
      statusMessage:
        "That branch does not contain package.json and cannot be opened as an Atlas frontend project.",
    });
  }
  const worktreePath = proposedWorktreePath(repository, branch.name);
  return {
    creationMode: "existing-branch",
    branch: branch.name,
    head: branch.head,
    shortHead: branch.shortHead,
    logicalProjectPath: repository.logicalProjectPath,
    logicalProjectName: repository.logicalProjectName,
    sourceWorktreePath: repository.activeRoot,
    worktreePath,
    worktreeName: path.basename(worktreePath),
    hasProjectManifest: branch.hasProjectManifest,
  };
}

export function previewNewProjectBranchWorktree(
  rootPath: string,
  branchType: BranchPrefix,
  branchNameInput: string,
): WorktreeCreationPreview {
  const repository = projectRepositoryStateForRoot(rootPath);
  if (!repository) {
    throw createError({
      statusCode: 422,
      statusMessage: "The active project is not a Git worktree.",
    });
  }
  let branch: string;
  try {
    branch = branchNameFromParts(branchType, branchNameInput);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Branch name is invalid.",
    });
  }
  if (repository.branches.some((candidate) => candidate.name === branch)) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "That local branch already exists. Open its worktree or choose another name.",
    });
  }
  const source = repository.worktrees.find((worktree) => worktree.isCurrent);
  if (!source?.head) {
    throw createError({
      statusCode: 422,
      statusMessage:
        "The active checkout has no commit from which to create a branch.",
    });
  }
  const worktreePath = proposedWorktreePath(repository, branch);
  return {
    creationMode: "new-branch",
    branch,
    head: source.head,
    shortHead: source.head.slice(0, 10),
    branchType,
    branchNameInput: branchNameInput.trim(),
    ...(source.branch ? { baseBranch: source.branch } : {}),
    baseHead: source.head,
    baseShortHead: source.head.slice(0, 10),
    logicalProjectPath: repository.logicalProjectPath,
    logicalProjectName: repository.logicalProjectName,
    sourceWorktreePath: repository.activeRoot,
    worktreePath,
    worktreeName: path.basename(worktreePath),
    hasProjectManifest: true,
  };
}

export function createProjectWorktree(
  rootPath: string,
  input: {
    branch: string;
    expectedHead: string;
    worktreePath: string;
  },
): ProjectWorktree {
  const preview = previewProjectWorktree(rootPath, input.branch);
  if (preview.head !== input.expectedHead) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The branch moved after the preview. Review the destination again before creating a worktree.",
    });
  }
  if (
    filesystemPathKey(preview.worktreePath) !==
    filesystemPathKey(input.worktreePath)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The proposed worktree destination changed. Review it again before creating anything.",
    });
  }
  git(rootPath, [
    "worktree",
    "add",
    "--checkout",
    preview.worktreePath,
    preview.branch,
  ]);
  const repository = projectRepositoryStateForRoot(preview.worktreePath);
  const created = repository?.worktrees.find(
    (worktree) =>
      filesystemPathKey(worktree.path) ===
      filesystemPathKey(preview.worktreePath),
  );
  if (!created) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Git created the destination, but Atlas could not verify the new worktree.",
    });
  }
  return created;
}

export function createNewProjectBranchWorktree(
  rootPath: string,
  input: {
    branchType: BranchPrefix;
    branchNameInput: string;
    expectedBaseHead: string;
    sourceWorktreePath: string;
    worktreePath: string;
  },
): ProjectWorktree {
  const preview = previewNewProjectBranchWorktree(
    rootPath,
    input.branchType,
    input.branchNameInput,
  );
  if (
    preview.baseHead !== input.expectedBaseHead ||
    filesystemPathKey(preview.sourceWorktreePath) !==
      filesystemPathKey(input.sourceWorktreePath)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The starting checkout changed after the preview. Review the new branch again.",
    });
  }
  if (
    filesystemPathKey(preview.worktreePath) !==
    filesystemPathKey(input.worktreePath)
  ) {
    throw createError({
      statusCode: 409,
      statusMessage:
        "The proposed worktree destination changed. Review it again before creating anything.",
    });
  }
  git(rootPath, [
    "worktree",
    "add",
    "--checkout",
    "-b",
    preview.branch,
    preview.worktreePath,
    preview.baseHead!,
  ]);
  const repository = projectRepositoryStateForRoot(preview.worktreePath);
  const created = repository?.worktrees.find(
    (worktree) =>
      filesystemPathKey(worktree.path) ===
      filesystemPathKey(preview.worktreePath),
  );
  if (!created) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "Git created the destination, but Atlas could not verify the new worktree.",
    });
  }
  return created;
}
