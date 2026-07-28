import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SPANISH_UI_MESSAGES } from "../apps/viewer/app/i18n/messages";

const root = fileURLToPath(new URL("../apps/viewer/app", import.meta.url));
const serverRoot = fileURLToPath(
  new URL("../apps/viewer/server", import.meta.url),
);
const memoryRuntime = fileURLToPath(
  new URL("../packages/runtime/src/memory.ts", import.meta.url),
);

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? filesUnder(target)
      : entry.name.endsWith(".vue") || entry.name.endsWith(".ts")
        ? [target]
        : [];
  });
}

function literalTranslationKeys(source: string): string[] {
  const keys: string[] = [];
  const expression = /\bt\(\s*(["'])(.*?)\1/gms;
  for (const match of source.matchAll(expression)) {
    if (match[2] && !match[2].includes("${")) keys.push(match[2]);
  }
  return keys;
}

function literalRuntimeErrors(source: string): string[] {
  const statusMessages = [
    ...source.matchAll(/\bstatusMessage:\s*(["'])(.*?)\1/gms),
  ].map((match) => match[2] ?? "");
  const thrownMessages = [
    ...source.matchAll(/\bthrow new Error\(\s*(["'])(.*?)\1/gms),
  ].map((match) => match[2] ?? "");
  return [...statusMessages, ...thrownMessages].filter(
    (message) => Boolean(message) && message !== "not-directory",
  );
}

const DYNAMIC_UI_VALUES = [
  "new", "in-review", "awaiting-decision", "mitigated", "resolved",
  "accepted", "deferred", "dismissed", "reviewed", "superseded", "stale",
  "critical", "high", "medium", "low", "info", "run", "evidence",
  "until-date", "project", "repository", "design", "memory", "task",
  "agent", "integration", "domain", "glossary-term", "subsystem", "module",
  "convention", "decision", "constraint", "known-issue", "fragile-area",
  "attempt", "outcome", "plan", "debt", "note", "proposed", "active",
  "archived", "rejected", "observed", "inferred", "decided", "verified",
  "canonical", "canonical-candidate", "canonical-stored", "local-only",
  "declined", "lesson", "local", "episodic", "belongs_to", "depends_on",
  "implements", "affects", "decided_by", "motivated_by", "contradicts",
  "supersedes", "verified_by", "failed_for", "fixed_by", "related_to",
  "references_code", "references_design", "references_ticket", "markdown",
  "agent-proposal", "task-outcome", "legacy-decision", "import", "combined",
  "authenticated", "unauthenticated", "needs-input", "implemented",
  "prepared", "run-started", "activity", "question", "approval", "result",
  "usage", "session-report", "design-index", "local-index", "route",
  "layout", "component", "public", "private", "feature",
] as const;

const ALLOWED_UNTRANSLATED_TEMPLATE_TEXT = new Set([
  "Project Atlas",
  "Codex",
  "Figma",
  "Jira",
  "Confluence",
  "GitHub",
  "OpenAPI / Swagger",
  "Ctrl K",
  "Esc",
  "EN",
  "ES",
]);

function scatteredTemplateStrings(source: string): string[] {
  const template = source.slice(source.indexOf("<template"));
  const textNodes = [...template.matchAll(/>\s*([^<>{}\r\n]+?)\s*</gu)]
    .map((match) => match[1]?.trim() ?? "")
    .filter((value) => /\p{L}/u.test(value));
  const rawAccessibleAttributes = [
    ...template.matchAll(
      /\s(?:aria-label|title|placeholder)="(?!:)([^"]*\p{L}[^"]*)"/gu,
    ),
  ].map((match) => match[1]?.trim() ?? "");
  return [...textNodes, ...rawAccessibleAttributes].filter(
    (value) =>
      !ALLOWED_UNTRANSLATED_TEMPLATE_TEXT.has(value) &&
      !/^[A-Za-z]:\\/.test(value),
  );
}

describe("Project Atlas UI translation coverage", () => {
  it("provides Spanish copy for every literal UI translation key", () => {
    const missing = filesUnder(root)
      .flatMap((file) =>
        literalTranslationKeys(readFileSync(file, "utf8")).map((key) => ({
          file: path.relative(root, file).replaceAll("\\", "/"),
          key,
        })),
      )
      .filter(({ key }) => !(key in SPANISH_UI_MESSAGES));

    expect(missing).toEqual([]);
  });

  it("keeps the critical bilingual surfaces wired to semantic localizers", () => {
    const actionCenter = readFileSync(
      path.join(root, "components/RisksView.vue"),
      "utf8",
    );
    const inbox = readFileSync(
      path.join(root, "components/MemoryInboxView.vue"),
      "utf8",
    );
    expect(actionCenter).toContain("localizeActionCenterItem");
    expect(inbox).toContain("localizeMemoryFinding");
  });

  it("localizes every dynamic status, scope, relation, and provenance label", () => {
    expect(
      DYNAMIC_UI_VALUES.filter((value) => !(value in SPANISH_UI_MESSAGES)),
    ).toEqual([]);
  });

  it("catalogs literal server and semantic-memory errors shown by the UI", () => {
    const missing = [
      ...filesUnder(serverRoot),
      memoryRuntime,
    ]
      .flatMap((file) =>
        literalRuntimeErrors(readFileSync(file, "utf8")).map((key) => ({
          file: path.relative(root, file).replaceAll("\\", "/"),
          key,
        })),
      )
      .filter(({ key }) => !(key in SPANISH_UI_MESSAGES));

    expect(missing).toEqual([]);
  });

  it("stores Figma sync UI state as semantic keys, not translated snapshots", () => {
    const page = readFileSync(path.join(root, "pages/index.vue"), "utf8");
    expect(page).not.toMatch(/designSyncState[\s\S]{0,180}message:\s*t\(/);
  });

  it("rejects scattered literal UI copy outside the translation catalog", () => {
    const scattered = filesUnder(root)
      .filter((file) => file.endsWith(".vue"))
      .flatMap((file) =>
        scatteredTemplateStrings(readFileSync(file, "utf8")).map((text) => ({
          file: path.relative(root, file).replaceAll("\\", "/"),
          text,
        })),
      );

    expect(scattered).toEqual([]);
  });
});
