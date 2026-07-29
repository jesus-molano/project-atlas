import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseBranchCreateRequest,
  parseBranchPreviewRequest,
  parseWorktreeCreateRequest,
  parseWorktreePreviewRequest,
} from "./worktree-request";

describe("worktree API request contracts", () => {
  it("accepts the exact preview and confirmed creation fields", () => {
    expect(
      parseWorktreePreviewRequest({ branch: "feature/local-selector" }),
    ).toEqual({ branch: "feature/local-selector" });
    expect(
      parseWorktreeCreateRequest({
        branch: "feature/local-selector",
        expectedHead: "a".repeat(40),
        worktreePath: path.resolve("sibling-worktree"),
      }),
    ).toEqual({
      branch: "feature/local-selector",
      expectedHead: "a".repeat(40),
      worktreePath: path.resolve("sibling-worktree"),
    });
    expect(
      parseBranchPreviewRequest({
        branchType: "feat",
        branchNameInput: "Project selector",
        baseBranch: "release/long-lived",
      }),
    ).toEqual({
      branchType: "feat",
      branchNameInput: "Project selector",
      baseBranch: "release/long-lived",
    });
    expect(
      parseBranchCreateRequest({
        branchType: "hotfix",
        branchNameInput: "Project selector crash",
        baseBranch: "release/long-lived",
        expectedBaseHead: "b".repeat(40),
        sourceWorktreePath: path.resolve("source-worktree"),
        worktreePath: path.resolve("hotfix-worktree"),
      }),
    ).toMatchObject({
      branchType: "hotfix",
      branchNameInput: "Project selector crash",
      baseBranch: "release/long-lived",
      expectedBaseHead: "b".repeat(40),
    });
  });

  it("rejects missing, control-character, relative, and malformed confirmation data", () => {
    expect(() => parseWorktreePreviewRequest({})).toThrow(
      "Local branch is invalid",
    );
    expect(() =>
      parseWorktreePreviewRequest({ branch: "feature/\u0000unsafe" }),
    ).toThrow("Local branch is invalid");
    expect(() =>
      parseWorktreeCreateRequest({
        branch: "main",
        expectedHead: "not-a-commit",
        worktreePath: path.resolve("destination"),
      }),
    ).toThrow("Expected HEAD is invalid");
    expect(() =>
      parseWorktreeCreateRequest({
        branch: "main",
        expectedHead: "a".repeat(40),
        worktreePath: "relative/destination",
      }),
    ).toThrow("Worktree path must be absolute");
    expect(() =>
      parseBranchPreviewRequest({
        branchType: "feature",
        branchNameInput: "selector",
        baseBranch: "main",
      }),
    ).toThrow("Branch type is invalid");
    expect(() =>
      parseBranchPreviewRequest({
        branchType: "feat",
        branchNameInput: "---",
        baseBranch: "main",
      }),
    ).toThrow("Branch name is invalid");
    expect(() =>
      parseBranchPreviewRequest({
        branchType: "feat",
        branchNameInput: "selector",
      }),
    ).toThrow("Base branch is invalid");
  });
});
