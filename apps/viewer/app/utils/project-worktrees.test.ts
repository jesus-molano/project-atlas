import { describe, expect, it } from "vitest";
import {
  branchAction,
  defaultNewBranchBase,
  detachedRepositoryWorktrees,
  type ProjectRepositoryState,
  type RepositoryBranch,
} from "./project-worktrees";

const branch = (
  value: Partial<RepositoryBranch> = {},
): RepositoryBranch => ({
  name: "feature/local",
  head: "a".repeat(40),
  shortHead: "a".repeat(10),
  isCurrent: false,
  hasProjectManifest: true,
  ...value,
});
describe("project worktree selector UI state", () => {
  it("chooses an explicit action for every local branch state", () => {
    expect(branchAction(branch({ isCurrent: true }))).toBe("current");
    expect(
      branchAction(
        branch({
          worktree: {
            path: "/repo-release",
            name: "repo-release",
            branch: "release",
            head: "a".repeat(40),
            isCurrent: false,
            isPrimary: false,
            available: true,
            locked: false,
            prunable: false,
          },
        }),
      ),
    ).toBe("open-worktree");
    expect(branchAction(branch())).toBe("create-worktree");
    expect(branchAction(branch({ hasProjectManifest: false }))).toBe(
      "unsupported",
    );
  });

  it("keeps detached worktrees visible outside branch rows", () => {
    const assigned = {
      path: "/repo",
      name: "repo",
      branch: "main",
      head: "a".repeat(40),
      isCurrent: true,
      isPrimary: true,
      available: true,
      locked: false,
      prunable: false,
    };
    const detached = {
      path: "/repo-detached",
      name: "repo-detached",
      head: "b".repeat(40),
      isCurrent: false,
      isPrimary: false,
      available: true,
      locked: false,
      prunable: false,
    };
    const repository: ProjectRepositoryState = {
      logicalProjectPath: "/repo",
      logicalProjectName: "repo",
      activeRoot: "/repo",
      branches: [branch({ name: "main", isCurrent: true, worktree: assigned })],
      worktrees: [assigned, detached],
      checkedAt: new Date(0).toISOString(),
    };

    expect(detachedRepositoryWorktrees(repository)).toEqual([detached]);
  });

  it("prefers an eligible current base and falls back to the primary branch", () => {
    const primary = {
      path: "/repo",
      name: "repo",
      branch: "main",
      head: "a".repeat(40),
      isCurrent: false,
      isPrimary: true,
      available: true,
      locked: false,
      prunable: false,
    };
    const repository: ProjectRepositoryState = {
      logicalProjectPath: "/repo",
      logicalProjectName: "repo",
      activeRoot: "/repo-linked",
      branches: [
        branch({
          name: "docs/no-manifest",
          isCurrent: true,
          hasProjectManifest: false,
        }),
        branch({ name: "main", worktree: primary }),
        branch({ name: "release/a-very-long-base-branch-name" }),
      ],
      worktrees: [primary],
      checkedAt: new Date(0).toISOString(),
    };

    expect(defaultNewBranchBase(repository)).toBe("main");
    repository.branches[2]!.isCurrent = true;
    expect(defaultNewBranchBase(repository)).toBe(
      "release/a-very-long-base-branch-name",
    );
  });
});
