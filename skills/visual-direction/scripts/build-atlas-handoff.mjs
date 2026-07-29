import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MODES = new Set(["fidelity", "inherit", "explore", "redesign"]);
const WORKFLOW_STATES = new Set([
  "inactive",
  "needs-selection",
  "locked",
  "review",
  "closed",
]);
const CLEANUP_STATES = new Set([
  "not-applicable",
  "ephemeral-active",
  "selected-retained",
  "clean",
  "cleanup-pending",
]);
const REVIEW_RESULTS = new Set([
  "pass",
  "fix-and-recapture",
  "blocked",
]);
const RECEIPT_ID = /^receipt-[a-f0-9]{16}$/u;
const ATLAS_HANDLE = /^(?:code|design|memory):[^\u0000-\u001f]{1,240}$/u;
const VISUAL_HANDLE = /^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u;
const HASH = /^[a-f0-9]{16,64}$/u;
const RETRY_ID = /^vd-[A-Za-z0-9_-]+$/u;
const MAX_HANDOFF_BYTES = 3_072;

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label, maximum = 240) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  const normalized = value.trim().replace(/[\u0000-\u001f]+/gu, " ");
  if (normalized.length > maximum) {
    throw new RangeError(`${label} exceeds ${maximum} characters.`);
  }
  return normalized;
}

function requireEnum(value, allowed, label) {
  const normalized = requireString(value, label);
  if (!allowed.has(normalized)) {
    throw new RangeError(`${label} has an unsupported value.`);
  }
  return normalized;
}

function requireInteger(value, label, minimum, maximum) {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}.`,
    );
  }
  return value;
}

function uniqueCheckedStrings(value, label, pattern, maximumItems) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  if (value.length > maximumItems) {
    throw new RangeError(`${label} exceeds ${maximumItems} items.`);
  }
  return [
    ...new Set(
      value.map((item, index) => {
        const text = requireString(item, `${label}[${index}]`);
        if (!pattern.test(text)) {
          throw new Error(`${label}[${index}] is invalid.`);
        }
        return text;
      }),
    ),
  ];
}

function parseExactFigma(authority) {
  if (authority.authority?.visual !== "exact-figma") return undefined;
  const exact = requireObject(
    authority.exactFigmaIdentity,
    "authorityDecision.exactFigmaIdentity",
  );
  return {
    fileKey: requireString(exact.fileKey, "exactFigmaIdentity.fileKey", 160),
    nodeId: requireString(exact.nodeId, "exactFigmaIdentity.nodeId", 160),
    url: requireString(exact.url, "exactFigmaIdentity.url", 1_024),
  };
}

function parseDirectionCards(value, previewCount, workflowState) {
  if (value === undefined) {
    if (workflowState === "needs-selection") {
      throw new Error(
        `Pending selection requires the authority decision's ${previewCount} direction cards.`,
      );
    }
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError("directionCards must be an array.");
  }
  if (workflowState !== "needs-selection" && value.length > 0) {
    throw new Error(
      "Direction cards may enter the handoff only while selection is pending.",
    );
  }
  if (value.length !== previewCount) {
    throw new Error(
      `directionCards must contain the authority decision's ${previewCount} options.`,
    );
  }
  return value.map((rawCard, index) => {
    const card = requireObject(rawCard, `directionCards[${index}]`);
    return {
      id: requireString(card.id, `directionCards[${index}].id`, 80),
      name: requireString(card.name, `directionCards[${index}].name`, 80),
      premise: requireString(
        card.premise,
        `directionCards[${index}].premise`,
        180,
      ),
    };
  });
}

function parseSelectedContract(value, workflowState, mode) {
  if (value === undefined) {
    if (
      ["locked", "review"].includes(workflowState) &&
      mode !== "fidelity"
    ) {
      throw new Error(
        "A locked non-fidelity direction requires a selected contract receipt.",
      );
    }
    return undefined;
  }
  const selected = requireObject(value, "selectedContract");
  const contractHandle = requireString(
    selected.contractHandle,
    "selectedContract.contractHandle",
  );
  const contractHash = requireString(
    selected.contractHash,
    "selectedContract.contractHash",
    64,
  );
  const expiresAt = requireString(
    selected.expiresAt,
    "selectedContract.expiresAt",
    64,
  );
  if (!VISUAL_HANDLE.test(contractHandle)) {
    throw new Error("selectedContract.contractHandle is invalid.");
  }
  if (!HASH.test(contractHash)) {
    throw new Error("selectedContract.contractHash is invalid.");
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("selectedContract.expiresAt must be an ISO timestamp.");
  }
  return { contractHandle, contractHash, expiresAt };
}

function parseStateMatrix(value) {
  if (value === undefined) return undefined;
  const matrix = requireObject(value, "stateMatrix");
  const viewports = uniqueCheckedStrings(
    matrix.viewports,
    "stateMatrix.viewports",
    /^[A-Za-z0-9_.:-]{1,48}$/u,
    6,
  );
  const requiredStates = uniqueCheckedStrings(
    matrix.requiredStates,
    "stateMatrix.requiredStates",
    /^[A-Za-z0-9_.:-]{1,48}$/u,
    14,
  );
  return {
    surface: requireString(matrix.surface, "stateMatrix.surface", 120),
    viewports,
    requiredStates,
  };
}

function parseReview(value, workflowState) {
  if (value === undefined) {
    if (workflowState === "review") {
      throw new Error("Review state requires a compact visualReview summary.");
    }
    return undefined;
  }
  const review = requireObject(value, "visualReview");
  return {
    result: requireEnum(
      review.result,
      REVIEW_RESULTS,
      "visualReview.result",
    ),
    deviationCount: requireInteger(
      review.deviationCount ?? 0,
      "visualReview.deviationCount",
      0,
      99,
    ),
    captureCount: requireInteger(
      review.captureCount ?? 0,
      "visualReview.captureCount",
      0,
      24,
    ),
  };
}

function parseCleanup(value, workflowState) {
  const cleanup = requireObject(value, "cleanup");
  const state = requireEnum(cleanup.state, CLEANUP_STATES, "cleanup.state");
  if (workflowState === "closed" && state !== "clean") {
    throw new Error("Closed visual-direction work must have clean artifacts.");
  }
  if (
    workflowState === "needs-selection" &&
    state !== "ephemeral-active" &&
    state !== "cleanup-pending"
  ) {
    throw new Error(
      "Pending selection must report active ephemeral artifacts or cleanup-pending.",
    );
  }
  let retrySessionId;
  if (state === "cleanup-pending") {
    retrySessionId = requireString(
      cleanup.retrySessionId,
      "cleanup.retrySessionId",
      160,
    );
    if (!RETRY_ID.test(retrySessionId)) {
      throw new Error("cleanup.retrySessionId is invalid.");
    }
  }
  return {
    state,
    blocksCompletion: state === "cleanup-pending",
    ...(retrySessionId ? { retrySessionId } : {}),
  };
}

function deriveStatus(workflowState, cleanupState) {
  if (cleanupState === "cleanup-pending") return "cleanup-pending";
  if (workflowState === "closed") return "clean";
  return workflowState;
}

function deriveNextSafeAction(status, review) {
  if (status === "cleanup-pending") return "retry-temporary-cleanup";
  if (status === "inactive") return "continue-parent-task";
  if (status === "needs-selection") return "select-or-combine-direction";
  if (status === "locked") return "implement-one-selected-direction";
  if (status === "clean") return "complete-parent-task";
  if (review?.result === "pass") return "close-temporary-session";
  if (review?.result === "fix-and-recapture") {
    return "fix-one-implementation-and-recapture";
  }
  return "resolve-visual-review-blocker";
}

export function buildAtlasHandoff(rawInput) {
  const input = requireObject(rawInput, "input");
  const authority = requireObject(
    input.authorityDecision,
    "authorityDecision",
  );
  const mode = requireEnum(authority.mode, MODES, "authorityDecision.mode");
  const inventionBudget = requireInteger(
    authority.inventionBudget,
    "authorityDecision.inventionBudget",
    0,
    3,
  );
  const previewCount = requireInteger(
    authority.previewCount,
    "authorityDecision.previewCount",
    0,
    3,
  );
  const visualAuthority = requireString(
    authority.authority?.visual,
    "authorityDecision.authority.visual",
    64,
  );
  const workflowState = requireEnum(
    input.workflowState,
    WORKFLOW_STATES,
    "workflowState",
  );
  if (mode === "fidelity" && previewCount !== 0) {
    throw new Error("Fidelity mode cannot expose alternative directions.");
  }
  if (workflowState === "needs-selection" && previewCount === 0) {
    throw new Error("Selection cannot be pending when no previews are allowed.");
  }

  const exactFigmaIdentity = parseExactFigma(authority);
  const directionCards = parseDirectionCards(
    input.directionCards,
    previewCount,
    workflowState,
  );
  const selectedContract = parseSelectedContract(
    input.selectedContract,
    workflowState,
    mode,
  );
  const stateMatrix = parseStateMatrix(input.stateMatrix);
  const visualReview = parseReview(input.visualReview, workflowState);
  const cleanup = parseCleanup(input.cleanup, workflowState);
  const sourceReceiptIds = uniqueCheckedStrings(
    input.sourceReceiptIds,
    "sourceReceiptIds",
    RECEIPT_ID,
    12,
  );
  const atlasHandles = uniqueCheckedStrings(
    input.atlasHandles,
    "atlasHandles",
    ATLAS_HANDLE,
    6,
  );
  const status = deriveStatus(workflowState, cleanup.state);
  const nextSafeAction = deriveNextSafeAction(status, visualReview);

  const handoff = {
    schemaVersion: 1,
    surface: {
      primary: "codex-handoff",
      runner: "secondary-experimental",
      inspector: "progressive-disclosure",
    },
    status,
    readyForImplementation:
      status === "locked" && cleanup.state !== "cleanup-pending",
    authority: {
      mode,
      inventionBudget,
      visual: visualAuthority,
      ...(exactFigmaIdentity ? { exactFigmaIdentity } : {}),
    },
    ...(directionCards.length > 0 ? { directionCards } : {}),
    ...(selectedContract ? { selectedContract } : {}),
    ...(stateMatrix ? { stateMatrix } : {}),
    ...(visualReview ? { visualReview } : {}),
    provenance: {
      sourceReceiptIds,
      atlasHandles,
      receiptsExpanded: false,
    },
    cleanup,
    nextSafeAction,
    capsuleProjection: {
      sourceReceiptIds,
      handles: selectedContract
        ? [selectedContract.contractHandle, ...atlasHandles].slice(0, 4)
        : atlasHandles.slice(0, 4),
      nextSafeAction,
    },
  };

  if (Buffer.byteLength(JSON.stringify(handoff), "utf8") > MAX_HANDOFF_BYTES) {
    throw new Error("Visual-direction handoff exceeds its 3 KB context budget.");
  }
  return handoff;
}

async function readInput(argv) {
  const inputIndex = argv.indexOf("--input");
  if (inputIndex >= 0) {
    const inputPath = argv[inputIndex + 1];
    if (!inputPath) throw new Error("--input requires a JSON file path.");
    return JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
  }
  if (process.stdin.isTTY) {
    throw new Error("Pass --input <json-file> or pipe JSON to stdin.");
  }
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

async function main() {
  const input = await readInput(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(buildAtlasHandoff(input), null, 2)}\n`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
