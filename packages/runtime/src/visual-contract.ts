import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fitBudgetedResponse } from "@component-atlas/memory";
import { projectStorageDirectory } from "@component-atlas/store";
import { resolveProjectIdentity } from "./identity.js";
import { writeImmutableArtifact } from "./immutable-artifact.js";
import {
  verifyVisualSelectionReceipt,
  visualSelectionReceiptSession,
} from "./visual-artifact-receipt.js";

const VISUAL_HANDLE = /^visual:(vd-[A-Za-z0-9_-]+):([a-f0-9]{16})$/u;
const TASK_ID = /^[A-Za-z0-9_.:-]{1,160}$/u;
const RECEIPT_ID = /^receipt-(?:[a-f0-9]{16}|[a-f0-9]{64})$/u;
const HASH = /^[a-f0-9]{64}$/u;
const MAX_VISUAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export interface VisualEvidenceContract {
  schemaVersion: 1;
  handle: string;
  taskId: string;
  hash: string;
  authority: "exact-figma" | "existing-system" | "selected-direction";
  summary: string;
  selectedDirectionId?: string;
  figma?: {
    fileKey: string;
    nodeId?: string;
  };
  sourceReceiptIds: string[];
  selectionReceipt: string;
  artifactSessionId: string;
  createdAt: string;
  expiresAt: string;
}

export interface PersistVisualEvidenceContractInput {
  handle: string;
  taskId: string;
  hash: string;
  authority: VisualEvidenceContract["authority"];
  summary: string;
  selectedDirectionId?: string;
  figma?: VisualEvidenceContract["figma"];
  sourceReceiptIds?: string[];
  selectionReceipt: string;
  createdAt?: string;
  expiresAt: string;
}

function boundedText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f]/u.test(normalized)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function validateContract(value: unknown): VisualEvidenceContract {
  if (!value || typeof value !== "object") {
    throw new Error("Visual evidence contract is invalid.");
  }
  const contract = value as VisualEvidenceContract;
  const handle = VISUAL_HANDLE.exec(contract.handle);
  if (
    contract.schemaVersion !== 1 ||
    !handle ||
    !TASK_ID.test(contract.taskId) ||
    !HASH.test(contract.hash) ||
    !contract.hash.startsWith(handle[2]!) ||
    !["exact-figma", "existing-system", "selected-direction"].includes(
      contract.authority,
    ) ||
    !Array.isArray(contract.sourceReceiptIds) ||
    contract.sourceReceiptIds.some((id) => !RECEIPT_ID.test(id)) ||
    visualSelectionReceiptSession(contract.selectionReceipt) !==
      contract.artifactSessionId ||
    !Number.isFinite(Date.parse(contract.createdAt)) ||
    !Number.isFinite(Date.parse(contract.expiresAt)) ||
    Date.parse(contract.expiresAt) <= Date.parse(contract.createdAt)
  ) {
    throw new Error("Visual evidence contract is invalid.");
  }
  boundedText(contract.summary, 1_000, "Visual evidence summary");
  if (contract.selectedDirectionId) {
    boundedText(contract.selectedDirectionId, 160, "Selected direction ID");
  }
  if (contract.figma) {
    boundedText(contract.figma.fileKey, 240, "Figma file key");
    if (contract.figma.nodeId) {
      boundedText(contract.figma.nodeId, 240, "Figma node ID");
    }
  }
  if (contract.authority === "exact-figma") {
    if (!contract.figma || contract.sourceReceiptIds.length === 0) {
      throw new Error(
        "Exact Figma authority requires an exact Figma identity and source receipt.",
      );
    }
  }
  if (
    contract.authority === "selected-direction" &&
    !contract.selectedDirectionId
  ) {
    throw new Error(
      "Selected-direction authority requires a selected direction ID.",
    );
  }
  return contract;
}

async function visualContractRoot(rootPath: string): Promise<string> {
  const identity = await resolveProjectIdentity(rootPath);
  return path.join(
    projectStorageDirectory(identity.logicalId),
    "task-state",
    "visual-contracts",
  );
}

function fileName(handle: string): string {
  const match = VISUAL_HANDLE.exec(handle);
  if (!match) throw new Error("Visual evidence handle is invalid.");
  return `${match[1]}-${match[2]}.json`;
}

export async function persistVisualEvidenceContract(
  rootPath: string,
  input: PersistVisualEvidenceContractInput,
): Promise<VisualEvidenceContract> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const now = Date.now();
  const expiry = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry - now > MAX_VISUAL_TTL_MS
  ) {
    throw new Error(
      "Visual evidence expiry must be in the future and at most seven days away.",
    );
  }
  const contract = validateContract({
    schemaVersion: 1,
    handle: input.handle,
    taskId: input.taskId,
    hash: input.hash,
    authority: input.authority,
    summary: input.summary,
    ...(input.selectedDirectionId
      ? { selectedDirectionId: input.selectedDirectionId }
      : {}),
    ...(input.figma ? { figma: input.figma } : {}),
    sourceReceiptIds: [
      ...new Set((input.sourceReceiptIds ?? []).filter((id) => RECEIPT_ID.test(id))),
    ].slice(0, 20),
    selectionReceipt: input.selectionReceipt,
    artifactSessionId: visualSelectionReceiptSession(input.selectionReceipt),
    createdAt,
    expiresAt: input.expiresAt,
  });
  const directory = await visualContractRoot(rootPath);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, fileName(contract.handle));
  try {
    const existing = validateContract(JSON.parse(await readFile(target, "utf8")));
    if (JSON.stringify(existing) === JSON.stringify(contract)) return existing;
    throw new Error(
      "A visual evidence handle is immutable; create a new handle for changed evidence.",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await verifyVisualSelectionReceipt({
    taskId: contract.taskId,
    receipt: contract.selectionReceipt,
    contractHandle: contract.handle,
    contractHash: contract.hash,
    expiresAt: contract.expiresAt,
  });
  await writeImmutableArtifact(
    target,
    `${JSON.stringify(contract, null, 2)}\n`,
    "A visual evidence handle is immutable; create a new handle for changed evidence.",
  );
  return contract;
}

export async function loadVisualEvidenceContract(
  rootPath: string,
  handle: string,
): Promise<VisualEvidenceContract> {
  const contract = validateContract(
    JSON.parse(
      await readFile(
        path.join(await visualContractRoot(rootPath), fileName(handle)),
        "utf8",
      ),
    ),
  );
  if (contract.handle !== handle) {
    throw new Error("Visual evidence contract identity is invalid.");
  }
  return contract;
}

export async function expandVisualEvidenceContract(
  rootPath: string,
  handle: string,
  budgetChars = 1_600,
) {
  const contract = await loadVisualEvidenceContract(rootPath, handle);
  const expired = Date.parse(contract.expiresAt) <= Date.now();
  return fitBudgetedResponse(
    {
      schemaVersion: 1,
      status: expired ? "expired" : "current",
      contract,
      nextAction: expired
        ? "Recreate the visual-direction contract before implementation."
        : "Use this selected visual authority inside the locked change surface.",
    },
    {
      budgetChars,
      totalMatches: 1,
      expandableIds: contract.sourceReceiptIds,
      preserveKeys: ["status", "contract"],
    },
  );
}
