import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { loadTaskResumeCapsule } from "./task-state.js";

const TASK_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/u;
const FOCUS_SCHEMA_VERSION = 1 as const;

export interface TaskFocus {
  schemaVersion: typeof FOCUS_SCHEMA_VERSION;
  taskId: string;
  checkoutId: string;
  branch: string;
  updatedAt: string;
}

function branchKey(branch: string): string {
  return createHash("sha256").update(branch, "utf8").digest("hex").slice(0, 16);
}

function currentBranch(branch: string | undefined): string {
  return branch?.trim() || "HEAD";
}

async function focusPath(rootPath: string): Promise<{
  filePath: string;
  checkoutId: string;
  branch: string;
}> {
  const identity = await resolveProjectIdentity(rootPath);
  if (!identity.checkoutId) {
    throw new Error("Task focus requires a resolved checkout identity.");
  }
  const branch = currentBranch(identity.branch);
  return {
    filePath: path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "focus",
      `${identity.checkoutId}-${branchKey(branch)}.json`,
    ),
    checkoutId: identity.checkoutId,
    branch,
  };
}

function validateFocus(value: unknown): TaskFocus {
  const focus = value as Partial<TaskFocus>;
  if (
    !focus ||
    focus.schemaVersion !== FOCUS_SCHEMA_VERSION ||
    typeof focus.taskId !== "string" ||
    !TASK_ID_PATTERN.test(focus.taskId) ||
    typeof focus.checkoutId !== "string" ||
    !/^[a-f0-9]{20}$/u.test(focus.checkoutId) ||
    typeof focus.branch !== "string" ||
    !focus.branch.trim() ||
    focus.branch.length > 240 ||
    typeof focus.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(focus.updatedAt))
  ) {
    throw new Error("Task focus is invalid.");
  }
  return focus as TaskFocus;
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

/** Reads the current checkout-and-branch focus without inferring a task. */
export async function readTaskFocus(rootPath: string): Promise<TaskFocus | undefined> {
  const target = await focusPath(rootPath);
  let serialized: string;
  try {
    serialized = await readFile(target.filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const focus = validateFocus(JSON.parse(serialized));
  if (focus.checkoutId !== target.checkoutId || focus.branch !== target.branch) {
    return undefined;
  }
  return focus;
}

/** Pins one resumable task as the explicit main task for this checkout and branch. */
export async function writeTaskFocus(
  rootPath: string,
  input: { taskId: string; at?: string },
): Promise<TaskFocus> {
  if (!TASK_ID_PATTERN.test(input.taskId)) throw new Error("Task focus task ID is invalid.");
  const capsule = await loadTaskResumeCapsule(rootPath, input.taskId);
  if (!capsule || capsule.status === "completed") {
    throw new Error("Task focus requires an active or blocked task capsule.");
  }
  const target = await focusPath(rootPath);
  if (
    (capsule.workspace.checkoutId &&
      capsule.workspace.checkoutId !== target.checkoutId) ||
    (capsule.workspace.branch && capsule.workspace.branch !== target.branch)
  ) {
    throw new Error("Task focus capsule belongs to a different checkout branch.");
  }
  const updatedAt = input.at ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new Error("Task focus timestamp is invalid.");
  }
  const focus: TaskFocus = {
    schemaVersion: FOCUS_SCHEMA_VERSION,
    taskId: input.taskId,
    checkoutId: target.checkoutId,
    branch: target.branch,
    updatedAt,
  };
  await mkdir(path.dirname(target.filePath), { recursive: true });
  await atomicJson(target.filePath, focus);
  return focus;
}

/** Clears focus only for the current checkout and branch. */
export async function clearTaskFocus(
  rootPath: string,
  expectedTaskId?: string,
): Promise<boolean> {
  const target = await focusPath(rootPath);
  if (expectedTaskId) {
    const focus = await readTaskFocus(rootPath);
    if (!focus || focus.taskId !== expectedTaskId) return false;
  }
  try {
    await rm(target.filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
