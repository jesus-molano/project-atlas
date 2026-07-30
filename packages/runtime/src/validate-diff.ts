import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadProjectGraph } from "./scan.js";

const execFileAsync = promisify(execFile);

export type DiffFindingCode =
  | "new-visual-literal"
  | "existing-primitive"
  | "foreign-breakpoint"
  | "missing-interactive-state"
  | "openapi-incompatible";

export interface DiffValidationFinding {
  code: DiffFindingCode;
  severity: "warning";
  file?: string;
  line?: number;
  message: string;
  evidence: string[];
  recommendation: string;
}

export interface ValidateDiffOptions {
  confirmedOperations?: Array<{
    method: string;
    path: string;
    operationId?: string;
  }>;
}

export interface ValidateDiffResult {
  schemaVersion: 1;
  fingerprintHash?: string;
  files: number;
  additions: number;
  findings: DiffValidationFinding[];
  blocking: false;
}

interface Addition {
  file: string;
  line: number;
  text: string;
}

function parseDiff(diff: string): Addition[] {
  const additions: Addition[] = [];
  let file = "";
  let nextLine = 0;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/u);
    if (hunk) {
      nextLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions.push({ file, line: nextLine, text: line.slice(1) });
      nextLine += 1;
    } else if (!line.startsWith("-") && !line.startsWith("\\")) {
      nextLine += 1;
    }
  }
  return additions;
}

async function localAdditions(rootPath: string): Promise<Addition[]> {
  const { stdout: diff } = await execFileAsync(
    "git",
    ["diff", "--no-ext-diff", "--unified=0", "--", "."],
    { cwd: rootPath, maxBuffer: 8_000_000, windowsHide: true },
  );
  const additions = parseDiff(diff);
  const { stdout: untracked } = await execFileAsync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: rootPath, maxBuffer: 2_000_000, windowsHide: true },
  );
  for (const relative of untracked.split("\0").filter(Boolean).slice(0, 200)) {
    const absolute = path.resolve(rootPath, relative);
    if (
      path.relative(rootPath, absolute).startsWith("..") ||
      !/\.(?:css|scss|sass|less|vue|astro|jsx?|tsx?)$/iu.test(relative)
    ) {
      continue;
    }
    const source = await readFile(absolute, "utf8");
    if (source.length > 1_000_000) continue;
    source.split(/\r?\n/u).forEach((text, index) => {
      additions.push({ file: relative.replaceAll("\\", "/"), line: index + 1, text });
    });
  }
  return additions;
}

function visualLiteral(text: string): string | undefined {
  if (/--[a-z0-9_-]+\s*:/iu.test(text)) return undefined;
  return text.match(
    /(?:#[0-9a-f]{3,8}|(?:rgb|hsl|oklch|lab|lch)a?\([^)]+\)|\b\d+(?:\.\d+)?(?:px|rem|em)\b)/iu,
  )?.[0];
}

export async function validateDiff(
  rootPathInput: string,
  options: ValidateDiffOptions = {},
): Promise<ValidateDiffResult> {
  const rootPath = path.resolve(rootPathInput);
  const graph = await loadProjectGraph(rootPath);
  const fingerprint = graph.themeFingerprint;
  const additions = await localAdditions(rootPath);
  const findings: DiffValidationFinding[] = [];
  const tokenValues = new Set(
    graph.tokens.map((token) => token.value.trim().toLowerCase()),
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
        recommendation: "Reuse an existing project token or explicitly add and document a new token.",
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
        recommendation: "Use a project breakpoint unless this new threshold is intentional.",
      });
    }
    for (const primitive of fingerprint?.primitives ?? []) {
      if (
        new RegExp(`<(?:div|span)[^>]+(?:class|data-component)=["'][^"']*${primitive.name}`, "iu")
          .test(addition.text)
      ) {
        findings.push({
          code: "existing-primitive",
          severity: "warning",
          file: addition.file,
          line: addition.line,
          message: `${primitive.name} already exists as a frequently used project primitive.`,
          evidence: [`${primitive.uses} indexed uses`],
          recommendation: "Inspect and reuse or extend the existing primitive before recreating it.",
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
      message: "New interactive UI has no visible focus, disabled, error, or loading evidence.",
      evidence: fingerprint?.patterns.interactiveStates.slice(0, 8) ?? [],
      recommendation: "Match the comparable project states or record why a state does not apply.",
    });
  }
  const confirmed = options.confirmedOperations ?? [];
  for (const match of joined.matchAll(
    /(?:\$fetch|useFetch|fetch|axios\.(?:get|post|put|patch|delete))\(\s*["']([^"']+)["']/giu,
  )) {
    const route = match[1]!;
    if (
      confirmed.length > 0 &&
      !confirmed.some((operation) => operation.path === route)
    ) {
      findings.push({
        code: "openapi-incompatible",
        severity: "warning",
        message: `${route} is not present in the explicitly confirmed OpenAPI operations.`,
        evidence: confirmed.slice(0, 8).map((operation) => `${operation.method} ${operation.path}`),
        recommendation: "Use the confirmed method/path or resolve the governing contract before implementation.",
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
  return {
    schemaVersion: 1,
    ...(fingerprint ? { fingerprintHash: fingerprint.hash } : {}),
    files: new Set(additions.map((addition) => addition.file)).size,
    additions: additions.length,
    findings: unique.slice(0, 40),
    blocking: false,
  };
}
