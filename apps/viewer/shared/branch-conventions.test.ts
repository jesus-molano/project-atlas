import { describe, expect, it } from "vitest";
import {
  BRANCH_PREFIXES,
  branchNameFromParts,
  isBranchPrefix,
} from "./branch-conventions";

describe("branch naming conventions", () => {
  it("offers conventional commit-style prefixes including hotfix", () => {
    expect(BRANCH_PREFIXES).toEqual([
      "feat",
      "fix",
      "hotfix",
      "refactor",
      "perf",
      "docs",
      "test",
      "chore",
      "build",
      "ci",
      "revert",
    ]);
    expect(isBranchPrefix("feat")).toBe(true);
    expect(isBranchPrefix("feature")).toBe(false);
  });

  it("turns a human name into a safe, readable local branch", () => {
    expect(branchNameFromParts("feat", "Selector de Proyectos")).toBe(
      "feat/selector-de-proyectos",
    );
    expect(branchNameFromParts("hotfix", "  Windows / focus crash  ")).toBe(
      "hotfix/windows-focus-crash",
    );
    expect(branchNameFromParts("fix", "focus..state")).toBe(
      "fix/focus-state",
    );
    expect(() => branchNameFromParts("fix", "---")).toThrow(
      "Branch name is invalid",
    );
    expect(() => branchNameFromParts("fix", "release.lock")).toThrow(
      "Branch name is invalid",
    );
  });
});
