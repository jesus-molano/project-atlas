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
const RECEIPT_ID = /^receipt-(?:[a-f0-9]{16}|[a-f0-9]{64})$/u;
const ATLAS_HANDLE = /^(?:code|design|memory):[^\u0000-\u001f]{1,240}$/u;
const VISUAL_HANDLE = /^visual:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const SELECTION_RECEIPT =
  /^selection-receipt:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}:[a-z0-9]+:[a-f0-9]{16}$/u;
const RETRY_ID = /^vd-[A-Za-z0-9_-]+$/u;
const CAPTURE_HANDLE = /^artifact-([a-f0-9]{12})-[a-f0-9]{8}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CAPTURE_RECEIPT =
  /^capture-receipt:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:[a-f0-9]{16}:[a-f0-9]{16}$/u;
const REVIEW_HANDLE =
  /^visual-review:[A-Za-z0-9_.:-]{1,160}:[a-f0-9]{16}$/u;
const CLEANUP_RECEIPT =
  /^cleanup:v1:[a-f0-9]{16}:vd-[A-Za-z0-9_-]+:(?:close|cancel|expired):[a-z0-9]+:[a-f0-9]{16}$/u;
const MAX_HANDOFF_BYTES = 8_192;
const MAX_VISUAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

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

function requireArray(value, label, maximumItems) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  if (value.length > maximumItems) {
    throw new RangeError(`${label} exceeds ${maximumItems} items.`);
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

function parseSelectedContract(value, workflowState) {
  if (value === undefined) {
    if (["locked", "review"].includes(workflowState)) {
      throw new Error(
        "Locked or review state requires a selected visual contract receipt, including fidelity mode.",
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
  const selectionReceipt = requireString(
    selected.selectionReceipt,
    "selectedContract.selectionReceipt",
    260,
  );
  if (!VISUAL_HANDLE.test(contractHandle)) {
    throw new Error("selectedContract.contractHandle is invalid.");
  }
  if (!HASH.test(contractHash)) {
    throw new Error("selectedContract.contractHash is invalid.");
  }
  if (!SELECTION_RECEIPT.test(selectionReceipt)) {
    throw new Error("selectedContract.selectionReceipt is invalid.");
  }
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("selectedContract.expiresAt must be an ISO timestamp.");
  }
  const ttl = Date.parse(expiresAt) - Date.now();
  if (ttl <= 0 || ttl > MAX_VISUAL_TTL_MS) {
    throw new Error(
      "selectedContract.expiresAt must be in the future and at most seven days away.",
    );
  }
  const summary = value.summary
    ? requireString(value.summary, "selectedContract.summary", 360)
    : undefined;
  const selectedDirectionId = value.selectedDirectionId
    ? requireString(
        value.selectedDirectionId,
        "selectedContract.selectedDirectionId",
        160,
      )
    : undefined;
  return {
    contractHandle,
    contractHash,
    selectionReceipt,
    expiresAt,
    ...(summary ? { summary } : {}),
    ...(selectedDirectionId ? { selectedDirectionId } : {}),
  };
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
  const captures = review.captures === undefined
    ? []
    : requireArray(review.captures, "visualReview.captures", 24).map(
        (rawCapture, index) => {
          const capture = requireObject(
            rawCapture,
            `visualReview.captures[${index}]`,
          );
          const handle = requireString(
              capture.handle,
              `visualReview.captures[${index}].handle`,
              260,
            );
          const hash = requireString(
            capture.hash,
            `visualReview.captures[${index}].hash`,
            64,
          );
          const receipt = requireString(
            capture.receipt,
            `visualReview.captures[${index}].receipt`,
            260,
          );
          const handleMatch = CAPTURE_HANDLE.exec(handle);
          if (!handleMatch || !SHA256.test(hash) || handleMatch[1] !== hash.slice(0, 12)) {
            throw new Error(
              `visualReview.captures[${index}] must bind a temporary-artifact handle to its full SHA256.`,
            );
          }
          if (!CAPTURE_RECEIPT.test(receipt)) {
            throw new Error(
              `visualReview.captures[${index}].receipt is invalid.`,
            );
          }
          return {
            handle,
            hash,
            receipt,
            viewport: requireString(
              capture.viewport,
              `visualReview.captures[${index}].viewport`,
              48,
            ),
            state: requireString(
              capture.state,
              `visualReview.captures[${index}].state`,
              48,
            ),
          };
        },
      );
  const captureCount = requireInteger(
    review.captureCount ?? captures.length,
    "visualReview.captureCount",
    0,
    24,
  );
  if (captures.length > 0 && captureCount !== captures.length) {
    throw new Error("visualReview.captureCount must match captures.length.");
  }
  let preliminaryReviewHandle;
  if (review.preliminaryReviewHandle !== undefined) {
    preliminaryReviewHandle = requireString(
      review.preliminaryReviewHandle,
      "visualReview.preliminaryReviewHandle",
      260,
    );
    if (!REVIEW_HANDLE.test(preliminaryReviewHandle)) {
      throw new Error("visualReview.preliminaryReviewHandle is invalid.");
    }
  }
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
    captureCount,
    captures,
    ...(preliminaryReviewHandle ? { preliminaryReviewHandle } : {}),
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
  let receipt;
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
  if (state === "clean") {
    receipt = requireString(cleanup.receipt, "cleanup.receipt", 260);
    if (!CLEANUP_RECEIPT.test(receipt)) {
      throw new Error("cleanup.receipt is not a content-free cleanup receipt.");
    }
  } else if (cleanup.receipt !== undefined) {
    throw new Error("Only clean cleanup state may carry a cleanup receipt.");
  }
  return {
    state,
    blocksCompletion: state === "cleanup-pending",
    ...(retrySessionId ? { retrySessionId } : {}),
    ...(receipt ? { receipt } : {}),
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
  const rootPath = requireString(input.rootPath, "rootPath", 1_024);
  if (!path.isAbsolute(rootPath)) {
    throw new Error("rootPath must be an absolute repository path.");
  }
  const taskId = requireString(input.taskId, "taskId", 160);
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(taskId)) {
    throw new Error("taskId is invalid.");
  }
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
  );
  if (
    selectedContract &&
    !new Set(["exact-figma", "existing-system", "selected-direction"]).has(
      visualAuthority,
    )
  ) {
    throw new Error(
      "A selected visual contract requires resolved visual authority.",
    );
  }
  const stateMatrix = parseStateMatrix(input.stateMatrix);
  const visualReview = parseReview(input.visualReview, workflowState);
  const cleanup = parseCleanup(input.cleanup, workflowState);
  if (visualReview) {
    if (!stateMatrix) {
      throw new Error("A structured visual review requires a stateMatrix.");
    }
    const pairs = visualReview.captures.map(
      (capture) => `${capture.viewport}\0${capture.state}`,
    );
    if (new Set(pairs).size !== pairs.length) {
      throw new Error("Visual review capture viewport/state pairs must be unique.");
    }
    if (
      visualReview.captures.some(
        (capture) =>
          !stateMatrix.viewports.includes(capture.viewport) ||
          !stateMatrix.requiredStates.includes(capture.state),
      )
    ) {
      throw new Error("Every visual review capture must belong to the stateMatrix.");
    }
    const coveredViewports = new Set(
      visualReview.captures.map((capture) => capture.viewport),
    );
    const coveredStates = new Set(
      visualReview.captures.map((capture) => capture.state),
    );
    if (
      visualReview.result === "pass" &&
      (!stateMatrix.viewports.every((viewport) => coveredViewports.has(viewport)) ||
        !stateMatrix.requiredStates.every((state) => coveredStates.has(state)))
    ) {
      throw new Error(
        "A passing visual review must cover every viewport and required state in stateMatrix.",
      );
    }
    if (
      visualReview.result === "pass" &&
      cleanup.state === "clean" &&
      !cleanup.receipt?.includes(":close:")
    ) {
      throw new Error(
        "A passing clean review requires a normal close cleanup receipt.",
      );
    }
    if (visualReview.result === "pass" && cleanup.state === "not-applicable") {
      throw new Error(
        "Registered temporary-artifact captures require clean cleanup evidence for a passing review.",
      );
    }
    if (cleanup.state === "clean" && !visualReview.preliminaryReviewHandle) {
      throw new Error(
        "A final clean review requires visualReview.preliminaryReviewHandle.",
      );
    }
    if (
      cleanup.state !== "clean" &&
      visualReview.preliminaryReviewHandle
    ) {
      throw new Error(
        "Only a final clean review may reference a preliminary review.",
      );
    }
  }
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
  const visualSummary = selectedContract
    ? selectedContract.summary ??
      [
        `${mode} visual contract`,
        stateMatrix?.surface,
        visualReview ? `review:${visualReview.result}` : undefined,
      ]
        .filter(Boolean)
        .join("; ")
    : undefined;
  const attachEvidence =
    selectedContract || sourceReceiptIds.length > 0
      ? {
          root_path: rootPath,
          task_id: taskId,
          action: "attach-evidence",
          ...(sourceReceiptIds.length > 0
            ? { receipt_ids: sourceReceiptIds }
            : {}),
          ...(selectedContract
            ? {
                visual_contract: {
                  handle: selectedContract.contractHandle,
                  hash: selectedContract.contractHash,
                  selection_receipt: selectedContract.selectionReceipt,
                  authority: visualAuthority,
                  summary: visualSummary,
                  ...(selectedContract.selectedDirectionId
                    ? {
                        selected_direction_id:
                          selectedContract.selectedDirectionId,
                      }
                    : {}),
                  ...(exactFigmaIdentity
                    ? {
                        figma: {
                          file_key: exactFigmaIdentity.fileKey,
                          node_id: exactFigmaIdentity.nodeId,
                        },
                      }
                    : {}),
                  receipt_ids: sourceReceiptIds,
                  expires_at: selectedContract.expiresAt,
                },
              }
            : {}),
        }
      : undefined;
  let taskState = attachEvidence;
  if (visualReview) {
    if (!selectedContract || !stateMatrix) {
      throw new Error(
        "A structured visual review requires the locked selectedContract and stateMatrix.",
      );
    }
    if (visualReview.result === "pass" && visualReview.captures.length === 0) {
      throw new Error("A passing visual review requires capture handles.");
    }
    if (
      !new Set([
        "clean",
        "selected-retained",
        "not-applicable",
        "cleanup-pending",
      ]).has(cleanup.state)
    ) {
      throw new Error("Visual review cleanup state is not ready for Atlas handoff.");
    }
    taskState = {
      root_path: rootPath,
      task_id: taskId,
      action: "attach-review",
      visual_review: {
        contract_handle: selectedContract.contractHandle,
        contract_hash: selectedContract.contractHash,
        state_matrix: {
          surface: stateMatrix.surface,
          viewports: stateMatrix.viewports,
          required_states: stateMatrix.requiredStates,
        },
        captures: visualReview.captures,
        result: visualReview.result,
        deviation_count: visualReview.deviationCount,
        cleanup: {
          state: cleanup.state,
          ...(cleanup.receipt
            ? { receipt: cleanup.receipt }
            : {}),
        },
        ...(visualReview.preliminaryReviewHandle
          ? {
              preliminary_review_handle:
                visualReview.preliminaryReviewHandle,
            }
          : {}),
      },
    };
  }

  const handoff = {
    schemaVersion: 1,
    surface: {
      owner: "native-codex",
      atlasProfile: "core-six-tool",
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
    ...(visualReview
      ? {
          visualReview: {
            result: visualReview.result,
            deviationCount: visualReview.deviationCount,
            captureCount: visualReview.captureCount,
            ...(visualReview.preliminaryReviewHandle
              ? {
                  preliminaryReviewHandle:
                    visualReview.preliminaryReviewHandle,
                }
              : {}),
          },
        }
      : {}),
    provenance: {
      sourceReceiptIds,
      atlasHandles,
      receiptsExpanded: false,
    },
    cleanup,
    nextSafeAction,
    coreProjection: {
      ...(taskState ? { taskState } : {}),
      resumeHandles: [
        ...(selectedContract ? [selectedContract.contractHandle] : []),
        ...atlasHandles,
      ].slice(0, 4),
      checkpoint: {
        root_path: rootPath,
        task_id: taskId,
        action: "checkpoint",
        covered: [
          `visual-authority:${mode}`,
          ...(selectedContract ? ["visual-contract:locked"] : []),
          ...(visualReview ? [`visual-review:${visualReview.result}`] : []),
        ],
        remaining:
          status === "clean"
            ? ["parent-technical-close"]
            : [nextSafeAction],
        next_action: nextSafeAction,
      },
    },
  };

  if (Buffer.byteLength(JSON.stringify(handoff), "utf8") > MAX_HANDOFF_BYTES) {
    throw new Error("Visual-direction handoff exceeds its 8 KB evidence budget.");
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
