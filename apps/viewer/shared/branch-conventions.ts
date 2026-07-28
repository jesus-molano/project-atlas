export const BRANCH_PREFIXES = [
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
] as const;

export type BranchPrefix = (typeof BRANCH_PREFIXES)[number];

export function isBranchPrefix(value: unknown): value is BranchPrefix {
  return (
    typeof value === "string" &&
    (BRANCH_PREFIXES as readonly string[]).includes(value)
  );
}

export function branchNameFromParts(
  prefix: BranchPrefix,
  inputName: string,
): string {
  const slug = inputName
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80)
    .replace(/[. -]+$/g, "");
  if (!slug || slug.endsWith(".lock")) {
    throw new Error("Branch name is invalid.");
  }
  return `${prefix}/${slug}`;
}
