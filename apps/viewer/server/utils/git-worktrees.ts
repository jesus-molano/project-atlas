import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createError } from "h3";
import type { ProjectGitState } from "./project";
import {
  canonicalFilesystemPath,
  filesystemPathKey,
} from "@component-atlas/runtime";

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
        stderr || "Git could not inspect repository worktrees.",
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
