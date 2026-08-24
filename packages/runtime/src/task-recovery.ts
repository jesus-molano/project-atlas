import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { projectStorageDirectory } from "@component-atlas/store";
import {
  loadLatestTaskEvidenceContract,
  loadLatestTaskContinuationBundle,
  type TaskContinuationBundle,
} from "./task-evidence-contract.js";
import { assertLockedChangeSurfaceArtifact } from "./change-surface-lock.js";
import { resolveProjectIdentity } from "./identity.js";
import { readTaskFocus } from "./task-focus.js";
import { resolveTaskObjectiveProjection } from "./task-objective.js";
import { hydrateTaskResumeCapsule } from "./task-state-hydration.js";
import { pruneExpiredTaskState } from "./task-state.js";
import {
  validateTaskResumeCapsule,
  type TaskResumeCapsule,
} from "./task-state-contract.js";
import { sameWorkspaceRoot } from "./task-state-paths.js";

const MAX_DISCOVERABLE_CAPSULES = 256;
const EVIDENCE_RECONCILIATION_ACTION =
  "Reconcile the task capsule with the latest durable evidence before resuming implementation.";

export interface TaskResumeCandidate {
  taskId: string;
  status: "active" | "blocked";
  updatedAt: string;
  title: string;
  objective: string;
  nextSafeAction: string;
  continuationHandle?: string;
}

export type TaskResumeRecovery =
  | {
      status: "not-found";
      candidateCount: 0;
      candidates: TaskResumeCandidate[];
    }
  | {
      status: "selection-required";
      candidateCount: number;
      candidates: TaskResumeCandidate[];
      recommendedTaskId: string;
      recommendationReason: "most-recent-same-branch-but-ambiguous";
    }
  | {
      status: "ready";
      candidateCount: number;
      candidates: TaskResumeCandidate[];
      capsule: TaskResumeCapsule;
      continuation?: TaskContinuationBundle;
      recommendedTaskId: string;
      recommendationReason: "durable-focus" | "only-candidate" | "exact-head";
    };

async function taskStateDirectories(rootPath: string): Promise<string[]> {
  const identity = await resolveProjectIdentity(rootPath);
  return [
    path.join(
      projectStorageDirectory(identity.logicalId),
      "task-state",
      "capsules",
    ),
    path.join(rootPath, ".component-atlas", "task-state", "capsules"),
  ];
}

async function capsuleFiles(
  rootPath: string,
): Promise<Array<{ directory: string; name: string }>> {
  const files: Array<{ directory: string; name: string }> = [];
  for (const directory of await taskStateDirectories(rootPath)) {
    try {
      files.push(
        ...(await readdir(directory))
          .filter((name) => name.endsWith(".json"))
          .map((name) => ({ directory, name })),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (files.length > MAX_DISCOVERABLE_CAPSULES) {
    throw new Error(
      `Task resume discovery exceeds its ${MAX_DISCOVERABLE_CAPSULES}-capsule safety limit.`,
    );
  }
  return files;
}

async function activatedTaskEvidence(
  rootPath: string,
  capsule: TaskResumeCapsule,
): Promise<{
  capsule: TaskResumeCapsule;
  continuation?: TaskContinuationBundle;
}> {
  const latestContract = await loadLatestTaskEvidenceContract(
    rootPath,
    capsule.taskId,
  );
  const latestContinuation = await loadLatestTaskContinuationBundle(
    rootPath,
    capsule.taskId,
  );
  const contractHandles = capsule.handles.filter((handle) =>
    handle.startsWith("contract:"),
  );
  const continuationHandles = capsule.handles.filter((handle) =>
    handle.startsWith("continuation:"),
  );
  const contractActivated = latestContract
    ? contractHandles.includes(latestContract.handle)
    : contractHandles.length === 0;
  const continuationActivated = latestContinuation
    ? contractActivated &&
      continuationHandles.includes(latestContinuation.handle) &&
      contractHandles.includes(latestContinuation.contract.handle)
    : continuationHandles.length === 0;
  const evidenceAligned = contractActivated && continuationActivated;
  if (evidenceAligned) {
    return {
      capsule,
      ...(latestContinuation ? { continuation: latestContinuation } : {}),
    };
  }
  return {
    capsule: {
      ...capsule,
      handles: [
        ...capsule.handles.filter(
          (handle) =>
            !handle.startsWith("contract:") &&
            !handle.startsWith("continuation:"),
        ),
        ...(latestContract && contractActivated
          ? [latestContract.handle]
          : []),
      ],
      nextSafeAction: EVIDENCE_RECONCILIATION_ACTION,
    },
  };
}

function resumeCandidate(
  capsule: TaskResumeCapsule & { status: "active" | "blocked" },
  objective: string,
  continuation?: TaskContinuationBundle,
): TaskResumeCandidate {
  return {
    taskId: capsule.taskId,
    status: capsule.status,
    updatedAt: capsule.updatedAt,
    title: capsule.title,
    objective,
    nextSafeAction: continuation?.nextSafeAction ?? capsule.nextSafeAction,
    ...(continuation ? { continuationHandle: continuation.handle } : {}),
  };
}

async function discoverTaskResumeState(rootPath: string): Promise<{
  candidates: TaskResumeCandidate[];
  capsules: Map<string, TaskResumeCapsule>;
  currentHead?: string;
}> {
  await pruneExpiredTaskState(rootPath);
  const identity = await resolveProjectIdentity(rootPath);
  const discovered = new Map<string, TaskResumeCapsule>();
  for (const { directory, name } of await capsuleFiles(rootPath)) {
    let capsule: TaskResumeCapsule;
    try {
      capsule = await hydrateTaskResumeCapsule(
        rootPath,
        validateTaskResumeCapsule(
          JSON.parse(await readFile(path.join(directory, name), "utf8")),
        ),
      );
    } catch (error) {
      throw new Error(
        `Task resume discovery stopped because capsule ${name} is corrupt.`,
        { cause: error },
      );
    }
    if (
      !sameWorkspaceRoot(capsule.workspace.rootPath, rootPath) ||
      capsule.status === "completed" ||
      (capsule.workspace.checkoutId !== undefined &&
        capsule.workspace.checkoutId !== identity.checkoutId) ||
      (capsule.workspace.branch !== undefined &&
        capsule.workspace.branch !== (identity.branch ?? "HEAD"))
    ) {
      continue;
    }
    const prior = discovered.get(capsule.taskId);
    if (!prior || capsule.updatedAt > prior.updatedAt) {
      discovered.set(capsule.taskId, capsule);
    }
  }

  const capsules = new Map<string, TaskResumeCapsule>();
  const candidates: TaskResumeCandidate[] = [];
  for (const [taskId, capsule] of discovered) {
    if (capsule.status === "completed") continue;
    if (capsule.changeSurface) {
      await assertLockedChangeSurfaceArtifact(
        rootPath,
        taskId,
        capsule.changeSurface,
      );
    }
    const resolvedObjective = await resolveTaskObjectiveProjection(
      rootPath,
      taskId,
      capsule.objective,
    );
    const activated = await activatedTaskEvidence(rootPath, capsule);
    capsules.set(taskId, activated.capsule);
    candidates.push(
      resumeCandidate(
        { ...activated.capsule, status: capsule.status },
        resolvedObjective.text,
        activated.continuation,
      ),
    );
  }
  return {
    candidates: candidates.toSorted((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.taskId.localeCompare(right.taskId),
    ),
    capsules,
    ...(identity.head ? { currentHead: identity.head } : {}),
  };
}

/** Lists active tasks for this exact checkout without similarity guessing. */
export async function listTaskResumeCandidates(
  rootPath: string,
  limit = 8,
): Promise<TaskResumeCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 32) {
    throw new Error("Task resume candidate limit must be between 1 and 32.");
  }
  const { candidates } = await discoverTaskResumeState(rootPath);
  return candidates.slice(0, limit);
}

/**
 * Recovers the explicit checkout-and-branch focus when present. Without a
 * focus, Atlas continues only for one candidate or a uniquely exact HEAD.
 */
export async function recoverTaskResumeState(
  rootPath: string,
  candidateLimit = 8,
): Promise<TaskResumeRecovery> {
  if (
    !Number.isInteger(candidateLimit) ||
    candidateLimit < 1 ||
    candidateLimit > 32
  ) {
    throw new Error("Task resume candidate limit must be between 1 and 32.");
  }
  const { candidates, capsules, currentHead } = await discoverTaskResumeState(rootPath);
  if (candidates.length === 0) {
    return { status: "not-found", candidateCount: 0, candidates: [] };
  }
  const focus = await readTaskFocus(rootPath);
  const focused = focus
    ? candidates.find((candidate) => candidate.taskId === focus.taskId)
    : undefined;
  const exactHead = currentHead
    ? candidates.filter((candidate) => capsules.get(candidate.taskId)?.workspace.head === currentHead)
    : [];
  const candidate =
    focused ??
    (candidates.length === 1 ? candidates[0] : undefined) ??
    (exactHead.length === 1 ? exactHead[0] : undefined);
  if (!candidate) {
    return {
      status: "selection-required",
      candidateCount: candidates.length,
      candidates: candidates.slice(0, candidateLimit),
      recommendedTaskId: candidates[0]!.taskId,
      recommendationReason: "most-recent-same-branch-but-ambiguous",
    };
  }
  const capsule = capsules.get(candidate.taskId);
  if (!capsule) throw new Error("Recovered task capsule is unavailable.");
  const activated = await activatedTaskEvidence(rootPath, capsule);
  if (activated.capsule.status === "completed") {
    throw new Error("Recovered task capsule is no longer active.");
  }
  const recoveredCandidate = resumeCandidate(
    {
      ...activated.capsule,
      status: activated.capsule.status,
    },
    (await resolveTaskObjectiveProjection(
      rootPath,
      candidate.taskId,
      activated.capsule.objective,
    )).text,
    activated.continuation,
  );
  return {
    status: "ready",
    candidateCount: candidates.length,
    candidates: [
      recoveredCandidate,
      ...candidates.filter((item) => item.taskId !== recoveredCandidate.taskId),
    ].slice(0, candidateLimit),
    capsule: activated.capsule,
    recommendedTaskId: candidate.taskId,
    recommendationReason: focused
      ? "durable-focus"
      : candidates.length === 1
        ? "only-candidate"
        : "exact-head",
    ...(activated.continuation
      ? { continuation: activated.continuation }
      : {}),
  };
}
