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

function visit(
  value: unknown,
  path: string,
  findings: SecretFinding[],
): void {
  if (typeof value === "string") {
    for (const candidate of SECRET_PATTERNS) {
      if (candidate.pattern.test(value)) {
        findings.push({ path, kind: candidate.kind });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, findings));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    visit(child, path ? `${path}.${key}` : key, findings);
  }
}

export function findSecretLikeContent(value: unknown): SecretFinding[] {
  const findings: SecretFinding[] = [];
  visit(value, "", findings);
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
