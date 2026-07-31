import path from "node:path";
import type { ComponentGraph } from "@component-atlas/core";
import {
  captureGitDelta,
  compareGitDelta,
  type GitDeltaCaptureLimits,
  type GitDeltaEntry,
  type GitDeltaLine,
  type GitDeltaResult,
} from "./git-delta.js";
import {
  computeScopedChangeSurfaceFingerprints,
  type ScopedChangeSurfaceFingerprints,
} from "./change-surface-fingerprint.js";
import {
  assertLockedChangeSurfaceArtifact,
  type LockedChangeSurface,
} from "./change-surface-lock.js";
import { loadProjectGraph, scanProject } from "./scan.js";

export type DiffFindingCode =
  | "new-visual-literal"
  | "existing-primitive"
  | "foreign-breakpoint"
  | "missing-interactive-state"
  | "openapi-incompatible"
  | "out-of-scope-change"
  | "excluded-surface-change"
  | "git-delta-truncated"
  | "git-baseline-unavailable"
  | "change-surface-integrity"
  | "project-graph-drift"
  | "theme-contract-drift"
  | "theme-change-within-scope";

export interface DiffValidationFinding {
  code: DiffFindingCode;
  severity: "warning" | "error";
  file?: string;
  line?: number;
  message: string;
  evidence: string[];
  recommendation: string;
}

export interface ConfirmedOperation {
  method: string;
  path: string;
  operationId?: string;
}

export interface ValidateDiffOptions {
  confirmedOperations?: ConfirmedOperation[];
  requireConfirmedOperations?: boolean;
  changeSurface?: LockedChangeSurface;
  gitLimits?: GitDeltaCaptureLimits;
}

export interface ValidateDiffResult {
  schemaVersion: 1;
  deltaHash: string;
  fingerprintHash?: string;
  files: number;
  additions: number;
  deletions: number;
  renames: number;
  changedFiles: GitDeltaEntry[];
  truncated: boolean;
  findings: DiffValidationFinding[];
  blocking: boolean;
}

interface ApiCall {
  method: string;
  path: string;
  file: string;
  line?: number;
}

function visualLiteral(text: string): string | undefined {
  if (/--[a-z0-9_-]+\s*:/iu.test(text)) return undefined;
  return text.match(
    /(?:#[0-9a-f]{3,8}|(?:rgb|hsl|oklch|lab|lch)a?\([^)]+\)|\b\d+(?:\.\d+)?(?:px|rem|em)\b)/iu,
  )?.[0];
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function comparisonPath(value: string): string {
  const normalized = normalizedPath(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function wildcardExpression(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("?", "[^/]")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`, process.platform === "win32" ? "iu" : "u");
}

function matchesExclusion(file: string, exclusion: string): boolean {
  const normalizedFile = normalizedPath(file);
  const normalizedExclusion = normalizedPath(exclusion);
  if (/[*?]/u.test(normalizedExclusion)) {
    return wildcardExpression(normalizedExclusion).test(normalizedFile);
  }
  const comparedFile = comparisonPath(normalizedFile);
  const comparedExclusion = comparisonPath(normalizedExclusion).replace(/\/$/u, "");
  if (
    comparedFile === comparedExclusion ||
    comparedFile.startsWith(`${comparedExclusion}/`)
  ) {
    return true;
  }
  const fileName = path.posix.basename(comparedFile).replace(/\.[^.]+$/u, "");
  const excludedName = path.posix
    .basename(comparedExclusion)
    .replace(/\.[^.]+$/u, "");
  return fileName === excludedName;
}

function changedEntryPaths(entry: GitDeltaEntry): string[] {
  return [entry.path, ...(entry.previousPath ? [entry.previousPath] : [])];
}

function scopeFindings(
  changeSurface: LockedChangeSurface,
  delta: GitDeltaResult,
): DiffValidationFinding[] {
  const allowed = new Set(changeSurface.allowedFiles.map(comparisonPath));
  const findings: DiffValidationFinding[] = [];
  const visited = new Set<string>();
  for (const entry of delta.entries) {
    for (const file of changedEntryPaths(entry)) {
      const normalized = normalizedPath(file);
      if (visited.has(normalized)) continue;
      visited.add(normalized);
      const excludedBy = changeSurface.exclusions.find((candidate) =>
        matchesExclusion(normalized, candidate),
      );
      if (excludedBy) {
        findings.push({
          code: "excluded-surface-change",
          severity: "error",
          file: normalized,
          message: `${normalized} matches the locked exclusion ${excludedBy}.`,
          evidence: [
            `lock:${changeSurface.lockId}`,
            `exclusion:${excludedBy}`,
            `status:${entry.status}`,
          ],
          recommendation:
            "Revert the excluded change or explicitly invalidate and relock the task scope before continuing.",
        });
        continue;
      }
      if (!allowed.has(comparisonPath(normalized))) {
        findings.push({
          code: "out-of-scope-change",
          severity: "error",
          file: normalized,
          message: `${normalized} is outside the locked allowedFiles set.`,
          evidence: [
            `lock:${changeSurface.lockId}`,
            `status:${entry.status}`,
            ...changeSurface.allowedFiles.slice(0, 8),
          ],
          recommendation:
            "Revert the escaped change or explicitly invalidate and relock the task scope.",
        });
      }
    }
  }
  return findings;
}

function fingerprintFindings(
  changeSurface: LockedChangeSurface,
  current: ScopedChangeSurfaceFingerprints,
): DiffValidationFinding[] {
  const locked = changeSurface.evidence.fingerprints;
  const findings: DiffValidationFinding[] = [];
  if (locked.graph !== current.graph) {
    findings.push({
      code: "project-graph-drift",
      severity: "error",
      message:
        "Project graph evidence outside allowedFiles changed after the ChangeSurface was locked.",
      evidence: [
        `lock:${changeSurface.lockId}`,
        `locked:${locked.graph}`,
        `current:${current.graph}`,
      ],
      recommendation:
        "Inspect the external graph change, then revert it or explicitly invalidate and relock the task.",
    });
  }
  if (locked.scopedTheme !== current.scopedTheme) {
    findings.push({
      code: "theme-contract-drift",
      severity: "error",
      message:
        "Theme evidence outside allowedFiles changed after the ChangeSurface was locked.",
      evidence: [
        `lock:${changeSurface.lockId}`,
        `locked:${locked.scopedTheme ?? "none"}`,
        `current:${current.scopedTheme ?? "none"}`,
      ],
      recommendation:
        "Inspect the external token/theme change, then revert it or explicitly invalidate and relock the task.",
    });
  } else if (locked.theme !== current.theme) {
    findings.push({
      code: "theme-change-within-scope",
      severity: "warning",
      message:
        "The aggregate theme fingerprint changed, but all external theme evidence remains locked.",
      evidence: [
        `lock:${changeSurface.lockId}`,
        `locked:${locked.theme ?? "none"}`,
        `current:${current.theme ?? "none"}`,
      ],
      recommendation:
        "Confirm that the theme delta is fully explained by allowedFiles and include that evidence in the handoff.",
    });
  }
  return findings;
}

function normalizedOperationPath(value: string): string {
  const [withoutQuery] = value.split(/[?#]/u);
  const normalized = withoutQuery || "/";
  return normalized.length > 1 ? normalized.replace(/\/$/u, "") : normalized;
}

function sourceLine(
  lines: Array<GitDeltaLine & { text: string }>,
  source: string,
  offset: number,
): number | undefined {
  const lineOffset = source.slice(0, offset).split("\n").length - 1;
  return lines[Math.min(lineOffset, lines.length - 1)]?.line;
}

function apiCalls(lines: GitDeltaLine[]): ApiCall[] {
  const byFile = new Map<string, Array<GitDeltaLine & { text: string }>>();
  for (const line of lines) {
    if (line.kind !== "addition" || line.text === undefined) continue;
    const bucket = byFile.get(line.file) ?? [];
    bucket.push(line as GitDeltaLine & { text: string });
    byFile.set(line.file, bucket);
  }
  const calls: ApiCall[] = [];
  for (const [file, additions] of byFile) {
    additions.sort((left, right) => left.line - right.line);
    const source = additions.map((line) => line.text).join("\n");
    for (const match of source.matchAll(
      /\baxios\.(get|post|put|patch|delete|head|options)\s*\(\s*(["'])([^"']+)\2/giu,
    )) {
      const line = sourceLine(additions, source, match.index);
      calls.push({
        method: match[1]!.toUpperCase(),
        path: normalizedOperationPath(match[3]!),
        file,
        ...(line !== undefined ? { line } : {}),
      });
    }
    for (const match of source.matchAll(
      /(?:\$fetch|useFetch|(?<![.$\w])fetch)\s*\(\s*(["'])([^"']+)\1/giu,
    )) {
      const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 800);
      const end = tail.search(/\)\s*(?:[;,]|$)/u);
      const options = end >= 0 ? tail.slice(0, end) : tail;
      const explicitMethod = options.match(
        /\bmethod\s*:\s*(["'])(get|post|put|patch|delete|head|options)\1/iu,
      )?.[2];
      const line = sourceLine(additions, source, match.index);
      calls.push({
        method: (explicitMethod ?? "GET").toUpperCase(),
        path: normalizedOperationPath(match[2]!),
        file,
        ...(line !== undefined ? { line } : {}),
      });
    }
  }
  return calls.filter(
    (call, index, collection) =>
      collection.findIndex(
        (candidate) =>
          candidate.method === call.method &&
          candidate.path === call.path &&
          candidate.file === call.file &&
          candidate.line === call.line,
      ) === index,
  );
}

async function taskDelta(
  rootPath: string,
  options: ValidateDiffOptions,
  findings: DiffValidationFinding[],
): Promise<GitDeltaResult> {
  if (!options.changeSurface) {
    return captureGitDelta(rootPath, options.gitLimits);
  }
  try {
    return await compareGitDelta(
      rootPath,
      options.changeSurface.gitBaseline,
      options.gitLimits,
    );
  } catch (error) {
    findings.push({
      code: "git-baseline-unavailable",
      severity: "error",
      message: "The locked Git baseline could not be loaded or verified.",
      evidence: [
        options.changeSurface.gitBaseline.handle,
        error instanceof Error ? error.message : String(error),
      ],
      recommendation:
        "Stop validation and explicitly relock the task after resolving the missing or corrupt baseline.",
    });
    return captureGitDelta(rootPath, options.gitLimits);
  }
}

export async function validateDiff(
  rootPathInput: string,
  options: ValidateDiffOptions = {},
): Promise<ValidateDiffResult> {
  const rootPath = path.resolve(rootPathInput);
  const findings: DiffValidationFinding[] = [];
  let trustedChangeSurface = options.changeSurface;
  if (trustedChangeSurface) {
    try {
      await assertLockedChangeSurfaceArtifact(
        rootPath,
        trustedChangeSurface.taskId,
        trustedChangeSurface,
      );
    } catch (error) {
      findings.push({
        code: "change-surface-integrity",
        severity: "error",
        message:
          "The ChangeSurface failed capsule integrity or immutable-artifact verification.",
        evidence: [
          `lock:${trustedChangeSurface.lockId}`,
          error instanceof Error ? error.message : String(error),
        ],
        recommendation:
          "Stop validation and explicitly relock the task before trusting its scope or baseline.",
      });
      trustedChangeSurface = undefined;
    }
  }
  const { changeSurface: _untrustedSurface, ...unlockedOptions } = options;
  const delta = await taskDelta(
    rootPath,
    trustedChangeSurface ? options : unlockedOptions,
    findings,
  );
  let graph: ComponentGraph | undefined;
  if (trustedChangeSurface) {
    try {
      graph = await scanProject(rootPath, { writeArtifacts: false });
    } catch (error) {
      findings.push({
        code: "project-graph-drift",
        severity: "error",
        message:
          "The current project graph could not be rebuilt against the locked ChangeSurface.",
        evidence: [
          `lock:${trustedChangeSurface.lockId}`,
          error instanceof Error ? error.message : String(error),
        ],
        recommendation:
          "Restore a scannable project state, then validate again or explicitly invalidate and relock the task.",
      });
      graph = await loadProjectGraph(rootPath, { scanIfMissing: false }).catch(
        () => undefined,
      );
    }
  } else if (options.changeSurface) {
    graph = await loadProjectGraph(rootPath, { scanIfMissing: false }).catch(
      () => undefined,
    );
  } else {
    graph = await loadProjectGraph(rootPath);
  }
  const fingerprint = graph?.themeFingerprint;
  if (delta.truncated) {
    findings.push({
      code: "git-delta-truncated",
      severity: "error",
      message: "The complete Git delta could not be represented within the configured safety limits.",
      evidence: delta.truncationReasons,
      recommendation:
        "Reduce the change set or raise the explicit capture limits, then relock if the baseline itself was truncated.",
    });
  }
  let scopedFingerprints: ScopedChangeSurfaceFingerprints | undefined;
  if (trustedChangeSurface && graph) {
    scopedFingerprints = computeScopedChangeSurfaceFingerprints(
      graph,
      trustedChangeSurface.allowedFiles,
    );
    findings.push(
      ...fingerprintFindings(trustedChangeSurface, scopedFingerprints),
      ...scopeFindings(trustedChangeSurface, delta),
    );
  }

  const additions = delta.lines.filter(
    (line): line is GitDeltaLine & { text: string } =>
      line.kind === "addition" && line.text !== undefined,
  );
  const tokenValues = new Set(
    (graph?.tokens ?? []).map((token) => token.value.trim().toLowerCase()),
  );
  const knownBreakpoints = new Set(
    fingerprint?.values.breakpoints.map((value) => value.trim().toLowerCase()) ??
      [],
  );
  for (const addition of additions) {
    const literal = visualLiteral(addition.text);
    if (
      literal &&
      !tokenValues.has(literal.toLowerCase()) &&
      !/^(?:0|1|2|100)%?$/u.test(literal)
    ) {
      findings.push({
        code: "new-visual-literal",
        severity: "warning",
        file: addition.file,
        line: addition.line,
        message: `New visual value ${literal} is not represented by an indexed token.`,
        evidence: [literal],
        recommendation:
          "Reuse an existing project token or explicitly add and document a new token.",
      });
    }
    const breakpoint = addition.text.match(
      /(?:min|max)-width\s*:\s*([^)]+)/iu,
    )?.[1]?.trim();
    if (
      breakpoint &&
      knownBreakpoints.size > 0 &&
      !knownBreakpoints.has(breakpoint.toLowerCase())
    ) {
      findings.push({
        code: "foreign-breakpoint",
        severity: "warning",
        file: addition.file,
        line: addition.line,
        message: `Breakpoint ${breakpoint} is outside the project fingerprint.`,
        evidence: [...knownBreakpoints].slice(0, 6),
        recommendation:
          "Use a project breakpoint unless this new threshold is intentional.",
      });
    }
    for (const primitive of fingerprint?.primitives ?? []) {
      if (
        new RegExp(
          `<(?:div|span)[^>]+(?:class|data-component)=["'][^"']*${primitive.name}`,
          "iu",
        ).test(addition.text)
      ) {
        findings.push({
          code: "existing-primitive",
          severity: "warning",
          file: addition.file,
          line: addition.line,
          message: `${primitive.name} already exists as a frequently used project primitive.`,
          evidence: [`${primitive.uses} indexed uses`],
          recommendation:
            "Inspect and reuse or extend the existing primitive before recreating it.",
        });
      }
    }
  }
  const joined = additions.map((addition) => addition.text).join("\n");
  if (
    /<(?:button|input|select|textarea)\b/iu.test(joined) &&
    !/(?:focus|disabled|error|loading)/iu.test(joined) &&
    (fingerprint?.patterns.interactiveStates.length ?? 0) > 0
  ) {
    findings.push({
      code: "missing-interactive-state",
      severity: "warning",
      message:
        "New interactive UI has no visible focus, disabled, error, or loading evidence.",
      evidence: fingerprint?.patterns.interactiveStates.slice(0, 8) ?? [],
      recommendation:
        "Match the comparable project states or record why a state does not apply.",
    });
  }

  const confirmed = (options.confirmedOperations ?? []).map((operation) => ({
    ...operation,
    method: operation.method.toUpperCase(),
    path: normalizedOperationPath(operation.path),
  }));
  for (const call of apiCalls(delta.lines)) {
    if (
      (confirmed.length > 0 || options.requireConfirmedOperations) &&
      !confirmed.some(
        (operation) =>
          operation.method === call.method && operation.path === call.path,
      )
    ) {
      findings.push({
        code: "openapi-incompatible",
        severity: "error",
        file: call.file,
        ...(call.line ? { line: call.line } : {}),
        message: `${call.method} ${call.path} is not present in the explicitly confirmed OpenAPI operations.`,
        evidence: confirmed
          .slice(0, 8)
          .map((operation) => `${operation.method} ${operation.path}`),
        recommendation:
          "Use the receipt-bound method/path or explicitly resolve and relock the governing contract before implementation.",
      });
    }
  }
  const unique = findings.filter(
    (finding, index, collection) =>
      collection.findIndex(
        (candidate) =>
          candidate.code === finding.code &&
          candidate.file === finding.file &&
          candidate.line === finding.line &&
          candidate.message === finding.message,
      ) === index,
  );
  const prioritized = unique.toSorted(
    (left, right) =>
      (left.severity === right.severity
        ? 0
        : left.severity === "error"
          ? -1
          : 1) ||
      (left.file ?? "").localeCompare(right.file ?? "") ||
      (left.line ?? 0) - (right.line ?? 0) ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
  return {
    schemaVersion: 1,
    deltaHash: delta.deltaHash,
    ...(scopedFingerprints
      ? { fingerprintHash: scopedFingerprints.graph }
      : fingerprint
        ? { fingerprintHash: fingerprint.hash }
        : {}),
    files: delta.files,
    additions: delta.additions,
    deletions: delta.deletions,
    renames: delta.renames,
    changedFiles: delta.entries,
    truncated: delta.truncated,
    findings: prioritized.slice(0, 80),
    blocking: unique.some((finding) => finding.severity === "error"),
  };
}
