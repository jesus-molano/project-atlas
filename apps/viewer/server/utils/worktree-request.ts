import path from "node:path";
import { createError } from "h3";
import {
  branchNameFromParts,
  isBranchPrefix,
  type BranchPrefix,
} from "../../shared/branch-conventions";

function requiredText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    /[\u0000-\u001f]/.test(value)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} is invalid.`,
    });
  }
  return value.trim();
}

export function parseWorktreePreviewRequest(body: unknown): {
  branch: string;
} {
  const input =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  return {
    branch: requiredText(input.branch, "Local branch", 255),
  };
}

export function parseWorktreeCreateRequest(body: unknown): {
  branch: string;
  expectedHead: string;
  worktreePath: string;
} {
  const input =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const expectedHead = commitHead(input.expectedHead, "Expected HEAD");
  const worktreePath = absoluteWorktreePath(input.worktreePath);
  return {
    branch: requiredText(input.branch, "Local branch", 255),
    expectedHead,
    worktreePath,
  };
}

function commitHead(value: unknown, label: string): string {
  const expectedHead = requiredText(value, label, 64);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(expectedHead)) {
    throw createError({
      statusCode: 400,
      statusMessage: `${label} is invalid.`,
    });
  }
  return expectedHead;
}

function absoluteWorktreePath(value: unknown): string {
  const worktreePath = requiredText(value, "Worktree path", 1_024);
  if (!path.isAbsolute(worktreePath)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Worktree path must be absolute.",
    });
  }
  return worktreePath;
}

function newBranchParts(body: unknown): {
  branchType: BranchPrefix;
  branchNameInput: string;
} {
  const input =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  if (!isBranchPrefix(input.branchType)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Branch type is invalid.",
    });
  }
  const branchNameInput = requiredText(input.branchNameInput, "Branch name", 120);
  try {
    branchNameFromParts(input.branchType, branchNameInput);
  } catch {
    throw createError({
      statusCode: 400,
      statusMessage: "Branch name is invalid.",
    });
  }
  return {
    branchType: input.branchType,
    branchNameInput,
  };
}

export function parseBranchPreviewRequest(body: unknown): {
  branchType: BranchPrefix;
  branchNameInput: string;
} {
  return newBranchParts(body);
}

export function parseBranchCreateRequest(body: unknown): {
  branchType: BranchPrefix;
  branchNameInput: string;
  expectedBaseHead: string;
  sourceWorktreePath: string;
  worktreePath: string;
} {
  const input =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  return {
    ...newBranchParts(input),
    expectedBaseHead: commitHead(input.expectedBaseHead, "Expected base HEAD"),
    sourceWorktreePath: absoluteWorktreePath(input.sourceWorktreePath),
    worktreePath: absoluteWorktreePath(input.worktreePath),
  };
}
