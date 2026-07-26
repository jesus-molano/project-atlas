export interface SecretFinding {
  path: string;
  kind: string;
}

const SECRET_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "private-key", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  {
    kind: "assigned-secret",
    pattern:
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|passwd)\b\s*[:=]\s*["']?[^\s"',;]{8,}/i,
  },
  { kind: "github-token", pattern: /\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b/ },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/ },
  { kind: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "generic-api-token", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

export function findSecretLikeContent(value: unknown): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const pending: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: "", depth: 0 },
  ];
  const visited = new WeakSet<object>();
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    visitedNodes += 1;
    if (visitedNodes > 10_000) {
      throw new Error(
        "Memory write rejected because content exceeds the 10,000-node safety limit.",
      );
    }
    if (current.depth > 64) {
      throw new Error(
        "Memory write rejected because content exceeds the 64-level safety limit.",
      );
    }
    if (typeof current.value === "string") {
      for (const candidate of SECRET_PATTERNS) {
        if (candidate.pattern.test(current.value)) {
          findings.push({ path: current.path, kind: candidate.kind });
        }
      }
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (visited.has(current.value)) continue;
    visited.add(current.value);

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: current.value[index],
          path: `${current.path}[${index}]`,
          depth: current.depth + 1,
        });
      }
      continue;
    }
    const entries = Object.entries(current.value as Record<string, unknown>);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index]!;
      pending.push({
        value: child,
        path: current.path ? `${current.path}.${key}` : key,
        depth: current.depth + 1,
      });
    }
  }
  return findings;
}

export function assertMemoryContentSafe(value: unknown): void {
  const findings = findSecretLikeContent(value);
  if (findings.length === 0) return;
  const summary = findings
    .slice(0, 5)
    .map((finding) => `${finding.kind} at ${finding.path || "content"}`)
    .join(", ");
  throw new Error(
    `Memory write rejected because secret-like content was detected (${summary}). Store credentials in an approved secret manager and reference them by name only.`,
  );
}
