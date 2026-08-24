import { createHash } from "node:crypto";
import {
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  buildReuseContext,
  searchComponentContext,
  slash,
  type ComponentDecision,
  type ComponentGraph,
  type DecisionKind,
  type Framework,
} from "@component-atlas/core";
import {
  buildFigmaDesignIndex,
  decisionGate,
  designIndexSummary,
  inspectDesignNode,
  isDesignSnapshotCurrent,
  mergeDesignIndexes,
  normalizeDesignIndex,
  normalizeDesignVariableCatalog,
  parseFigmaReference,
  queryDesignVariables,
  rankDesignCandidates,
  resolveExplicitDesignTarget,
  type BuildFigmaDesignIndexInput,
  type DesignCandidateResult,
  type DesignFileIndex,
  type DesignFinding,
  type DesignIndexSummary,
  type DesignLinkRecord,
  type DesignNodeInspection,
  type DesignVariableQueryOptions,
  type DesignVariableQueryResult,
} from "@component-atlas/design";
import {
  AtlasStore,
  projectStorageDirectory,
} from "@component-atlas/store";
import { loadProjectGraph } from "./scan.js";
import { enrichThemeFingerprintWithFigma } from "./theme-fingerprint.js";

export { detectProjectProfile } from "./profile.js";
export {
  listDesignLinks,
  loadDesignCoverageLedger,
  recordDesignCoverageLedger,
  registerDesignLink,
} from "./design-planning.js";
export {
  validateDiff,
  type ConfirmedOperation,
  type DiffValidationFinding,
  type DiffFindingCode,
  type ValidateDiffOptions,
  type ValidateDiffResult,
} from "./validate-diff.js";
export {
  assertLockedChangeSurfaceArtifact,
  computeLockedChangeSurfaceIntegrity,
  isLockedChangeSurface,
  lockedChangeSurfaceArtifactPath,
  normalizeLockedChangeIntent,
  normalizeLockedEvidenceHandles,
} from "./change-surface-lock.js";
export {
  canonicalJson,
  computeScopedChangeSurfaceFingerprints,
  type ScopedChangeSurfaceFingerprints,
} from "./change-surface-fingerprint.js";
export {
  captureGitBaseline,
  captureGitDelta,
  compareGitDelta,
  type GitBaselineReference,
  type GitDeltaCaptureLimits,
  type GitDeltaEntry,
  type GitDeltaLine,
  type GitDeltaResult,
  type GitDeltaStatus,
} from "./git-delta.js";
export {
  expandVisualEvidenceContract,
  loadVisualEvidenceContract,
  persistVisualEvidenceContract,
  type PersistVisualEvidenceContractInput,
  type VisualEvidenceContract,
} from "./visual-contract.js";
export {
  assessLatestFigmaSnapshotReuse,
  expandFigmaSnapshot,
  loadFigmaSnapshot,
  loadLatestFigmaSnapshot,
  persistFigmaSnapshot,
  persistFigmaSnapshotWithCheckpoint,
  FIGMA_SNAPSHOT_HANDLE_PATTERN,
  FIGMA_SNAPSHOT_SCHEMA_VERSION,
  MAX_FIGMA_SNAPSHOT_BYTES,
  MAX_FIGMA_SNAPSHOT_ITEMS,
  type AssessLatestFigmaSnapshotReuseInput,
  type FigmaSemanticItem,
  type FigmaSemanticProperty,
  type FigmaSemanticVariant,
  type FigmaSnapshot,
  type FigmaSnapshotCategory,
  type FigmaSnapshotCheckpointResult,
  type FigmaSnapshotContent,
  type FigmaSnapshotCoverage,
  type FigmaSnapshotCoverageEntry,
  type FigmaSnapshotCoverageStatus,
  type FigmaSnapshotIdentity,
  type FigmaSnapshotReuseAssessment,
  type FigmaSnapshotReuseStatus,
  type PersistFigmaSnapshotInput,
} from "./figma-snapshot.js";
export {
  amendTaskEvidenceContract,
  expandTaskContinuationBundle,
  expandTaskEvidenceContract,
  loadLatestTaskContinuationBundle,
  loadLatestTaskEvidenceContract,
  loadTaskContinuationBundle,
  loadTaskEvidenceContract,
  persistTaskContinuationBundle,
  persistTaskContinuationBundleWithCheckpoint,
  persistTaskEvidenceContract,
  persistTaskEvidenceContractWithCheckpoint,
  preserveTaskCriterionProgress,
  taskAcceptanceState,
  MAX_TASK_CONTINUATION_BUNDLE_BYTES,
  MAX_TASK_EVIDENCE_CONTRACT_BYTES,
  TASK_CONTINUATION_BUNDLE_SCHEMA_VERSION,
  TASK_CONTINUATION_HANDLE_PATTERN,
  TASK_EVIDENCE_CONTRACT_HANDLE_PATTERN,
  TASK_EVIDENCE_CONTRACT_SCHEMA_VERSION,
  type PersistTaskContinuationBundleInput,
  type PersistTaskEvidenceContractInput,
  type TaskArtifactCheckpointMetadata,
  type TaskArtifactCheckpointResult,
  type TaskAcceptanceState,
  type TaskContinuationBundle,
  type TaskCriterionProgress,
  type TaskCriterionStatus,
  type TaskEvidenceContract,
  type TaskEvidenceCriterion,
  type TaskEvidenceDecision,
  type TaskEvidenceDecisionStatus,
} from "./task-evidence-contract.js";
export {
  type TaskEvidenceContractAmendment,
  type TaskEvidenceCriterionPatch,
  type TaskEvidenceDecisionPatch,
} from "./task-evidence-amendment.js";
export {
  expandTaskFeedbackEvent,
  loadTaskFeedbackQueue,
  loadTaskFeedbackEvent,
  persistTaskFeedbackEvent,
  type PersistTaskFeedbackInput,
  type TaskFeedbackEvent,
  type TaskFeedbackKind,
  type TaskFeedbackStatus,
} from "./task-feedback.js";
export {
  expandTaskGitReconciliation,
  inspectTaskGit,
  loadTaskGitReconciliation,
  reconcileTaskGit,
  type TaskGitReconciliation,
  type TaskGitReconciliationState,
} from "./task-git-reconciliation.js";
export {
  assertVisualCleanupReceipt,
  expandVisualReviewReceipt,
  loadVisualReviewReceipt,
  persistVisualReviewReceipt,
  type LegacyVisualReviewCapture,
  type LegacyVisualReviewReceipt,
  type PersistVisualReviewReceiptInput,
  type StrictVisualReviewReceipt,
  type VisualCleanupReceiptMetadata,
  type VisualReviewCase,
  type VisualReviewCapture,
  type VisualReviewFigmaComparison,
  type VisualReviewFigmaComparisonStatus,
  type VisualReviewReceipt,
} from "./visual-review-receipt.js";
export {
  assertVisualArtifactSessionClean,
  parseVisualCaptureReceiptBinding,
  verifyVisualCaptureReceipt,
  verifyVisualSelectionReceipt,
  visualCaptureReceiptSession,
  visualSelectionReceiptSession,
  type VerifiedVisualCaptureReceipt,
  type VerifiedVisualSelectionReceipt,
  type VisualCaptureReceiptBinding,
} from "./visual-artifact-receipt.js";
export {
  expandTaskCompletionReceipt,
  loadTaskCompletionReceipt,
  persistTaskCompletionReceipt,
  type ExpandTaskCompletionReceiptOptions,
  type PersistTaskCompletionReceiptInput,
  type TaskCompletionReceipt,
  type TaskCompletionResult,
  type TaskCompletionVisualReview,
} from "./task-completion-receipt.js";
export {
  assertTaskCompletionIntentRequest,
  claimTaskCompletionIntent,
  commitTaskCompletionIntent,
  loadTaskCompletionCommit,
  loadTaskCompletionIntent,
  normalizeTaskCompletionIntentRequest,
  type TaskCompletionCommit,
  type TaskCompletionIntent,
  type TaskCompletionIntentBindings,
  type TaskCompletionIntentRequest,
  type TaskCompletionProjection,
} from "./task-completion-intent.js";
export {
  clearContextCostAudits,
  contextCostReport,
  exportContextCostAudits,
  importContextCostAudits,
  listContextCostAudits,
  recordContextCostAudit,
  type ContextContractCostInput,
  type RecordContextCostAuditInput,
} from "./context-cost.js";
export {
  clearUsageTracesV2,
  configureUsageTelemetry,
  disableUsageTelemetry,
  exportUsageTracesV2,
  ingestUsageTelemetryPayload,
  importCodexJsonlUsage,
  listUsageTracesV2,
  recordCompactHook,
  startUsageTelemetryServer,
  usageTelemetryStatus,
  type UsageTelemetryOptions,
  type UsageTelemetryStatus,
} from "./usage-telemetry.js";
export {
  detectFramework,
  loadProjectGraph,
  scanProject,
  type ScanProjectOptions,
} from "./scan.js";
export {
  normalizeRepositoryRemote,
  resolveProjectIdentity,
  type ResolveProjectIdentityOptions,
  type ResolvedProjectIdentity,
} from "./identity.js";
export {
  inspectProjectAtlasStorage,
  legacyProjectAtlasStorageRoots,
  projectAtlasStorageRoot,
  projectAtlasTempRoot,
  projectStorageDirectory,
  readRecentProjects,
  recentProjectsPath,
  type ProjectAtlasStorageDiagnostic,
} from "@component-atlas/store";

export {
  canonicalFilesystemPath,
  filesystemPathKey,
  filesystemPathsEquivalent,
} from "./path-identity.js";
export {
  migrateLegacyProjectStorage,
  parseLegacyDecisionMarkdown,
  removeMigratedLegacyProjectStorage,
  type LegacyMigrationCategory,
  type LegacyMigrationCategoryReport,
  type LegacyMigrationMode,
  type LegacyProjectCleanupReport,
  type LegacyProjectMigrationReport,
} from "./legacy-migration.js";
export {
  extractOpenApiTaskContext,
  loadConfirmedOpenApiContext,
  type ConfirmedOpenApiSource,
  type OpenApiTaskContext,
  type OpenApiSourceResolver,
} from "./openapi.js";
export {
  assertDevelopmentAuthMockGuard,
  assertDevelopmentAuthMockRuntime,
  assertSessionlessAuthMockResult,
  type DevelopmentAuthMockGuard,
  type DevelopmentAuthMockRuntimeEvidence,
} from "./auth-mocks.js";
export {
  assertFigmaDesktopAssetUrl,
  captureFigmaAsset,
  loadFigmaAssetMetadata,
  materializeFigmaAsset,
  purgeExpiredFigmaAssets,
  purgeTaskFigmaAssets,
  type FigmaAssetFormat,
  type FigmaAssetLoader,
  type FigmaAssetMetadata,
  type LoadedFigmaAsset,
} from "./figma-assets.js";
export {
  assertPublicRemoteUrl,
  assertSameOriginTransition,
  canonicalizePublicOpenApiReference,
  isOpenApiDocument,
  privateNetworkAddress,
  readPublicDocument,
  type CanonicalOpenApiDocument,
  type PublicAddress,
  type PublicAddressResolver,
  type PublicDocument,
  type PublicDocumentLoader,
} from "./openapi-source.js";
export {
  prepareTaskContext,
  TaskPreparationBlockedError,
  type GuardedTaskContextDependencies,
  type PrepareTaskContextOptions,
  type TaskContextOptions,
} from "./task-preparation.js";
export {
  appendTaskJournalMilestone,
  encodeResumeCapsule,
  expandSourceReceipt,
  loadConfirmedTaskSourceDecision,
  loadPersistedSourceReceipt,
  loadTaskFinalReceipt,
  loadTaskResumeCapsule,
  loadTaskResumeTransport,
  loadTaskSourceLedger,
  lockTaskChangeSurface,
  persistSourceReceipts,
  pruneExpiredTaskState,
  resolveTaskObjective,
  taskContextResumeHandles,
  validateTaskFinalReceipt,
  validateTaskResumeCapsule,
  validateTaskSourceLedger,
  writeTaskCheckpoint,
  type ResumeCapsuleTransport,
  type LockedConfirmedOperation,
  type LockedChangeSurface,
  type LockedReuseDecision,
  type LockedSurfacePrimary,
  type LockedSurfaceReference,
  type LockTaskChangeSurfaceInput,
  type TaskCheckpointInput,
  type TaskCompletionSummary,
  type TaskFinalReceipt,
  type TaskFeedbackSummary,
  type TaskLineage,
  type TaskChangeInvalidation,
  type TaskChangeInvalidationInput,
  type TaskLifecycle,
  type TaskLifecyclePhase,
  type TaskValidationReference,
  type TaskVisualReview,
  type LegacyTaskVisualReview,
  type ReceiptTaskVisualReview,
  type TaskJournalMilestone,
  type TaskResumeCapsule,
  type TaskSourceLedger,
  type TaskContextHandleSource,
} from "./task-state.js";
export {
  listTaskResumeCandidates,
  recoverTaskResumeState,
  type TaskResumeCandidate,
  type TaskResumeRecovery,
} from "./task-recovery.js";
export {
  clearTaskFocus,
  readTaskFocus,
  writeTaskFocus,
  type TaskFocus,
} from "./task-focus.js";
export {
  computeTaskObjectiveHash,
  computeTaskObjectiveIntegrity,
  isTaskObjectiveProjection,
  loadTaskObjectiveArtifact,
  MAX_TASK_OBJECTIVE_CHARS,
  normalizeTaskObjective,
  persistTaskObjective,
  resolveTaskObjectiveProjection,
  TASK_OBJECTIVE_ARTIFACT_SCHEMA_VERSION,
  TASK_OBJECTIVE_HANDLE_PATTERN,
  taskObjectiveArtifactPath,
  taskObjectiveReference,
  validateTaskObjectiveReference,
  type PersistTaskObjectiveInput,
  type ResolvedTaskObjective,
  type TaskObjectiveArtifact,
  type TaskObjectiveProjection,
  type TaskObjectiveReference,
} from "./task-objective.js";
export {
  isTaskGovernance,
  MAX_TASK_GOVERNANCE_REASON_CHARS,
  MAX_TASK_GOVERNANCE_REASONS,
  mergeTaskGovernance,
  normalizeTaskGovernance,
  TASK_REVIEW_TIER_ORDER,
  TASK_RISK_ORDER,
  TASK_SIZE_ORDER,
  type TaskGovernance,
  type TaskReviewTier,
  type TaskRisk,
  type TaskSize,
} from "./task-governance.js";
export {
  beginMemoryConsentExecution,
  commitMemoryConsentExecution,
  committedMemoryConsentResult,
  consumeMemoryConsent,
  issueMemoryConsent,
  loadMemoryConsentState,
  type MemoryConsentAction,
  type MemoryConsentReceipt,
  type MemoryConsentState,
  type PersistedMemoryConsent,
} from "./memory-consent-receipt.js";
export {
  changeSurfaceRetrievalKey,
  claimTaskRetrieval,
  completeTaskRetrieval,
  loadTaskExecutionManifest,
  loadTaskRetrievalResult,
  reuseRetrievalKey,
  writeTaskExecutionManifest,
  type TaskExecutionManifest,
  type TaskExecutionManifestInput,
  type TaskExecutionManifestProjection,
  type TaskExecutionPhase,
  type TaskRetrievalClaim,
  type TaskRetrievalInvalidationReason,
  type TaskRetrievalKind,
  TaskRetrievalBudgetExceededError,
} from "./task-execution.js";

export interface RecordDecisionInput {
  rootPath: string;
  intent: string;
  decision: DecisionKind;
  selectedComponentIds?: string[];
  rejectedComponentIds?: string[];
  rationale: string;
  author?: string;
  scope?: "checkout" | "project";
  confirmedProjectScope?: boolean;
  taskId?: string;
}

export interface MapFigmaDesignInput extends BuildFigmaDesignIndexInput {
  rootPath: string;
  force?: boolean;
}

export interface MapFigmaDesignResult {
  status: "created" | "updated" | "unchanged";
  summary: DesignIndexSummary;
}

export interface SyncFigmaDesignVariablesInput {
  rootPath: string;
  figmaFile: string;
  catalog: unknown;
  syncedAt?: string;
}

export interface SyncFigmaDesignVariablesResult {
  status: "updated" | "unchanged";
  variables: DesignIndexSummary["variables"];
}

export interface TaskDesignCandidateResult extends DesignCandidateResult {
  task: string;
  project: {
    name: string;
    framework: Framework;
    scannedAt: string;
  };
  designFile: DesignFileIndex["file"];
  atlasCandidates: ReturnType<typeof searchComponentContext>;
}

function variableCatalogFingerprint(
  catalog: DesignFileIndex["variables"],
): string {
  const { syncedAt: _syncedAt, ...content } = catalog;
  return JSON.stringify(content);
}

export async function recordDecision(
  input: RecordDecisionInput,
): Promise<ComponentDecision> {
  const allowedDecisions: DecisionKind[] = [
    "reuse",
    "extend",
    "compose",
    "extract-and-reuse",
    "create",
    "not-applicable",
  ];
  if (!allowedDecisions.includes(input.decision)) {
    throw new Error(
      `Invalid decision "${input.decision}". Expected ${allowedDecisions.join(", ")}.`,
    );
  }
  const rootPath = path.resolve(input.rootPath);
  const graph = await loadProjectGraph(rootPath);
  const scope = input.scope ?? "checkout";
  if (scope === "project" && input.confirmedProjectScope !== true) {
    throw new Error(
      "Project-scoped component decisions require explicit confirmation.",
    );
  }
  const checkoutId = graph.project.identity?.checkoutId;
  if (scope === "checkout" && !checkoutId) {
    throw new Error(
      "A checkout-scoped component decision requires a resolved checkout identity.",
    );
  }
  const createdAt = new Date().toISOString();
  const createCandidates =
    input.decision === "create"
      ? buildReuseContext(graph, input.intent).candidates.slice(0, 8)
      : [];
  const consideredCandidates =
    input.decision === "create"
      ? createCandidates.map((candidate) => ({
          componentId: candidate.component.id,
          outcome: "rejected" as const,
          reasons:
            candidate.match.reasons.length > 0
              ? candidate.match.reasons
              : ["Candidate did not satisfy the recorded creation rationale."],
          evidence: [
            candidate.component.path,
            ...candidate.api.props.slice(0, 5).map((prop) => prop.name),
          ],
        }))
      : undefined;
  const rejectedComponentIds = [
    ...new Set([
      ...(input.rejectedComponentIds ?? []),
      ...createCandidates.map((candidate) => candidate.component.id),
    ]),
  ];
  if (input.taskId && !/^[A-Za-z0-9_.:-]{1,160}$/u.test(input.taskId)) {
    throw new Error("Component decision task ID is invalid.");
  }
  const decisionKey = input.taskId
    ? createHash("sha256")
        .update(
          [
            graph.project.id,
            checkoutId ?? "",
            input.taskId,
            input.decision,
            scope,
            [...(input.selectedComponentIds ?? [])].sort().join(","),
          ].join("\0"),
        )
        .digest("hex")
        .slice(0, 24)
    : undefined;
  const id = createHash("sha256")
    .update(
      [
        graph.project.id,
        input.taskId ?? createdAt,
        input.intent,
        input.decision,
        input.rationale,
        scope,
        checkoutId ?? "",
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 24);
  const store = new AtlasStore(graph.project.id);
  const decisions = store.listDecisions(graph.project.id, checkoutId);
  const existing = decisions.find((candidate) => candidate.id === id);
  if (existing) {
    store.close();
    return existing;
  }
  const prior = decisionKey
    ? decisions.find(
        (candidate) =>
          candidate.decisionKey === decisionKey &&
          candidate.status !== "superseded",
      )
    : undefined;
  const decision: ComponentDecision = {
    id,
    projectId: graph.project.id,
    createdAt,
    intent: input.intent,
    decision: input.decision,
    selectedComponentIds: input.selectedComponentIds ?? [],
    rejectedComponentIds,
    ...(consideredCandidates ? { consideredCandidates } : {}),
    rationale: input.rationale,
    ...(input.author ? { author: input.author } : {}),
    scope,
    ...(scope === "checkout" && checkoutId ? { checkoutId } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(decisionKey ? { decisionKey, status: "active" as const } : {}),
    ...(prior ? { supersedes: [prior.id] } : {}),
    provenance: {
      scope,
      origin:
        scope === "project" ? "user-confirmation" : "agent-observation",
      observedAt: createdAt,
      projectId: graph.project.id,
      ...(checkoutId ? { checkoutId } : {}),
      promotion:
        scope === "project" ? "confirmed" : "requires-confirmation",
      invalidatesOn:
        scope === "project" ? "explicit-replacement" : "checkout-change",
    },
  };
  try {
    if (prior) {
      store.saveDecision({
        ...prior,
        status: "superseded",
        supersededBy: decision.id,
      });
    }
    store.saveDecision(decision);
  } finally {
    store.close();
  }
  const directory = path.join(
    projectStorageDirectory(graph.project.id),
    "decisions",
  );
  await mkdir(directory, { recursive: true });
  const slug = slash(input.intent)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const fileName = `${createdAt.slice(0, 10)}-${slug || decision.id}.md`;
  await writeFile(
    path.join(directory, fileName),
    `# Component decision

- Intent: ${input.intent}
- Decision: ${input.decision}
- Recorded: ${createdAt}
- Scope: ${scope}${checkoutId ? ` (${checkoutId})` : ""}
- Selected: ${decision.selectedComponentIds.join(", ") || "none"}
- Rejected: ${decision.rejectedComponentIds.join(", ") || "none"}
${decision.consideredCandidates?.map((candidate) => `- Considered ${candidate.componentId}: ${candidate.reasons.join("; ")} [${candidate.evidence.join(", ")}]`).join("\n") ?? ""}

## Rationale

${input.rationale}
`,
    "utf8",
  );
  return decision;
}

export function graphSummary(graph: ComponentGraph): Record<string, unknown> {
  const componentNodes = graph.components.filter(
    (item) => (item.kind ?? "component") === "component",
  );
  const edgeCounts = Object.fromEntries(
    [
      "renders",
      "similar_to",
      "tested_by",
      "uses_layout",
      "route_parent",
      "hydrates",
      "defers",
    ].map((kind) => [
      kind,
      graph.edges.filter((edge) => edge.kind === kind).length,
    ]),
  );
  return {
    projectId: graph.project.id,
    project: graph.project.name,
    framework: graph.project.framework,
    profile: graph.project.profile
      ? {
          frameworks: graph.project.profile.frameworks,
          packages: graph.project.profile.packages.map((packageProfile) => ({
            name: packageProfile.name,
            relativeRoot: packageProfile.relativeRoot,
            frameworks: packageProfile.frameworks,
            metaFramework: packageProfile.metaFramework,
            router: packageProfile.router,
            versions: packageProfile.versions,
            confidence: packageProfile.confidence,
          })),
          confidence: graph.project.profile.confidence,
        }
      : undefined,
    identity: graph.project.identity
      ? {
          source: graph.project.identity.source,
          repositoryFingerprint: graph.project.identity.repositoryFingerprint,
          checkoutId: graph.project.identity.checkoutId,
          branch: graph.project.identity.branch,
        }
      : undefined,
    nodes: graph.components.length,
    components: componentNodes.length,
    public: componentNodes.filter((item) => item.visibility === "public").length,
    feature: componentNodes.filter((item) => item.visibility === "feature").length,
    private: componentNodes.filter((item) => item.visibility === "private").length,
    edges: edgeCounts,
    tokens: graph.tokens.length,
    scannedAt: graph.project.scannedAt,
    scan: graph.project.scan,
  };
}

export async function mapFigmaDesign(
  input: MapFigmaDesignInput,
): Promise<MapFigmaDesignResult> {
  const rootPath = path.resolve(input.rootPath);
  const graph = await loadProjectGraph(rootPath);
  const incoming = buildFigmaDesignIndex(input);
  const store = new AtlasStore(graph.project.id);
  try {
    const existing = store.loadDesignIndex(
      graph.project.id,
      incoming.file.key,
    );
    const replaceVariables =
      input.enrichment?.variableCatalog !== undefined;
    const variablesChanged =
      replaceVariables &&
      (!existing ||
        variableCatalogFingerprint(existing.variables) !==
          variableCatalogFingerprint(incoming.variables));
    if (
      existing &&
      !input.force &&
      isDesignSnapshotCurrent(existing, incoming) &&
      !variablesChanged
    ) {
      return { status: "unchanged", summary: designIndexSummary(existing) };
    }
    const next = existing
      ? mergeDesignIndexes(existing, incoming, { replaceVariables })
      : incoming;
    store.saveDesignIndex(graph.project.id, next);
    for (const node of next.nodes) {
      for (const connection of node.codeConnections) {
        const matches = graph.components.filter((component) =>
          [
            component.name,
            component.effectiveName,
            component.exportName,
          ].includes(connection.componentName),
        );
        if (matches.length !== 1) continue;
        const component = matches[0]!;
        const identity = [
          graph.project.id,
          next.file.key,
          node.id,
          component.id,
          "code-connect-exact",
        ].join("\0");
        const link: DesignLinkRecord = {
          schemaVersion: 1,
          id: `design-link:${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`,
          projectId: graph.project.id,
          fileKey: next.file.key,
          nodeId: node.id,
          componentId: component.id,
          source: "code-connect-exact",
          scope: "project",
          ...(graph.project.identity?.head
            ? { commit: graph.project.identity.head }
            : {}),
          confidence: "high",
          receiptIds: node.sourceReceiptIds,
          createdAt: next.indexedAt,
        };
        store.saveDesignLink(link);
      }
    }
    if (graph.themeFingerprint) {
      const themeFingerprint = enrichThemeFingerprintWithFigma(
        graph.themeFingerprint,
        [next],
      );
      if (themeFingerprint.hash !== graph.themeFingerprint.hash) {
        store.replaceGraph({ ...graph, themeFingerprint });
      }
    }
    return {
      status: existing ? "updated" : "created",
      summary: designIndexSummary(next),
    };
  } finally {
    store.close();
  }
}

export async function syncFigmaDesignVariables(
  input: SyncFigmaDesignVariablesInput,
): Promise<SyncFigmaDesignVariablesResult> {
  const rootPath = path.resolve(input.rootPath);
  const graph = await loadProjectGraph(rootPath);
  const reference = parseFigmaReference(input.figmaFile);
  const store = new AtlasStore(graph.project.id);
  try {
    const existing = store.loadDesignIndex(
      graph.project.id,
      reference.fileKey,
    );
    if (!existing) {
      throw new Error(
        `No Design Index exists for Figma file ${reference.fileKey}. Map sparse metadata before synchronizing Variables.`,
      );
    }
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    if (!Number.isFinite(Date.parse(syncedAt))) {
      throw new Error("Variables syncedAt must be a valid date-time.");
    }
    const variables = normalizeDesignVariableCatalog(input.catalog, syncedAt);
    if (
      variables.syncedAt &&
      !Number.isFinite(Date.parse(variables.syncedAt))
    ) {
      throw new Error("Variables catalog syncedAt must be a valid date-time.");
    }
    if (
      variableCatalogFingerprint(existing.variables) ===
      variableCatalogFingerprint(variables)
    ) {
      const next =
        existing.variables.syncedAt === variables.syncedAt
          ? existing
          : normalizeDesignIndex({ ...existing, variables });
      if (next !== existing) store.saveDesignIndex(graph.project.id, next);
      return {
        status: "unchanged",
        variables: designIndexSummary(next).variables,
      };
    }
    const next = normalizeDesignIndex({ ...existing, variables });
    store.saveDesignIndex(graph.project.id, next);
    return {
      status: "updated",
      variables: designIndexSummary(next).variables,
    };
  } finally {
    store.close();
  }
}

export async function getFigmaDesignVariables(
  rootPath: string,
  figmaFile: string,
  options: DesignVariableQueryOptions = {},
): Promise<DesignVariableQueryResult> {
  const index = await loadFigmaDesignIndex(rootPath, figmaFile);
  return queryDesignVariables(index, options);
}

export async function listFigmaDesignIndexes(
  rootPath: string,
): Promise<DesignIndexSummary[]> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  try {
    return store
      .listDesignIndexes(graph.project.id)
      .map(designIndexSummary);
  } finally {
    store.close();
  }
}

export async function loadFigmaDesignIndex(
  rootPath: string,
  figmaFile: string,
): Promise<DesignFileIndex> {
  const graph = await loadProjectGraph(rootPath);
  const reference = parseFigmaReference(figmaFile);
  const store = new AtlasStore(graph.project.id);
  try {
    const index = store.loadDesignIndex(graph.project.id, reference.fileKey);
    if (!index) {
      throw new Error(
        `No Design Index exists for Figma file ${reference.fileKey}. Map its sparse metadata first.`,
      );
    }
    return index;
  } finally {
    store.close();
  }
}

export async function findTaskDesignCandidates(
  rootPath: string,
  task: string,
  options: { figmaFile?: string; limit?: number } = {},
): Promise<TaskDesignCandidateResult> {
  const graph = await loadProjectGraph(rootPath);
  const store = new AtlasStore(graph.project.id);
  let designIndex: DesignFileIndex;
  try {
    const indexes = store.listDesignIndexes(graph.project.id);
    if (options.figmaFile) {
      const reference = parseFigmaReference(options.figmaFile);
      const selected = indexes.find(
        (index) => index.file.key === reference.fileKey,
      );
      if (!selected) {
        throw new Error(
          `No Design Index exists for Figma file ${reference.fileKey}.`,
        );
      }
      designIndex = selected;
    } else {
      if (indexes.length === 0) {
        throw new Error(
          "No Figma Design Index exists for this repository. Map one file before requesting design candidates.",
        );
      }
      if (indexes.length > 1) {
        throw new Error(
          `This repository has ${indexes.length} Figma indexes. Specify figma_file to keep candidate ranking explicit.`,
        );
      }
      designIndex = indexes[0]!;
    }
  } finally {
    store.close();
  }
  const atlasCandidates = searchComponentContext(graph, task, 3);
  const explicitReference = options.figmaFile
    ? parseFigmaReference(options.figmaFile)
    : undefined;
  const result = explicitReference?.nodeId
    ? resolveExplicitDesignTarget(designIndex, explicitReference.nodeId)
    : rankDesignCandidates(designIndex, task, {
        ...(options.limit ? { limit: options.limit } : {}),
        codeSignals: atlasCandidates.map(
          (candidate) => candidate.component.name,
        ),
      });
  const apiFindings = atlasCandidates.flatMap((candidate): DesignFinding[] => {
    const component = graph.components.find(
      (item) => item.id === candidate.component.id,
    );
    if (!component) return [];
    const booleanProps = component.props.filter((prop) =>
      /\bboolean\b/i.test(prop.type),
    );
    if (component.props.length < 12 && booleanProps.length < 4) return [];
    return [
      {
        id: `suspicious-component-api:${component.id}`,
        level: "warning",
        code: "suspicious-component-api",
        title: `Existing component API may be costly to extend: ${component.effectiveName}`,
        evidence: [
          `${component.relativePath} exposes ${component.props.length} props.`,
          ...(booleanProps.length >= 4
            ? [
                `Boolean variants: ${booleanProps
                  .slice(0, 8)
                  .map((prop) => prop.name)
                  .join(", ")}.`,
              ]
            : []),
        ],
        recommendation:
          "Inspect responsibility and change impact before adding another prop; prefer composition or extraction when the new behavior is independent.",
      },
    ];
  });
  const findings = [...result.findings, ...apiFindings];
  return {
    task: task.trim(),
    project: {
      name: graph.project.name,
      framework: graph.project.framework,
      scannedAt: graph.project.scannedAt,
    },
    designFile: designIndex.file,
    atlasCandidates,
    candidates: result.candidates,
    findings,
    gate: decisionGate(findings),
  };
}

export async function inspectFigmaDesignNode(
  rootPath: string,
  figmaFile: string,
  selector: string,
): Promise<DesignNodeInspection> {
  const index = await loadFigmaDesignIndex(rootPath, figmaFile);
  return inspectDesignNode(index, selector);
}

export {
  fitBudgetedResponse,
  indexProjectMemory,
  searchProjectMemory,
  getProjectMemoryItem,
  orientProject,
  checkBeforeChange,
} from "./memory.js";
export { getTaskContext } from "./memory-task-context.js";
export {
  applyMemoryUpdate,
  combineMemoryProposals,
  proposeMemoryUpdate,
  recordProjectOutcome,
  rejectMemoryUpdate,
  reviewMemoryProposal,
  reviseMemoryProposal,
  type ProposeMemoryUpdateInput,
  type RecordOutcomeInput,
} from "./memory-proposals.js";
export * from "./view-models.js";
export * from "./identity.js";
export * from "./integrations.js";
