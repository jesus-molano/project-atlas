import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { scanProject, validateDiff } from "./index.js";

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
  it("is consultative, avoids a clean-diff false positive, and detects seeded warnings", async () => {
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
    expect((await validateDiff(root)).findings).toEqual([]);

    await put(
      root,
      "src/theme.css",
      `:root { --color-surface: #fff; --space-2: 0.5rem; }
       button:focus-visible { outline: 2px solid #fff; }
       @media (min-width: 768px) { .grid { display: grid; } }
       .new-card { padding: 13px; }
       @media (min-width: 777px) { .new-card { display: grid; } }`,
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
    expect(validation.blocking).toBe(false);
    expect(validation.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "new-visual-literal",
        "foreign-breakpoint",
        "missing-interactive-state",
        "openapi-incompatible",
      ]),
    );
  });
});
