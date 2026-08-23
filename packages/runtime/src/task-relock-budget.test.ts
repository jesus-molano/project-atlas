import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { projectStorageDirectory } from "@component-atlas/store";
import { afterEach, beforeEach, expect, it } from "vitest";
import { lockedChangeSurfaceArtifactPath } from "./change-surface-lock.js";
import { resolveProjectIdentity } from "./identity.js";
import { taskStateFileName } from "./task-state-paths.js";
import {
  loadTaskResumeCapsule,
  lockTaskChangeSurface,
  writeTaskCheckpoint,
} from "./task-state.js";

const run = promisify(execFile);
let dataHome: string;
let root: string;
let previousDataHome: string | undefined;

beforeEach(async () => {
  previousDataHome = process.env.PROJECT_ATLAS_HOME;
  dataHome = await mkdtemp(path.join(os.tmpdir(), "atlas-relock-home-"));
  root = await mkdtemp(path.join(os.tmpdir(), "atlas-relock-budget-"));
  process.env.PROJECT_ATLAS_HOME = dataHome;
});

afterEach(async () => {
  if (previousDataHome === undefined) delete process.env.PROJECT_ATLAS_HOME;
  else process.env.PROJECT_ATLAS_HOME = previousDataHome;
  await Promise.all([
    rm(dataHome, { recursive: true, force: true }),
    rm(root, { recursive: true, force: true }),
  ]);
});

it("persists a relock invalidation when the full ChangeSurface approaches the capsule budget", async () => {
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "relock-budget", dependencies: { react: "^19.0.0" } }),
    "utf8",
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
  const taskId = "task-relock-budget";
  const objective =
    "Update dependencies and repair newly exposed build, lint, and accessibility failures without changing product behavior.";
  const handles = [
    "contract:task-relock-budget:0123456789abcdef",
    "continuation:task-relock-budget:fedcba9876543210",
  ];
  const lock = await lockTaskChangeSurface(root, {
    taskId,
    intent: objective,
    primary: {
      kind: "non-component",
      surfaceKind: "configuration",
      id: "dependency-and-test-configuration",
      path: "package.json",
    },
    allowedFiles: Array.from(
      { length: 12 },
      (_, index) => `src/features/settings/repair-${index}.tsx`,
    ),
    referenceFiles: Array.from(
      { length: 6 },
      (_, index) => `src/features/settings/reference-${index}.tsx`,
    ),
    exclusions: Array.from(
      { length: 6 },
      (_, index) => `src/excluded-feature-${index}/**`,
    ),
    reuseDecision: {
      decision: "not-applicable",
      rationale:
        "Validation after the dependency update discovered required repairs in existing source files.",
    },
    handles,
  });
  expect(Buffer.byteLength(JSON.stringify(lock), "utf8")).toBeGreaterThan(2_300);
  await writeTaskCheckpoint(root, {
    taskId,
    milestone: "batch-completed",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles,
    covered: ["dependency update"],
    remaining: ["new validation failures"],
    budgetChars: 2_400,
    changeSurface: lock,
    nextSafeAction: "Run clean validation.",
  });

  const reason =
    "Clean validation exposed required repairs outside the initial scope.";
  const invalidated = await writeTaskCheckpoint(root, {
    taskId,
    milestone: "risk-boundary",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles,
    covered: Array.from(
      { length: 8 },
      (_, index) => `clean validation evidence ${index} ${"x".repeat(100)}`,
    ),
    remaining: Array.from(
      { length: 8 },
      (_, index) => `relock repair and validation step ${index} ${"y".repeat(92)}`,
    ),
    budgetChars: 2_400,
    changeInvalidation: { reason },
    nextSafeAction: `Relock the newly discovered source files, then repair and rerun every clean validation. ${"z".repeat(150)}`,
  });

  expect(invalidated.changeSurface).toEqual(lock);
  expect(invalidated.changeInvalidation).toMatchObject({
    reason,
    previousLockId: lock.lockId,
    relockRequired: true,
  });
  const identity = await resolveProjectIdentity(root);
  const capsulePath = path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "capsules",
    taskStateFileName(root, taskId, "json"),
  );
  const serializedCapsule = await readFile(capsulePath, "utf8");
  const persistedCapsule = JSON.parse(serializedCapsule);
  expect(
    Buffer.byteLength(JSON.stringify(persistedCapsule), "utf8"),
  ).toBeLessThanOrEqual(4_096);
  expect(persistedCapsule).toMatchObject({
    changeSurfaceArtifact: {
      lockId: lock.lockId,
      integrityHash: lock.integrityHash,
      revision: lock.revision,
    },
  });
  expect(persistedCapsule).not.toHaveProperty("changeSurface");
  const artifactPath = await lockedChangeSurfaceArtifactPath(root, lock);
  const serializedArtifact = await readFile(artifactPath, "utf8");
  await rm(artifactPath);
  await expect(loadTaskResumeCapsule(root, taskId)).rejects.toThrow(
    /artifact is missing/iu,
  );
  await writeFile(artifactPath, serializedArtifact, "utf8");
  await expect(loadTaskResumeCapsule(root, taskId)).resolves.toMatchObject({
    changeSurface: { lockId: lock.lockId, integrityHash: lock.integrityHash },
    changeInvalidation: { reason, relockRequired: true },
  });

  const relocked = await lockTaskChangeSurface(root, {
    taskId,
    intent: objective,
    primary: {
      kind: "non-component",
      surfaceKind: "configuration",
      id: "dependency-and-test-configuration",
      path: "package.json",
    },
    allowedFiles: [...lock.allowedFiles, "src/app/globals.css"],
    referenceFiles: lock.referenceFiles,
    exclusions: lock.exclusions,
    reuseDecision: lock.reuseDecision,
    handles: lock.evidence.handles,
    gitBaseline: lock.gitBaseline,
    invalidationReason: reason,
  });
  expect(relocked).toMatchObject({
    revision: 2,
    supersedes: lock.lockId,
    invalidationReason: reason,
  });
  const rescoped = await writeTaskCheckpoint(root, {
    taskId,
    milestone: "batch-completed",
    objective,
    objectiveApproved: true,
    decisions: [],
    sourceReceiptIds: [],
    handles: [],
    covered: ["expanded scope"],
    remaining: ["repairs", "validation"],
    budgetChars: 2_400,
    changeSurface: relocked,
    nextSafeAction: "Implement and validate the expanded scope.",
  });
  expect(rescoped.changeSurface).toEqual(relocked);
  expect(rescoped.changeInvalidation).toBeUndefined();
});
