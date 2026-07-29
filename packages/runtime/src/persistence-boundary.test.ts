import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  assessTaskRisk,
  ensureTaskSourceDecisions,
} from "@component-atlas/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadTaskResumeCapsule,
  mapFigmaDesign,
  prepareTaskContext,
  scanProject,
  writeTaskCheckpoint,
} from "./index.js";

const execFileAsync = promisify(execFile);
let rootPath: string;
let dataHome: string;
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  rootPath = await mkdtemp(path.join(os.tmpdir(), "atlas-clean-boundary-"));
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-clean-state-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
  await mkdir(path.join(rootPath, "src"), { recursive: true });
  await writeFile(
    path.join(rootPath, "package.json"),
    JSON.stringify({
      name: "clean-boundary",
      dependencies: { react: "^19.0.0" },
    }),
  );
  await writeFile(
    path.join(rootPath, "src", "LoginForm.tsx"),
    "export function LoginForm(){return <form>Login</form>}",
  );
  await execFileAsync("git", ["init", rootPath]);
  await execFileAsync("git", ["-C", rootPath, "config", "user.email", "atlas@test"]);
  await execFileAsync("git", ["-C", rootPath, "config", "user.name", "Atlas Test"]);
  await execFileAsync("git", ["-C", rootPath, "add", "."]);
  await execFileAsync("git", ["-C", rootPath, "commit", "-m", "fixture"]);
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all([
    rm(rootPath, { recursive: true, force: true }),
    rm(dataHome, { recursive: true, force: true }),
  ]);
});

describe("checkout persistence boundary", () => {
  it("keeps scan, Figma sync, preparation, checkpoint, and resume read-only to Git", async () => {
    const status = async () =>
      (
        await execFileAsync("git", [
          "-C",
          rootPath,
          "status",
          "--porcelain=v1",
        ])
      ).stdout;
    expect(await status()).toBe("");

    await scanProject(rootPath);
    expect(await status()).toBe("");

    await mapFigmaDesign({
      rootPath,
      figmaUrl:
        "https://www.figma.com/design/BoundaryFile/Boundary?node-id=10-1",
      metadata:
        '<canvas id="1:1" name="Login"><frame id="10:1" name="Login desktop" width="1440" height="900" /></canvas>',
      format: "figma-mcp-xml",
      indexedAt: "2026-07-29T12:00:00.000Z",
    });
    expect(await status()).toBe("");

    const objective = "Adjust the existing login form copy";
    const decisions = ensureTaskSourceDecisions(objective, []);
    await prepareTaskContext(
      rootPath,
      {
        schemaVersion: 1,
        scope: "task",
        objective,
        objectiveConfirmed: true,
        risk: assessTaskRisk(objective),
        sources: decisions,
      },
      { taskId: "task-clean-boundary", budgetChars: 2_400 },
    );
    await writeTaskCheckpoint(rootPath, {
      taskId: "task-clean-boundary",
      milestone: "batch-completed",
      objective,
      objectiveApproved: true,
      decisions,
      sourceReceiptIds: [],
      handles: [],
      covered: ["preparation"],
      remaining: ["implementation"],
      budgetChars: 2_400,
      nextSafeAction: "Implement the bounded change.",
    });
    expect(
      await loadTaskResumeCapsule(rootPath, "task-clean-boundary"),
    ).toMatchObject({ taskId: "task-clean-boundary" });
    expect(await status()).toBe("");
    await expect(
      access(path.join(rootPath, ".component-atlas")),
    ).rejects.toThrow();
  }, 20_000);
});
