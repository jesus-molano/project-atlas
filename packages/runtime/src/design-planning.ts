import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  DesignCoverageLedger,
  DesignLinkRecord,
  DesignRetrievalPlan,
} from "@component-atlas/design";
import { AtlasStore, projectStorageDirectory } from "@component-atlas/store";
import { loadProjectGraph } from "./scan.js";

const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicJson(filePath: string, value: unknown): Promise<void> {
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, filePath);
}

export async function recordDesignCoverageLedger(
  rootPath: string,
  input: {
    taskId: string;
    plan: DesignRetrievalPlan;
    receiptIds?: string[];
  },
): Promise<DesignCoverageLedger> {
  if (!TASK_ID.test(input.taskId)) throw new Error("Task ID is invalid.");
  const graph = await loadProjectGraph(rootPath);
  const selected = input.plan.regions.filter(
    (region) => region.status === "selected",
  );
  if (
    selected.length !== input.plan.selectedNodeIds.length ||
    (input.plan.regions.length >= 3 &&
      (selected.length < 3 || selected.length > 6)) ||
    input.plan.regions.some(
      (region) =>
        !["analyzed", "selected", "omitted", "failed", "unavailable"].includes(
          region.status,
        ),
    )
  ) {
    throw new Error(
      "Design coverage must account for every considered region and select 3–6 when available.",
    );
  }
  const updatedAt = new Date().toISOString();
  const content = {
    taskId: input.taskId,
    fileKey: input.plan.fileKey,
    targetNodeId: input.plan.targetNodeId,
    planId: input.plan.id,
    regions: input.plan.regions,
    receiptIds: [...new Set(input.receiptIds ?? [])].slice(0, 20),
  };
  const ledger: DesignCoverageLedger = {
    schemaVersion: 1,
    id: `design-ledger:${digest(JSON.stringify(content)).slice(0, 20)}`,
    ...content,
    updatedAt,
    hash: digest(JSON.stringify(content)),
  };
  const directory = path.join(
    projectStorageDirectory(graph.project.id),
    "task-state",
    "design-coverage",
  );
  await mkdir(directory, { recursive: true });
  await atomicJson(path.join(directory, `${input.taskId}.json`), ledger);
  return ledger;
}

export async function loadDesignCoverageLedger(
  rootPath: string,
  taskId: string,
): Promise<DesignCoverageLedger | undefined> {
  if (!TASK_ID.test(taskId)) throw new Error("Task ID is invalid.");
  const graph = await loadProjectGraph(rootPath);
  try {
    const value = JSON.parse(
      await readFile(
        path.join(
          projectStorageDirectory(graph.project.id),
          "task-state",
          "design-coverage",
          `${taskId}.json`,
        ),
        "utf8",
      ),
    ) as DesignCoverageLedger;
    if (
      value.schemaVersion !== 1 ||
      value.taskId !== taskId ||
      digest(
        JSON.stringify({
          taskId: value.taskId,
          fileKey: value.fileKey,
          targetNodeId: value.targetNodeId,
          planId: value.planId,
          regions: value.regions,
          receiptIds: value.receiptIds,
        }),
      ) !== value.hash
    ) {
      throw new Error("Design coverage ledger integrity is invalid.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function registerDesignLink(
  rootPath: string,
  input: {
    fileKey: string;
    nodeId: string;
    componentId: string;
    source: DesignLinkRecord["source"];
    taskId?: string;
    receiptIds?: string[];
  },
): Promise<DesignLinkRecord> {
  const graph = await loadProjectGraph(rootPath);
  if (!graph.components.some((component) => component.id === input.componentId)) {
    throw new Error("Design link component is not present in Code Atlas.");
  }
  if (input.source === "task-inferred" && !input.taskId) {
    throw new Error("Inferred design links must remain task-scoped.");
  }
  if (input.taskId && !TASK_ID.test(input.taskId)) {
    throw new Error("Task ID is invalid.");
  }
  const scope = input.source === "task-inferred" ? "task" : "project";
  const createdAt = new Date().toISOString();
  const identity = [
    graph.project.id,
    input.fileKey,
    input.nodeId,
    input.componentId,
    input.source,
    input.taskId ?? "",
  ].join("\0");
  const link: DesignLinkRecord = {
    schemaVersion: 1,
    id: `design-link:${digest(identity).slice(0, 20)}`,
    projectId: graph.project.id,
    fileKey: input.fileKey,
    nodeId: input.nodeId,
    componentId: input.componentId,
    source: input.source,
    scope,
    ...(graph.project.identity?.head
      ? { commit: graph.project.identity.head }
      : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    confidence:
      input.source === "code-connect-exact"
        ? "high"
        : input.source === "local-confirmed"
          ? "high"
          : "medium",
    receiptIds: [...new Set(input.receiptIds ?? [])].slice(0, 20),
    createdAt,
  };
  const store = new AtlasStore(graph.project.id);
  try {
    store.saveDesignLink(link);
  } finally {
    store.close();
  }
  return link;
}

export async function listDesignLinks(
  rootPath: string,
  fileKey?: string,
): Promise<DesignLinkRecord[]> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return store.listDesignLinks(graph.project.id, fileKey);
  } finally {
    store.close();
  }
}
