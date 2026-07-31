import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeLockedChangeSurfaceIntegrity,
  lockTaskChangeSurface,
  scanProject,
  validateDiff,
  type LockedChangeSurface,
} from "./index.js";

const run = promisify(execFile);
const temporary: string[] = [];

async function put(root: string, relative: string, source: string) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
}

afterEach(async () => {
  delete process.env.PROJECT_ATLAS_HOME;
  await Promise.all(
    temporary.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Project Theme Fingerprint and diff validation", () => {
  it("avoids a clean-diff false positive and blocks calls outside confirmed operations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-theme-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await put(
      root,
      "package.json",
      JSON.stringify({ name: "theme-fixture", dependencies: { vue: "^3.5.0" } }),
    );
    await put(
      root,
      "src/theme.css",
      `:root { --color-surface: #fff; --space-2: 0.5rem; }
       button:focus-visible { outline: 2px solid #fff; }
       @media (min-width: 768px) { .grid { display: grid; } }`,
    );
    await put(
      root,
      "src/App.vue",
      `<template><main><UiButton>Save</UiButton></main></template>`,
    );
    await run("git", ["init"], { cwd: root, windowsHide: true });
    await run("git", ["add", "."], { cwd: root, windowsHide: true });
    await run(
      "git",
      [
        "-c",
        "user.name=Atlas Test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root, windowsHide: true },
    );
    const graph = await scanProject(root, { writeArtifacts: false });
    expect(graph.themeFingerprint).toMatchObject({
      schemaVersion: 1,
      values: { breakpoints: ["768px"] },
      patterns: { interactiveStates: ["focus-visible"] },
    });
    const cleanValidation = await validateDiff(root);
    expect(cleanValidation.findings).toEqual([]);
    expect(cleanValidation.deltaHash).toMatch(/^[a-f0-9]{64}$/u);

    const denseVisualWarnings = Array.from(
      { length: 85 },
      (_, index) => `.literal-${index} { padding: ${index + 3}px; }`,
    ).join("\n");
    await put(
      root,
      "src/theme.css",
      `:root { --color-surface: #fff; --space-2: 0.5rem; }
       button:focus-visible { outline: 2px solid #fff; }
       @media (min-width: 768px) { .grid { display: grid; } }
       .new-card { padding: 13px; }
       @media (min-width: 777px) { .new-card { display: grid; } }
       ${denseVisualWarnings}`,
    );
    await put(
      root,
      "src/App.vue",
      `<script setup>fetch("/unconfirmed")</script>
       <template><main><UiButton>Save</UiButton><button>New</button></main></template>`,
    );
    const validation = await validateDiff(root, {
      confirmedOperations: [{ method: "GET", path: "/orders" }],
    });
    const repeated = await validateDiff(root, {
      confirmedOperations: [{ method: "GET", path: "/orders" }],
    });
    expect(repeated.deltaHash).toBe(validation.deltaHash);
    expect(validation.deltaHash).not.toBe(cleanValidation.deltaHash);
    expect(validation.blocking).toBe(true);
    expect(validation.findings).toHaveLength(80);
    expect(validation.findings[0]).toMatchObject({
      code: "openapi-incompatible",
      severity: "error",
    });
    expect(validation.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "new-visual-literal",
        "foreign-breakpoint",
        "missing-interactive-state",
        "openapi-incompatible",
      ]),
    );
  });

  it("uses the lock baseline, blocks scope escapes, and matches OpenAPI by method and path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-locked-diff-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await put(
      root,
      "package.json",
      JSON.stringify({ name: "locked-diff", dependencies: { react: "^19.0.0" } }),
    );
    await put(root, "src/theme.css", ":root { --space-2: 0.5rem; }\n");
    await put(
      root,
      "src/App.tsx",
      "export const App = () => <main>Initial</main>;\n",
    );
    await run("git", ["init"], { cwd: root, windowsHide: true });
    await run("git", ["add", "."], { cwd: root, windowsHide: true });
    await run(
      "git",
      [
        "-c",
        "user.name=Atlas Test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root, windowsHide: true },
    );
    // This dirty file predates the lock and must not be attributed to the task.
    await put(
      root,
      "src/theme.css",
      ":root { --space-2: 0.5rem; }\n.preexisting { padding: 13px; }\n",
    );
    const changeSurface = await lockTaskChangeSurface(root, {
      taskId: "task-locked-diff",
      intent: "Add the confirmed orders request",
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: ["src/App.tsx"],
      exclusions: ["src/Secret.tsx"],
      reuseDecision: {
        decision: "extend",
        rationale: "The existing App component owns the request.",
        selectedComponentIds: ["react:src/App.tsx:App"],
      },
    });
    const beforeTaskChange = await validateDiff(root, { changeSurface });
    expect(beforeTaskChange.files).toBe(0);
    expect(beforeTaskChange.blocking).toBe(false);

    await put(
      root,
      "src/App.tsx",
      `import axios from "axios";
       axios.get("/orders");
       axios.post("/orders");
       export const App = () => <main>Orders</main>;
      `,
    );
    await put(root, "src/Escape.tsx", "export const Escape = () => null;\n");
    await put(root, "src/Secret.tsx", "export const Secret = () => null;\n");
    await run("git", ["add", "src/App.tsx"], { cwd: root, windowsHide: true });

    const validation = await validateDiff(root, {
      changeSurface,
      confirmedOperations: [{ method: "GET", path: "/orders" }],
    });
    expect(validation.blocking).toBe(true);
    expect(validation.changedFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src/App.tsx", staged: true }),
        expect.objectContaining({ path: "src/Escape.tsx", untracked: true }),
        expect.objectContaining({ path: "src/Secret.tsx", untracked: true }),
      ]),
    );
    expect(validation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "out-of-scope-change",
          severity: "error",
          file: "src/Escape.tsx",
        }),
        expect.objectContaining({
          code: "excluded-surface-change",
          severity: "error",
          file: "src/Secret.tsx",
        }),
        expect.objectContaining({
          code: "openapi-incompatible",
          severity: "error",
          message: expect.stringContaining("POST /orders"),
        }),
      ]),
    );
    expect(validation.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "out-of-scope-change",
          file: "src/theme.css",
        }),
      ]),
    );
  });

  it("refuses to lock an incomplete Git baseline before editing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-truncated-lock-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await put(
      root,
      "package.json",
      JSON.stringify({ name: "truncated-lock", dependencies: { react: "^19.0.0" } }),
    );
    await put(root, "src/One.tsx", "export const One = 1;\n");
    await put(root, "src/Two.tsx", "export const Two = 2;\n");
    await run("git", ["init"], { cwd: root, windowsHide: true });
    await run("git", ["add", "."], { cwd: root, windowsHide: true });
    await run(
      "git",
      [
        "-c",
        "user.name=Atlas Test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root, windowsHide: true },
    );
    await scanProject(root, { writeArtifacts: false });
    await put(root, "src/One.tsx", "export const One = 10;\n");
    await put(root, "src/Two.tsx", "export const Two = 20;\n");
    await expect(
      lockTaskChangeSurface(root, {
        taskId: "task-truncated-lock",
        intent: "Change two files",
        primary: {
          kind: "non-component",
          surfaceKind: "feature",
          id: "two-file-change",
        },
        allowedFiles: ["src/One.tsx", "src/Two.tsx"],
        reuseDecision: {
          decision: "not-applicable",
          rationale: "This is not a reusable component task.",
        },
        baselineLimits: { maxFiles: 1, maxLines: 1 },
      }),
    ).rejects.toThrow(/cannot lock an incomplete Git baseline/i);
  });

  it("keeps allowed graph/theme drift advisory and blocks drift outside the locked scope", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-scoped-drift-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await put(
      root,
      "package.json",
      JSON.stringify({ name: "scoped-drift", dependencies: { react: "^19.0.0" } }),
    );
    await put(root, "src/local.css", ":root { --local-space: 8px; }\n");
    await put(root, "src/global.css", ":root { --global-space: 16px; }\n");
    await put(
      root,
      "src/App.tsx",
      "export const App = () => <main>Initial</main>;\n",
    );
    await put(
      root,
      "src/Shared.tsx",
      "export const Shared = () => <aside>Shared</aside>;\n",
    );
    await run("git", ["init"], { cwd: root, windowsHide: true });
    await run("git", ["add", "."], { cwd: root, windowsHide: true });
    await run(
      "git",
      [
        "-c",
        "user.name=Atlas Test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root, windowsHide: true },
    );
    const changeSurface = await lockTaskChangeSurface(root, {
      taskId: "task-scoped-drift",
      intent: "Update App and its local theme",
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: ["src/App.tsx", "src/local.css"],
      reuseDecision: {
        decision: "extend",
        rationale: "App already owns the requested behavior.",
      },
    });

    await put(
      root,
      "src/App.tsx",
      "export const App = () => <main>Updated</main>;\n",
    );
    await put(root, "src/local.css", ":root { --local-space: 12px; }\n");
    const allowed = await validateDiff(root, { changeSurface });
    expect(allowed.blocking).toBe(false);
    expect(allowed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "theme-change-within-scope",
          severity: "warning",
        }),
      ]),
    );
    expect(allowed.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "project-graph-drift" }),
        expect.objectContaining({ code: "theme-contract-drift" }),
      ]),
    );

    await put(root, "src/global.css", ":root { --global-space: 20px; }\n");
    await put(
      root,
      "src/Shared.tsx",
      "export const Shared = () => <aside>Changed</aside>;\n",
    );
    const escaped = await validateDiff(root, { changeSurface });
    expect(escaped.blocking).toBe(true);
    expect(escaped.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "project-graph-drift",
          severity: "error",
        }),
        expect.objectContaining({
          code: "theme-contract-drift",
          severity: "error",
        }),
      ]),
    );
  });

  it("blocks a recomputed capsule hash when no matching immutable artifact exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "atlas-tampered-lock-"));
    temporary.push(root);
    process.env.PROJECT_ATLAS_HOME = path.join(root, ".private");
    await put(
      root,
      "package.json",
      JSON.stringify({ name: "tampered-lock", dependencies: { react: "^19.0.0" } }),
    );
    await put(root, "src/App.tsx", "export const App = () => <main />;\n");
    await run("git", ["init"], { cwd: root, windowsHide: true });
    await run("git", ["add", "."], { cwd: root, windowsHide: true });
    await run(
      "git",
      [
        "-c",
        "user.name=Atlas Test",
        "-c",
        "user.email=atlas@example.invalid",
        "commit",
        "-m",
        "fixture",
      ],
      { cwd: root, windowsHide: true },
    );
    const locked = await lockTaskChangeSurface(root, {
      taskId: "task-tampered-lock",
      intent: "Update App",
      primary: {
        kind: "component",
        id: "react:src/App.tsx:App",
        path: "src/App.tsx",
      },
      allowedFiles: ["src/App.tsx"],
      reuseDecision: {
        decision: "extend",
        rationale: "App owns the behavior.",
      },
    });
    const tampered = {
      ...locked,
      allowedFiles: ["src/App.tsx", "src/Escape.tsx"],
      lockId: "",
      integrityHash: "",
    } as LockedChangeSurface;
    tampered.integrityHash = computeLockedChangeSurfaceIntegrity(tampered);
    tampered.lockId = tampered.integrityHash.slice(0, 24);

    const validation = await validateDiff(root, { changeSurface: tampered });
    expect(validation.blocking).toBe(true);
    expect(validation.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "change-surface-integrity",
          severity: "error",
        }),
      ]),
    );
  });
});
