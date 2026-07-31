import path from "node:path";
import {
  captureFigmaAsset,
  materializeFigmaAsset,
  type TaskResumeCapsule,
} from "@component-atlas/runtime";
import { authoritativeTaskSources } from "./core-source-evidence.js";
import { sourceLedgerFingerprint } from "./core-tool-helpers.js";

export interface CoreLifecycleAssetOperations {
  capture: (
    input: Parameters<typeof captureFigmaAsset>[0],
  ) => ReturnType<typeof captureFigmaAsset>;
  materialize: (
    input: Parameters<typeof materializeFigmaAsset>[0],
  ) => ReturnType<typeof materializeFigmaAsset>;
}

export const defaultCoreLifecycleAssetOperations: CoreLifecycleAssetOperations = {
  capture: (input) => captureFigmaAsset(input),
  materialize: (input) => materializeFigmaAsset(input),
};

export async function verifiedLockedFigmaAssetSourceLedger(
  rootPath: string,
  taskId: string,
  capsule: TaskResumeCapsule,
) {
  const frozen = capsule.changeSurface?.evidence.sourceLedger;
  if (!frozen) {
    throw new Error("Figma asset materialization requires a locked source ledger.");
  }
  if (
    !frozen.hash ||
    frozen.decisionCount === undefined ||
    frozen.receiptCount === undefined
  ) {
    throw new Error(
      "The active ChangeSurface has a legacy source ledger; explicitly relock before materializing Figma assets.",
    );
  }
  const ledger = await authoritativeTaskSources(rootPath, taskId, capsule);
  const fingerprint = sourceLedgerFingerprint(
    ledger.decisions,
    ledger.relations,
    ledger.receiptIds,
  );
  if (
    fingerprint !== frozen.hash ||
    ledger.decisions.length !== frozen.decisionCount ||
    ledger.relations.length !== (frozen.relationCount ?? 0) ||
    ledger.receiptIds.length !== frozen.receiptCount ||
    frozen.receiptIds.some((receiptId) =>
      !ledger.receiptIds.includes(receiptId),
    )
  ) {
    throw new Error(
      "The authoritative task source ledger no longer matches the active ChangeSurface; invalidate and relock before materializing Figma assets.",
    );
  }
  return ledger;
}

export function lockedFigmaAssetDestinationPath(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.length > 260 ||
    path.isAbsolute(value) ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    normalized.includes("\0")
  ) {
    throw new Error("Figma asset destination must be a valid locked repository path.");
  }
  return normalized;
}
