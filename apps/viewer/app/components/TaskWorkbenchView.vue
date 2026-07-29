<script setup lang="ts">
import type {
  ActionCapabilityManifest,
  AgentAdapterStatus,
  AgentRunEvent,
  AgentRunMode,
  AgentSandbox,
  AgentSourceReference,
} from "@component-atlas/agent/browser";
import { memoryCloseoutActionMessage } from "@component-atlas/agent/browser";
import {
  assessTaskIntake,
  assessTaskRisk,
  confirmedTaskSources,
  detectTaskSources,
  ensureTaskSourceDecisions,
  isMissingTaskSourceReference,
  taskSourceId,
  type TaskIntakeState,
  type TaskSourceDecision,
  type TaskSourceKind,
  type ActionResolution,
  type AgentRunAuditRecord,
  type ProjectCapabilityReport,
  type ProjectIdentityMetadata,
} from "@component-atlas/core/browser";
import type { DesignFileIndex } from "@component-atlas/design";
import { parseFigmaReference } from "@component-atlas/design/browser";
import {
  capabilityDisplayState,
  isSimulatedCapability,
} from "~/utils/capabilities";

interface ContextFinding {
  id: string;
  level: "decision-required" | "warning" | "resolved";
  title: string;
  recommendation: string;
  question?: string;
  evidence?: string[];
}

interface CompactContext {
  taskId?: string;
  checkpoint?: ResumeCheckpoint;
  task: string;
  project?: { name: string; framework: string; scannedAt: string };
  memory?: Array<Record<string, unknown>>;
  code?: Array<Record<string, unknown>>;
  design?: {
    available: boolean;
    selectionRequired?: boolean;
    files?: Array<{ key: string; name?: string }>;
    candidates?: Array<Record<string, unknown>>;
  };
  api?: {
    available: boolean;
    format: "openapi" | "swagger" | "mixed";
    contracts: number;
    operations: Array<{ method: string; path: string }>;
    authentication: Array<Record<string, unknown>>;
  };
  findings?: ContextFinding[];
  gate?: {
    overall?: {
      status: "blocked" | "review" | "clear";
      questions: string[];
    };
  };
  nextSteps?: string[];
  metrics: {
    budgetChars: number;
    usedChars: number;
    estimatedTokens: number;
    truncated: boolean;
    totalMatches: number;
    expandableIds: string[];
    retrieval?: {
      indexedBytesInjected: 0;
      hits: number;
      misses: number;
      retries: number;
      connectorsQueried: string[];
      receiptsExpanded: number;
    };
  };
  sourceReceiptIds?: string[];
}

interface ResumeCheckpoint {
  taskId: string;
  status: "active" | "blocked" | "completed";
  updatedAt: string;
  objective: { text: string; approved: boolean };
  sourceReceiptIds: string[];
  handles: string[];
  scope: { covered: string[]; remaining: string[] };
  workspace: { rootPath: string; head: string };
  budget: { contextChars: number; estimatedTokens: number };
  nextSafeAction: string;
}

type RunState =
  | "queued"
  | "running"
  | "awaiting-input"
  | "completed"
  | "failed"
  | "cancelled";

interface RunResponse {
  id: string;
  state: RunState;
  mode: AgentRunMode;
  purpose?: "task" | "figma-sync";
  sandbox: AgentSandbox;
  startingFingerprint: string;
  currentFingerprint: string;
  stale: boolean;
  threadId?: string;
  events: Array<{ cursor: number; event: AgentRunEvent }>;
  nextCursor: number;
  checkpoint?: ResumeCheckpoint;
}

interface RunSummary {
  id: string;
  state: RunState;
  mode: AgentRunMode;
  sandbox: AgentSandbox;
  sourceKinds: AgentSourceReference["kind"][];
  sourceDecisions: TaskSourceDecision[];
  startingFingerprint: string;
  currentFingerprint: string;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
  threadId?: string;
  resumable: boolean;
  checkpoint?: ResumeCheckpoint;
}

type FigmaSyncStatus =
  | "idle"
  | "confirmed-unsynced"
  | "loading"
  | "available"
  | "error";

interface FigmaSyncState {
  status: FigmaSyncStatus;
  message: string;
}

const props = defineProps<{
  designIndexes: DesignFileIndex[];
  capabilities: ProjectCapabilityReport;
  workspaceFingerprint: string;
  projectName: string;
  projectRoot: string;
  identity?: ProjectIdentityMetadata;
  defaultBudget: number;
  defaultTopK: number;
  initialTask?: string;
  pinnedHandles?: string[];
  localMetricsEnabled?: boolean;
  recentRuns?: AgentRunAuditRecord[];
  recentActions?: ActionResolution[];
}>();

const emit = defineEmits<{
  updateTask: [value: string];
  workspaceChanged: [];
  figmaSyncState: [value: FigmaSyncState];
}>();
const { formatDate, formatNumber, runtimeMessage, statusLabel, t } =
  useAtlasI18n();

const task = ref(props.initialTask ?? "");
const mode = ref<AgentRunMode>("prepare");
const objectiveConfirmed = ref(false);
const budgetChars = ref(props.defaultBudget);
const topK = ref(props.defaultTopK);
const figmaFile = ref("");
const advancedOpen = ref(false);
const contextOptionsOpen = ref(false);
const sourceKind = ref<TaskSourceKind>("figma");
const sourceValue = ref("");
const sourceRequired = ref(false);
const replacementFor = ref("");
const sourceDecisions = ref<TaskSourceDecision[]>([]);
const taskId = ref("");
const context = ref<CompactContext>();
const contextPending = ref(false);
const contextError = ref("");
const agentStatus = ref<AgentAdapterStatus>();
const agentToken = ref("");
const actions = ref<ActionCapabilityManifest[]>([]);
const activeRun = ref<RunResponse>();
const runSummaries = ref<RunSummary[]>([]);
const selectedRunId = ref("");
const figmaSyncAttemptRunId = ref<string>();
const figmaSyncAttemptSourceIds = ref<string[]>([]);
const runEvents = ref<Array<{ cursor: number; event: AgentRunEvent }>>([]);
const runError = ref("");
const launchReviewOpen = ref(false);
const launchSandbox = ref<AgentSandbox>("read-only");
const answer = ref("");
const correction = ref("");
const copied = ref(false);
const acknowledgedFindingIds = ref<Set<string>>(new Set());
const recordedRuns = new Set<string>();
const preparedAt = ref<number>();
const preparationMs = ref(0);
let pollTimer: ReturnType<typeof setTimeout> | undefined;

const risk = computed(() => assessTaskRisk(task.value));
const intake = computed<TaskIntakeState>(() => ({
  schemaVersion: 1,
  scope: "task",
  objective: task.value,
  objectiveConfirmed: objectiveConfirmed.value,
  risk: risk.value,
  sources: sourceDecisions.value,
}));
const intakeAssessment = computed(() => assessTaskIntake(intake.value));
const sources = computed(() =>
  confirmedTaskSources(sourceDecisions.value).map((source) => ({
    kind: source.kind,
    value: source.reference,
  })),
);
const sourceCounts = computed(() => ({
  confirmed: sourceDecisions.value.filter((source) => source.state === "confirmed")
    .length,
  pending: sourceDecisions.value.filter((source) => source.state === "pending")
    .length,
  omitted: sourceDecisions.value.filter((source) => source.state === "omitted")
    .length,
  unavailable: sourceDecisions.value.filter(
    (source) => source.state === "unavailable",
  ).length,
}));
const resumableRuns = computed(() =>
  runSummaries.value.filter((run) => run.resumable),
);
const selectedRun = computed(() =>
  resumableRuns.value.find((run) => run.id === selectedRunId.value),
);
const taskModes = computed(() => [
  { id: "prepare" as const, label: t("Prepare"), disabled: false },
  {
    id: "continue" as const,
    label: t("Continue"),
    disabled: !resumableRuns.value.length,
  },
  {
    id: "correct" as const,
    label: t("Correct"),
    disabled: !resumableRuns.value.length,
  },
]);
const intentLabel = computed(() =>
  mode.value === "continue"
    ? t("What is the next step?")
    : mode.value === "correct"
      ? t("What should be corrected?")
      : t("What needs to change?"),
);
const intentPlaceholder = computed(() =>
  mode.value === "continue"
    ? t("Describe only the next step for the selected Codex task.")
    : mode.value === "correct"
      ? t("Describe the incorrect result and the required correction.")
      : t("Describe the frontend outcome. Add links only when they are useful."),
);
const blockingFindings = computed(() =>
  (context.value?.findings ?? []).filter(
    (finding) => finding.level === "decision-required",
  ),
);
const pendingBlockingFindings = computed(() =>
  blockingFindings.value.filter(
    (finding) => !acknowledgedFindingIds.value.has(finding.id),
  ),
);
const displayGateStatus = computed(() => {
  if (!context.value) return "not reviewed";
  if (pendingBlockingFindings.value.length) {
    return context.value.gate?.overall?.status ?? "review";
  }
  if (blockingFindings.value.length) return "reviewed";
  return context.value.gate?.overall?.status ?? "clear";
});
const canGenerateContext = computed(
  () =>
    intakeAssessment.value.status === "ready" &&
    Boolean(agentToken.value) &&
    pendingFigmaSources.value.length === 0 &&
    (mode.value === "prepare" || Boolean(selectedRun.value)),
);
const reviewFingerprint = computed(
  () =>
    activeRun.value?.currentFingerprint ??
    selectedRun.value?.currentFingerprint ??
    props.workspaceFingerprint,
);
const confirmedFigmaSources = computed(() =>
  sourceDecisions.value.filter(
    (source) => source.kind === "figma" && source.state === "confirmed",
  ),
);
const pendingFigmaSources = computed(() =>
  confirmedFigmaSources.value.filter((source) => {
    try {
      const target = parseFigmaReference(source.reference.replace(/^figma:/, ""));
      const index = props.designIndexes.find(
        (candidate) => candidate.file.key === target.fileKey,
      );
      if (!index) return true;
      if (!target.nodeId) {
        return !index.sources.some(
          (snapshot) =>
            snapshot.receipt.requested.fileKey === target.fileKey &&
            snapshot.receipt.resolved.fileKey === target.fileKey &&
            snapshot.receipt.freshness === "current",
        );
      }
      const node = index.nodes.find((candidate) => candidate.id === target.nodeId);
      if (!node) return true;
      return !index.sources.some(
        (snapshot) =>
          node.sourceReceiptIds.includes(snapshot.receipt.id) &&
          snapshot.receipt.requested.fileKey === target.fileKey &&
          snapshot.receipt.requested.nodeId === target.nodeId &&
          snapshot.receipt.resolved.fileKey === target.fileKey &&
          snapshot.receipt.resolved.nodeId === target.nodeId &&
          snapshot.receipt.scope.kind === "node" &&
          snapshot.receipt.scope.id === target.nodeId &&
          snapshot.receipt.freshness === "current",
      );
    } catch {
      return true;
    }
  }),
);
const figmaSyncState = computed<FigmaSyncState>(() => {
  if (!confirmedFigmaSources.value.length) {
    return { status: "idle", message: "No Figma source confirmed for this task." };
  }
  const attemptCoversConfirmed = confirmedFigmaSources.value.every((source) =>
    figmaSyncAttemptSourceIds.value.includes(source.id),
  );
  const attemptedRun =
    attemptCoversConfirmed && activeRun.value?.id === figmaSyncAttemptRunId.value
      ? activeRun.value
      : undefined;
  if (attemptedRun && ["queued", "running"].includes(attemptedRun.state)) {
    return {
      status: "loading",
      message: "Synchronizing the confirmed source through Figma Desktop MCP.",
    };
  }
  if (
    attemptedRun &&
    ["failed", "cancelled", "awaiting-input"].includes(attemptedRun.state)
  ) {
    return {
      status: "error",
      message:
        "Figma source could not be synchronized. Check Figma Desktop MCP access, then retry the exact target.",
    };
  }
  if (!pendingFigmaSources.value.length) {
    return {
      status: "available",
      message:
        "Design Atlas has the exact confirmed target. Prepare task is now available.",
    };
  }
  if (
    attemptedRun &&
    attemptedRun.state === "completed"
  ) {
    return {
      status: "error",
      message:
        "Figma source could not be synchronized. Check Figma Desktop MCP access, then retry the exact target.",
    };
  }
  return {
    status: "confirmed-unsynced",
    message:
      "Figma source confirmed, not synchronized. Synchronize the exact target before preparing context.",
  };
});
const figmaSyncLabel = computed(() => {
  if (figmaSyncState.value.status === "loading") return t("Figma · loading");
  if (figmaSyncState.value.status === "available") return t("Figma · available");
  if (figmaSyncState.value.status === "error") {
    return t("Figma · no access or sync error");
  }
  return t("Figma · confirmed, not synchronized");
});
const confirmedFigmaTarget = computed(() => {
  if (confirmedFigmaSources.value.length !== 1) return undefined;
  try {
    return parseFigmaReference(
      confirmedFigmaSources.value[0]!.reference.replace(/^figma:/, ""),
    );
  } catch {
    return undefined;
  }
});
const figmaSyncTargetLabel = computed(() => {
  const target = confirmedFigmaTarget.value;
  if (!target) return confirmedFigmaSources.value[0]?.reference ?? "";
  return target.nodeId ? `${target.fileKey} · ${target.nodeId}` : target.fileKey;
});
const figmaSyncProgress = computed(() => {
  const latest = [...runEvents.value].reverse().find(
    (item) =>
      item.event.type === "activity" ||
      item.event.type === "run-started" ||
      item.event.type === "question" ||
      item.event.type === "completed" ||
      item.event.type === "failed" ||
      item.event.type === "cancelled",
  );
  if (!latest) return "";
  if (latest.event.type === "question") return latest.event.prompt;
  if (latest.event.type === "completed") return latest.event.result.summary;
  return eventLabel(latest.event);
});
const canStartFigmaSync = computed(
  () =>
    ["confirmed-unsynced", "error"].includes(figmaSyncState.value.status) &&
    confirmedFigmaSources.value.length === 1 &&
    Boolean(confirmedFigmaTarget.value?.nodeId) &&
    intakeAssessment.value.status === "ready" &&
    agentStatus.value?.state === "detected" &&
    !["queued", "running"].includes(activeRun.value?.state ?? ""),
);
const figmaSyncBlockReason = computed(() => {
  if (confirmedFigmaSources.value.length !== 1) {
    return t("Confirm exactly one authoritative Figma target.");
  }
  if (!confirmedFigmaTarget.value?.nodeId) {
    return t("The confirmed Figma target must include an exact file and node ID.");
  }
  if (intakeAssessment.value.status !== "ready") {
    return intakeAssessment.value.reasons[0]
      ? runtimeMessage(intakeAssessment.value.reasons[0])
      : t("Confirm the task objective and resolve every source decision first.");
  }
  if (agentStatus.value?.state !== "detected") {
    return t("The local Codex integration must be available to run Figma Desktop MCP.");
  }
  return "";
});
const taskSessionKey = computed(
  () =>
    `atlas-task:${props.identity?.logicalId ?? props.projectName}:${
      props.identity?.checkoutId ?? props.projectRoot
    }`,
);

const capabilitySummary = computed(() =>
  props.capabilities.observations.filter(
    (item) => item.kind === "connector" || item.state !== "unknown",
  ),
);

const activeAction = computed(() =>
  actions.value.find((action) => {
    if (mode.value === "continue" || mode.value === "correct") {
      return action.id === "continue-frontend-task";
    }
    return launchSandbox.value === "workspace-write"
      ? action.id === "implement-frontend-task"
      : action.id === "prepare-frontend-task";
  }),
);

const latestResult = computed(() => {
  const completed = [...runEvents.value]
    .reverse()
    .find((item) => item.event.type === "completed");
  return completed?.event.type === "completed"
    ? completed.event.result
    : undefined;
});
const activeCheckpoint = computed(
  () =>
    activeRun.value?.checkpoint ??
    selectedRun.value?.checkpoint ??
    context.value?.checkpoint,
);

const materialQuestion = computed(() => {
  const question = [...runEvents.value]
    .reverse()
    .find((item) => item.event.type === "question");
  return question?.event.type === "question" ? question.event : undefined;
});

const progressEvents = computed(() =>
  runEvents.value.filter(
    (item) =>
      item.event.type === "run-started" ||
      item.event.type === "activity" ||
      item.event.type === "failed" ||
      item.event.type === "cancelled",
  ),
);

function addSource(): void {
  const value = sourceValue.value.trim();
  if (!value) return;
  const id = taskSourceId(sourceKind.value, value);
  const source: TaskSourceDecision = {
    id,
    kind: sourceKind.value,
    reference: value,
    origin: "manual",
    state: "confirmed",
    required: sourceRequired.value,
    relationship: "primary",
    ...(replacementFor.value ? { replacementFor: replacementFor.value } : {}),
    decidedAt: new Date().toISOString(),
  };
  if (replacementFor.value) {
    sourceDecisions.value = sourceDecisions.value.map((item) =>
      item.id === replacementFor.value
        ? { ...item, state: "replaced", decidedAt: new Date().toISOString() }
        : item,
    );
  }
  sourceDecisions.value = [
    ...sourceDecisions.value.filter(
      (item) =>
        item.id !== id &&
        !(
          item.kind === source.kind &&
          isMissingTaskSourceReference(item.reference)
        ),
    ),
    source,
  ];
  replacementFor.value = "";
  sourceValue.value = "";
  sourceRequired.value = false;
}

function decideSource(
  id: string,
  state: Extract<
    TaskSourceDecision["state"],
    "confirmed" | "omitted" | "unavailable"
  >,
): void {
  const current = sourceDecisions.value.find((source) => source.id === id);
  if (
    state === "confirmed" &&
    current &&
    isMissingTaskSourceReference(current.reference)
  ) {
    return;
  }
  sourceDecisions.value = sourceDecisions.value.map((source) =>
    source.id === id
      ? { ...source, state, decidedAt: new Date().toISOString() }
      : source,
  );
}

function removeManualSource(id: string): void {
  sourceDecisions.value = sourceDecisions.value.filter(
    (source) => source.id !== id || source.origin !== "manual",
  );
}

function beginSourceReplacement(id: string): void {
  replacementFor.value = id;
  const source = sourceDecisions.value.find((item) => item.id === id);
  if (source) sourceKind.value = source.kind;
  advancedOpen.value = true;
}

function syncDetectedSources(): void {
  const detected = detectTaskSources(task.value);
  for (const handle of props.pinnedHandles ?? []) {
    if (!handle.startsWith("design:")) continue;
    const [fileKey, nodeId] = handle.slice("design:".length).split("::");
    if (!fileKey) continue;
    const index = props.designIndexes.find((item) => item.file.key === fileKey);
    if (!index) continue;
    let reference = index.file.url;
    try {
      const url = new URL(index.file.url);
      if (nodeId) url.searchParams.set("node-id", nodeId.replace(":", "-"));
      reference = url.toString();
    } catch {
      if (nodeId) {
        reference = `https://www.figma.com/design/${encodeURIComponent(fileKey)}/Atlas?node-id=${encodeURIComponent(nodeId.replace(":", "-"))}`;
      }
    }
    const id = taskSourceId("figma", reference);
    if (!detected.some((source) => source.id === id)) {
      detected.push({
        id,
        kind: "figma",
        reference,
        origin: "inferred",
        state: "pending",
        required: false,
        relationship: "primary",
      });
    }
  }
  const detectedIds = new Set(detected.map((source) => source.id));
  const retained =
    mode.value === "prepare"
      ? sourceDecisions.value.filter(
          (source) => source.origin === "manual" || detectedIds.has(source.id),
        )
      : [...sourceDecisions.value];
  for (const source of detected) {
    if (!retained.some((candidate) => candidate.id === source.id)) {
      retained.push(source);
    }
  }
  sourceDecisions.value = ensureTaskSourceDecisions(task.value, retained);
}

function selectMode(nextMode: AgentRunMode): void {
  if (nextMode !== "prepare" && !resumableRuns.value.length) return;
  mode.value = nextMode;
  context.value = undefined;
  activeRun.value = undefined;
  runEvents.value = [];
  acknowledgedFindingIds.value = new Set();
  launchReviewOpen.value = false;
  if (nextMode !== "prepare") {
    selectedRunId.value ||= resumableRuns.value[0]?.id ?? "";
    launchSandbox.value = selectedRun.value?.sandbox ?? "read-only";
    sourceDecisions.value = selectedRun.value?.sourceDecisions ?? [];
  } else {
    launchSandbox.value = "read-only";
  }
}

function selectResumableRun(): void {
  launchSandbox.value = selectedRun.value?.sandbox ?? "read-only";
  sourceDecisions.value = selectedRun.value?.sourceDecisions ?? [];
  context.value = undefined;
  activeRun.value = undefined;
  runEvents.value = [];
  acknowledgedFindingIds.value = new Set();
}

async function generateContext(): Promise<void> {
  if (!canGenerateContext.value) return;
  if (!agentToken.value) await loadAgentSurface();
  if (!agentToken.value) return;
  preparedAt.value = Date.now();
  contextPending.value = true;
  contextError.value = "";
  copied.value = false;
  try {
    context.value = await $fetch<CompactContext>("/api/task-context", {
      method: "POST",
      headers: { "x-atlas-session": agentToken.value },
      body: {
        ...(taskId.value ? { taskId: taskId.value } : {}),
        task: task.value,
        objectiveConfirmed: objectiveConfirmed.value,
        sourceDecisions: sourceDecisions.value,
        budgetChars: budgetChars.value,
        topK: topK.value,
        selectedHandles: props.pinnedHandles ?? [],
        ...(figmaFile.value ? { figmaFile: figmaFile.value } : {}),
      },
    });
    taskId.value = context.value.taskId ?? taskId.value;
    preparationMs.value = Math.max(0, Date.now() - (preparedAt.value ?? Date.now()));
  } catch (caught) {
    contextError.value = atlasErrorSource(caught, "Local context failed.");
  } finally {
    contextPending.value = false;
  }
}

async function loadAgentSurface(): Promise<void> {
  try {
    const session = await $fetch<{ token: string }>("/api/agent/session");
    agentToken.value = session.token;
    const headers = { "x-atlas-session": session.token };
    [agentStatus.value, actions.value, runSummaries.value] = await Promise.all([
      $fetch<AgentAdapterStatus>("/api/agent/status", { headers }),
      $fetch<ActionCapabilityManifest[]>("/api/actions"),
      $fetch<RunSummary[]>("/api/agent/runs", { headers }),
    ]);
    selectedRunId.value ||= resumableRuns.value[0]?.id ?? "";
  } catch (caught) {
    runError.value = atlasErrorSource(
      caught,
      "Codex integration status is unavailable.",
    );
  }
}

async function startFigmaSync(): Promise<void> {
  if (figmaSyncState.value.status === "loading") return;
  if (!agentToken.value) await loadAgentSurface();
  if (!agentToken.value || !canStartFigmaSync.value) return;
  runError.value = "";
  contextError.value = "";
  runEvents.value = [];
  try {
    activeRun.value = await $fetch<RunResponse>("/api/agent/figma-sync", {
      method: "POST",
      headers: { "x-atlas-session": agentToken.value },
      body: {
        task: task.value,
        objectiveConfirmed: objectiveConfirmed.value,
        sourceDecisions: sourceDecisions.value,
        expectedFingerprint: props.workspaceFingerprint,
      },
    });
    figmaSyncAttemptRunId.value = activeRun.value.id;
    figmaSyncAttemptSourceIds.value = confirmedFigmaSources.value.map(
      (source) => source.id,
    );
    pollRun();
  } catch (caught) {
    runError.value = atlasErrorSource(
      caught,
      "The exact Figma target could not be synchronized.",
    );
  }
}

function reviewLaunch(sandbox: AgentSandbox): void {
  if (pendingBlockingFindings.value.length) return;
  launchSandbox.value = sandbox;
  launchReviewOpen.value = true;
}

async function startRun(): Promise<void> {
  if (
    !context.value ||
    !agentToken.value ||
    intakeAssessment.value.status !== "ready" ||
    pendingBlockingFindings.value.length
  ) {
    return;
  }
  launchReviewOpen.value = false;
  runError.value = "";
  runEvents.value = [];
  try {
    if (
      (mode.value === "continue" || mode.value === "correct") &&
      selectedRun.value
    ) {
      activeRun.value = await $fetch<RunResponse>(
        `/api/agent/runs/${selectedRun.value.id}/resume`,
        {
          method: "POST",
          headers: { "x-atlas-session": agentToken.value },
          body: {
            ...(mode.value === "correct"
              ? { correction: task.value }
              : { nextStep: task.value }),
            sourceDecisions: sourceDecisions.value,
            sandbox: launchSandbox.value,
            budgetChars: budgetChars.value,
            topK: topK.value,
            selectedHandles: props.pinnedHandles ?? [],
            figmaFile: figmaFile.value || null,
            expectedFingerprint: selectedRun.value.currentFingerprint,
          },
        },
      );
    } else {
      activeRun.value = await $fetch<RunResponse>("/api/agent/runs", {
        method: "POST",
        headers: { "x-atlas-session": agentToken.value },
        body: {
          task: task.value,
          objectiveConfirmed: objectiveConfirmed.value,
          sourceDecisions: sourceDecisions.value,
          budgetChars: budgetChars.value,
          topK: topK.value,
          selectedHandles: props.pinnedHandles ?? [],
          figmaFile: figmaFile.value || undefined,
          expectedFingerprint: props.workspaceFingerprint,
        },
      });
    }
    pollRun();
  } catch (caught) {
    runError.value = atlasErrorSource(caught, "Codex did not start.");
  }
}

async function pollRun(): Promise<void> {
  if (!activeRun.value || !agentToken.value) return;
  try {
    const response = await $fetch<RunResponse>(
      `/api/agent/runs/${activeRun.value.id}?after=${activeRun.value.nextCursor}`,
      { headers: { "x-atlas-session": agentToken.value } },
    );
    activeRun.value = response;
    runEvents.value.push(...response.events);
    if (response.id === figmaSyncAttemptRunId.value) {
      emit("workspaceChanged");
    }
    if (
      props.localMetricsEnabled &&
      response.state === "completed" &&
      !recordedRuns.has(response.id) &&
      context.value
    ) {
      recordedRuns.add(response.id);
      await $fetch("/api/evaluations", {
        method: "POST",
        headers: { "x-atlas-session": agentToken.value },
        body: {
          task: task.value,
          necessaryQuestions: runEvents.value.filter(
            (item) => item.event.type === "question",
          ).length,
          contextChars: context.value.metrics.usedChars,
          preparationMs: preparationMs.value,
          conflictCount: context.value.findings?.length ?? 0,
          reworkRequired: response.mode === "correct",
        },
      }).catch(() => undefined);
    }
    if (["queued", "running"].includes(response.state)) {
      pollTimer = setTimeout(pollRun, 700);
    } else {
      await refreshRunSummaries();
    }
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : "Agent activity could not refresh.";
    runError.value = message;
    if (/not found|expired/i.test(message)) {
      activeRun.value = undefined;
      launchSandbox.value = "read-only";
      runError.value =
        "The previous task thread expired. The draft and source ledger were kept; start a new read-only preparation.";
    }
  }
}

async function refreshRunSummaries(): Promise<void> {
  if (!agentToken.value) return;
  runSummaries.value = await $fetch<RunSummary[]>("/api/agent/runs", {
    headers: { "x-atlas-session": agentToken.value },
  });
  if (!selectedRun.value) {
    selectedRunId.value = resumableRuns.value[0]?.id ?? "";
  }
}

async function cancelRun(): Promise<void> {
  if (!activeRun.value) return;
  activeRun.value = await $fetch<RunResponse>(
    `/api/agent/runs/${activeRun.value.id}/cancel`,
    {
      method: "POST",
      headers: { "x-atlas-session": agentToken.value },
    },
  );
  pollTimer = setTimeout(pollRun, 150);
}

async function resumeRun(): Promise<void> {
  if (!activeRun.value || (!answer.value.trim() && !correction.value.trim())) {
    return;
  }
  if (sourceDecisions.value.some((source) => source.state === "pending")) return;
  runError.value = "";
  activeRun.value = await $fetch<RunResponse>(
    `/api/agent/runs/${activeRun.value.id}/resume`,
    {
      method: "POST",
      headers: { "x-atlas-session": agentToken.value },
      body: {
        answer: answer.value || undefined,
        correction: correction.value || undefined,
        sandbox: launchSandbox.value,
        mode: correction.value.trim() ? "correct" : "continue",
        sourceDecisions: sourceDecisions.value,
        budgetChars: budgetChars.value,
        topK: topK.value,
        selectedHandles: props.pinnedHandles ?? [],
        figmaFile: figmaFile.value || null,
        expectedFingerprint: activeRun.value.currentFingerprint,
      },
    },
  );
  answer.value = "";
  correction.value = "";
  pollTimer = setTimeout(pollRun, 100);
}

async function respondToMemoryCloseout(
  action: "confirm-canonical" | "decline",
): Promise<void> {
  if (!latestResult.value?.memoryCloseout) return;
  correction.value = memoryCloseoutActionMessage(
    latestResult.value.memoryCloseout,
    action,
  );
  await resumeRun();
}

async function implementReviewedRun(): Promise<void> {
  if (!activeRun.value || activeRun.value.state !== "completed") return;
  launchReviewOpen.value = false;
  launchSandbox.value = "workspace-write";
  runError.value = "";
  activeRun.value = await $fetch<RunResponse>(
    `/api/agent/runs/${activeRun.value.id}/resume`,
    {
      method: "POST",
      headers: { "x-atlas-session": agentToken.value },
      body: {
        answer:
          "Implement the reviewed brief in this checkout. Preserve the confirmed task scope and source ledger.",
        mode: "implement",
        sandbox: "workspace-write",
        expectedFingerprint: activeRun.value.currentFingerprint,
      },
    },
  );
  pollTimer = setTimeout(pollRun, 100);
}

function confirmLaunch(): void {
  if (mode.value !== "prepare") {
    void startRun();
  } else if (launchSandbox.value === "workspace-write") {
    void implementReviewedRun();
  } else {
    void startRun();
  }
}

function newTask(): void {
  if (pollTimer) clearTimeout(pollTimer);
  mode.value = "prepare";
  task.value = "";
  taskId.value = "";
  objectiveConfirmed.value = false;
  sourceDecisions.value = [];
  context.value = undefined;
  activeRun.value = undefined;
  figmaSyncAttemptRunId.value = undefined;
  figmaSyncAttemptSourceIds.value = [];
  runEvents.value = [];
  runError.value = "";
  sessionStorage.removeItem(taskSessionKey.value);
}

function persistTaskSession(): void {
  if (!import.meta.client) return;
  sessionStorage.setItem(
    taskSessionKey.value,
    JSON.stringify({
      schemaVersion: 1,
      scope: "task",
      task: task.value,
      taskId: taskId.value,
      mode: mode.value,
      selectedRunId: selectedRunId.value,
      objectiveConfirmed: objectiveConfirmed.value,
      sourceDecisions: sourceDecisions.value,
      context: context.value,
      activeRun: activeRun.value,
      figmaSyncAttemptRunId: figmaSyncAttemptRunId.value,
      figmaSyncAttemptSourceIds: figmaSyncAttemptSourceIds.value,
      runEvents: runEvents.value,
      budgetChars: budgetChars.value,
      topK: topK.value,
      figmaFile: figmaFile.value,
    }),
  );
}

function restoreTaskSession(): void {
  const raw = sessionStorage.getItem(taskSessionKey.value);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as {
      schemaVersion?: number;
      scope?: string;
      task?: string;
      taskId?: string;
      mode?: AgentRunMode;
      selectedRunId?: string;
      objectiveConfirmed?: boolean;
      sourceDecisions?: TaskSourceDecision[];
      context?: CompactContext;
      activeRun?: RunResponse;
      figmaSyncAttemptRunId?: string;
      figmaSyncAttemptSourceIds?: string[];
      runEvents?: Array<{ cursor: number; event: AgentRunEvent }>;
      budgetChars?: number;
      topK?: number;
      figmaFile?: string;
    };
    if (saved.schemaVersion !== 1 || saved.scope !== "task") return;
    if (saved.task) task.value = saved.task;
    taskId.value = saved.taskId ?? "";
    mode.value = saved.mode ?? "prepare";
    selectedRunId.value = saved.selectedRunId ?? "";
    objectiveConfirmed.value = saved.objectiveConfirmed ?? false;
    sourceDecisions.value = saved.sourceDecisions ?? [];
    context.value = saved.context;
    activeRun.value = saved.activeRun;
    figmaSyncAttemptRunId.value = saved.figmaSyncAttemptRunId;
    figmaSyncAttemptSourceIds.value = saved.figmaSyncAttemptSourceIds ?? [];
    runEvents.value = saved.runEvents ?? [];
    budgetChars.value = saved.budgetChars ?? budgetChars.value;
    topK.value = saved.topK ?? topK.value;
    figmaFile.value = saved.figmaFile ?? "";
  } catch {
    sessionStorage.removeItem(taskSessionKey.value);
  }
}

async function copyPackage(): Promise<void> {
  if (!context.value) return;
  const { checkpoint: _checkpoint, ...handoffContext } = context.value;
  await navigator.clipboard.writeText(
    [
      `$frontend-task ${task.value.trim()}`,
      "",
      "Use this bounded Project Atlas handoff. Expand handles or SourceReceipt IDs only when needed:",
      JSON.stringify(handoffContext),
    ].join("\n"),
  );
  copied.value = true;
}

function eventLabel(event: AgentRunEvent): string {
  if (event.type === "run-started") return t(event.message);
  if (event.type === "activity") return t(event.message);
  if (event.type === "failed") return t(event.message);
  if (event.type === "cancelled") return t(event.message);
  return statusLabel(event.type);
}

function toggleFindingAcknowledgement(finding: ContextFinding): void {
  const next = new Set(acknowledgedFindingIds.value);
  if (next.has(finding.id)) next.delete(finding.id);
  else next.add(finding.id);
  acknowledgedFindingIds.value = next;
}

function runOptionLabel(run: RunSummary): string {
  return `${formatDate(run.updatedAt)} · ${statusLabel(run.state)} · ${statusLabel(run.sandbox)}${run.stale ? ` · ${t("snapshot changed")}` : ""}`;
}

function launchButtonLabel(): string {
  if (mode.value === "continue") return t("Review continuation");
  if (mode.value === "correct") return t("Review correction");
  return confirmedFigmaSources.value.length
    ? t("Prepare with Codex & sync Figma")
    : t("Prepare with Codex");
}

const launchActionLabel = computed(() => {
  if (mode.value === "continue") return t("Continue this Codex task");
  if (mode.value === "correct") return t("Correct this Codex task");
  return launchSandbox.value === "workspace-write"
    ? t("Implement in this task")
    : t("Start read-only preparation");
});

onMounted(async () => {
  restoreTaskSession();
  syncDetectedSources();
  await loadAgentSurface();
  if (mode.value !== "prepare" && !sourceDecisions.value.length) {
    sourceDecisions.value = selectedRun.value?.sourceDecisions ?? [];
  }
  if (activeRun.value) pollRun();
});
watch(task, (value, previous) => {
  emit("updateTask", value);
  if (value !== previous) {
    objectiveConfirmed.value = false;
    context.value = undefined;
    syncDetectedSources();
  }
}, { flush: "sync" });
watch(figmaFile, (fileKey) => {
  if (!fileKey) return;
  const index = props.designIndexes.find((item) => item.file.key === fileKey);
  const reference = index?.file.url ?? `figma:${fileKey}`;
  const id = taskSourceId("figma", reference);
  if (sourceDecisions.value.some((source) => source.id === id)) return;
  sourceDecisions.value = [
    ...sourceDecisions.value,
    {
      id,
      kind: "figma",
      reference,
      origin: "manual",
      state: "confirmed",
      required: false,
      relationship: "primary",
      decidedAt: new Date().toISOString(),
    },
  ];
});
watch(
  [
    task,
    taskId,
    objectiveConfirmed,
    sourceDecisions,
    context,
    activeRun,
    figmaSyncAttemptRunId,
    figmaSyncAttemptSourceIds,
    runEvents,
    budgetChars,
    topK,
    figmaFile,
  ],
  persistTaskSession,
  { deep: true },
);
watch(
  figmaSyncState,
  (value) => emit("figmaSyncState", value),
  { deep: true, immediate: true },
);
watch(
  () => pendingFigmaSources.value.length,
  (count) => {
    if (
      count === 0 &&
      activeRun.value?.purpose === "figma-sync" &&
      !["queued", "running"].includes(activeRun.value.state)
    ) {
      activeRun.value = undefined;
      runEvents.value = [];
    }
  },
);
watch(
  () => props.initialTask,
  (value) => {
    if (value && value !== task.value) task.value = value;
  },
);
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
  persistTaskSession();
});
</script>

<template>
  <div class="workbench">
    <section class="workbench-composer" aria-labelledby="task-intent-heading">
      <div class="codex-sidecar-note">
        <AtlasIcon name="task" />
        <div>
          <strong>{{ t("Codex first · Atlas verifies the handoff") }}</strong>
          <span>{{ t("Use native Codex for conversation and execution. This surface controls scope, source integrity, and traceability.") }}</span>
        </div>
      </div>
      <div class="task-intake-controls">
        <div class="mode-switch" :aria-label="t('Task mode')">
          <button
            v-for="item in taskModes"
            :key="item.id"
            :class="['mode-button', { active: mode === item.id }]"
            :disabled="item.disabled || Boolean(activeRun)"
            :aria-pressed="mode === item.id"
            @click="selectMode(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
        <div class="task-status-row" :aria-label="t('Task intake status')">
          <span :class="['capability-pill', risk.level]">
            {{ t("{level} risk", { level: statusLabel(risk.level) }) }}
          </span>
          <span :class="['capability-pill', intakeAssessment.status]">
            {{ statusLabel(intakeAssessment.status) }}
          </span>
          <button v-if="activeRun" class="text-button" @click="newTask">
            {{ t("New task") }}
          </button>
        </div>
      </div>

      <label v-if="mode !== 'prepare'" class="resume-picker">
        <span>{{ t("Codex task to resume") }}</span>
        <select
          v-model="selectedRunId"
          :disabled="Boolean(activeRun)"
          @change="selectResumableRun"
        >
          <option
            v-for="run in resumableRuns"
            :key="run.id"
            :value="run.id"
          >
            {{ runOptionLabel(run) }}
          </option>
        </select>
        <small v-if="selectedRun?.stale">
          {{ t("The Atlas snapshot changed; the current brief will be checked before resuming.") }}
        </small>
      </label>

      <label class="workbench-intent">
        <span id="task-intent-heading">{{ intentLabel }}</span>
        <textarea
          v-model="task"
          rows="5"
          :disabled="Boolean(activeRun)"
          :placeholder="intentPlaceholder"
        />
      </label>

      <section
        v-if="risk.requiresObjectiveConfirmation && !objectiveConfirmed"
        class="decision-band"
        aria-labelledby="objective-confirmation"
      >
        <span>{{ t("Confirm scope") }}</span>
        <div>
          <strong id="objective-confirmation">{{ t("Is this the outcome to prepare?") }}</strong>
          <p>{{ risk.reasons.map((reason) => t(reason)).join(" · ") }}</p>
          <button
            class="secondary-button"
            :disabled="!task.trim()"
            @click="objectiveConfirmed = true"
          >
            {{ t("Confirm objective") }}
          </button>
        </div>
      </section>

      <div v-if="props.pinnedHandles?.length" class="selection-strip">
        <span>{{ t("Selected evidence") }}</span>
        <code v-for="handle in props.pinnedHandles" :key="handle">{{ handle }}</code>
      </div>

      <div class="source-strip">
        <div class="source-strip-heading">
          <div>
            <strong>{{ t("Task sources") }}</strong>
            <span>{{ t("Optional · detected references require an explicit choice") }}</span>
          </div>
          <button class="text-button" @click="advancedOpen = !advancedOpen">
            {{ advancedOpen ? t("Hide source controls") : t("Add source") }}
          </button>
        </div>
        <div v-if="sourceDecisions.length" class="source-chips">
          <article
            v-for="source in sourceDecisions"
            :key="source.id"
            :class="['source-decision', source.state]"
          >
            <div :title="source.reference">
              <span>{{ statusLabel(source.kind) }} · {{ statusLabel(source.state) }}</span>
              <strong>
                {{
                  isMissingTaskSourceReference(source.reference)
                    ? t("No source supplied")
                    : source.reference.replace(/^https?:\/\//, "").slice(0, 54)
                }}
              </strong>
              <small>
                {{ source.required ? t("Required source") : t("Optional source") }}
                ·
                {{ source.origin === "manual" ? t("Added by you") : t("Detected in the task") }}
              </small>
            </div>
            <div v-if="source.state === 'pending'" class="source-decision-actions">
              <button
                v-if="!isMissingTaskSourceReference(source.reference)"
                class="secondary-button"
                @click="decideSource(source.id, 'confirmed')"
              >
                {{ t("Yes, use this") }}
              </button>
              <button class="text-button" @click="decideSource(source.id, 'omitted')">
                {{ t("Continue without it") }}
              </button>
              <button class="text-button" @click="decideSource(source.id, 'unavailable')">
                {{ t("Not available") }}
              </button>
              <button class="text-button" @click="beginSourceReplacement(source.id)">
                {{ t("Replace or add") }}
              </button>
            </div>
            <div v-else class="source-decision-actions">
              <button
                v-if="
                  source.state !== 'confirmed' &&
                  !isMissingTaskSourceReference(source.reference)
                "
                class="text-button"
                @click="decideSource(source.id, 'confirmed')"
              >
                {{ t("Use instead") }}
              </button>
              <button
                class="text-button"
                @click="beginSourceReplacement(source.id)"
              >
                {{ t("Replace") }}
              </button>
              <button
                v-if="source.state === 'confirmed'"
                class="text-button"
                @click="decideSource(source.id, 'omitted')"
              >
                {{ t("Continue without it") }}
              </button>
              <button
                v-if="source.origin === 'manual'"
                class="text-button"
                :aria-label="t('Remove manually added source')"
                @click="removeManualSource(source.id)"
              >
                {{ t("Remove") }}
              </button>
            </div>
          </article>
        </div>
        <div v-if="advancedOpen" class="source-adder">
          <select v-model="sourceKind" :aria-label="t('Source kind')">
            <option value="figma">Figma</option>
            <option value="jira">Jira</option>
            <option value="confluence">Confluence</option>
            <option value="github">GitHub</option>
            <option value="openapi">OpenAPI / Swagger</option>
            <option value="other">{{ t("Other reference") }}</option>
          </select>
          <input
            v-model="sourceValue"
            type="text"
            :placeholder="replacementFor ? t('Paste the replacement URL or ID') : t('Paste one URL or ID')"
            @keydown.enter.prevent="addSource"
          >
          <label class="source-required-toggle">
            <input v-model="sourceRequired" type="checkbox">
            <span>{{ t("Required for this task") }}</span>
          </label>
          <button class="secondary-button" :disabled="!sourceValue.trim()" @click="addSource">
            {{ t("Add") }}
          </button>
        </div>
      </div>

      <div
        v-if="figmaSyncState.status !== 'idle'"
        :class="['figma-sync-band', figmaSyncState.status]"
        :role="figmaSyncState.status === 'error' ? 'alert' : 'status'"
        aria-live="polite"
      >
        <span v-if="figmaSyncState.status === 'loading'" class="mini-loader" />
        <AtlasIcon v-else :name="figmaSyncState.status === 'available' ? 'check' : 'design'" />
        <div class="figma-sync-copy">
          <strong>{{ figmaSyncLabel }}</strong>
          <span>{{ t(figmaSyncState.message) }}</span>
          <code v-if="figmaSyncTargetLabel">{{ figmaSyncTargetLabel }}</code>
          <small
            v-if="['confirmed-unsynced', 'error'].includes(figmaSyncState.status)"
          >
            {{ t("Keep Figma Desktop open with access to this file. Atlas will read and map only this exact node; candidates cannot replace it.") }}
          </small>
          <small
            v-if="
              ['confirmed-unsynced', 'error'].includes(figmaSyncState.status) &&
              figmaSyncBlockReason
            "
            class="figma-sync-blocker"
          >
            {{ figmaSyncBlockReason }}
          </small>
          <small v-if="figmaSyncProgress" class="figma-sync-progress">
            {{ figmaSyncProgress }}
          </small>
          <small v-if="runError && figmaSyncState.status === 'error'" class="inline-error">
            {{
              runtimeMessage(
                runError,
                "Figma source could not be synchronized. Check Figma Desktop MCP access, then retry the exact target.",
              )
            }}
          </small>
        </div>
        <div class="figma-sync-actions">
          <button
            v-if="['confirmed-unsynced', 'error'].includes(figmaSyncState.status)"
            class="secondary-button"
            :disabled="!canStartFigmaSync"
            @click="startFigmaSync"
          >
            {{
              figmaSyncState.status === "error"
                ? t("Retry exact sync")
                : t("Synchronize exact target")
            }}
          </button>
          <button
            v-else-if="figmaSyncState.status === 'loading'"
            class="text-button"
            @click="cancelRun"
          >
            {{ t("Cancel safely") }}
          </button>
        </div>
      </div>

      <div class="capability-line" :aria-label="t('Detected task capabilities')">
        <span
          v-for="capability in capabilitySummary"
          :key="capability.id"
          :class="['capability-pill', capability.state]"
          :title="`${capability.detail ?? ''} · ${statusLabel(capability.provenance)}${isSimulatedCapability(capability) ? ` · ${t('fixture claim, not a live connection')}` : ''}`"
        >
          {{ capability.id }} · {{ t(capabilityDisplayState(capability)) }}
        </span>
        <span v-if="!capabilitySummary.length" class="capability-pill unknown">
          {{ t("Repository only") }}
        </span>
      </div>

      <div class="workbench-actions">
        <button
          class="primary-button"
          :disabled="contextPending || !canGenerateContext"
          @click="generateContext"
        >
          {{ contextPending ? t("Preparing local evidence…") : t("Prepare task") }}
        </button>
        <button
          class="text-button"
          :aria-expanded="contextOptionsOpen"
          @click="contextOptionsOpen = !contextOptionsOpen"
        >
          {{ contextOptionsOpen ? t("Hide context options") : t("Context options") }}
        </button>
      </div>
      <div v-if="contextOptionsOpen" class="compact-options">
        <label>
          {{ t("Design map") }}
          <select v-model="figmaFile">
            <option value="">{{ t("None unless confirmed") }}</option>
            <option
              v-for="index in designIndexes"
              :key="index.file.key"
              :value="index.file.key"
            >
              {{ index.file.name ?? index.file.key }}
            </option>
          </select>
        </label>
        <label>
          {{ t("Hard cap") }}
          <select v-model.number="budgetChars">
            <option :value="2400">{{ t("{chars} chars · ~{tokens} tokens", { chars: formatNumber(2400), tokens: formatNumber(600) }) }}</option>
            <option :value="3600">{{ t("{chars} chars · ~{tokens} tokens", { chars: formatNumber(3600), tokens: formatNumber(900) }) }}</option>
            <option :value="6000">{{ t("{chars} chars · ~{tokens} tokens", { chars: formatNumber(6000), tokens: formatNumber(1500) }) }}</option>
          </select>
        </label>
        <label>
          {{ t("Candidates") }}
          <select v-model.number="topK">
            <option :value="3">{{ t("Top {count}", { count: 3 }) }}</option>
            <option :value="5">{{ t("Top {count}", { count: 5 }) }}</option>
          </select>
        </label>
      </div>
      <p v-if="contextError" class="inline-error" role="alert">{{ runtimeMessage(contextError) }}</p>
    </section>

    <section class="workbench-canvas" aria-live="polite">
      <div v-if="!context" class="workbench-empty">
        <span>{{ t("WORK / READY") }}</span>
        <h2>{{ t("Prepare a verified handoff to Codex.") }}</h2>
        <p>
          {{ t("Atlas sends only a compact brief, handles, and receipt IDs. Persistent indexes and full evidence stay outside the prompt until Codex requests an exact ID.") }}
        </p>
        <ol>
          <li>{{ t("Describe the task.") }}</li>
          <li>{{ t("Confirm inferred sources and material scope only when needed.") }}</li>
          <li>{{ t("Prepare read-only, then explicitly approve editing in the same task.") }}</li>
        </ol>
        <section v-if="recentRuns?.length || recentActions?.length" class="recent-runs">
          <header>
            <strong>{{ t("Recent local activity") }}</strong>
            <span>{{ t("metadata only · no task text") }}</span>
          </header>
          <div
            v-for="action in recentActions?.slice(0, 4)"
            :key="action.id"
            class="recent-run-row"
          >
            <time :datetime="action.resolvedAt">
              {{ formatDate(action.resolvedAt) }}
            </time>
            <strong>{{ statusLabel(action.command) }} · {{ statusLabel(action.state) }}</strong>
            <span>{{ t("{scope} scope", { scope: statusLabel(action.scope) }) }} · {{ action.itemId }}</span>
          </div>
          <div
            v-for="run in recentRuns?.slice(0, 5)"
            :key="run.id"
            class="recent-run-row"
          >
            <time :datetime="run.updatedAt">
              {{ formatDate(run.updatedAt) }}
            </time>
            <strong>{{ statusLabel(run.mode) }} · {{ statusLabel(run.state) }}</strong>
            <span>
              {{ t("{tokens} tokens · {questions} questions", {
                tokens: formatNumber(run.estimatedTokens),
                questions: formatNumber(run.questionCount),
              }) }}
            </span>
          </div>
        </section>
      </div>

      <template v-else-if="context">
        <header class="workbench-result-head">
          <div>
            <span class="eyebrow">{{ t("Reviewed local brief") }}</span>
            <h2>{{ context.task }}</h2>
          </div>
          <button class="text-button" @click="copyPackage">
            {{ copied ? t("Handoff copied") : t("Copy for Codex") }}
          </button>
        </header>

        <div class="evidence-lanes">
          <section>
            <span>{{ t("Code") }}</span>
            <strong>{{ t("{count} candidates", { count: context.code?.length ?? 0 }) }}</strong>
            <p v-if="context.code?.length">
              {{ context.code.slice(0, 3).map((item) => item.name).join(" · ") }}
            </p>
            <p v-else>{{ t("No matching code candidate yet.") }}</p>
          </section>
          <section>
            <span>{{ t("Design") }}</span>
            <strong>{{ t("{count} candidates", { count: context.design?.candidates?.length ?? 0 }) }}</strong>
            <p v-if="context.design?.selectionRequired">{{ t("A design source needs selection.") }}</p>
            <p v-else>{{ context.design?.available ? t("Sparse design evidence available.") : t("Optional / unavailable.") }}</p>
          </section>
          <section>
            <span>{{ t("Memory") }}</span>
            <strong>{{ t("{count} relevant items", { count: context.memory?.length ?? 0 }) }}</strong>
            <p>{{ t("{count} findings enter the decision gate.", { count: context.findings?.length ?? 0 }) }}</p>
          </section>
          <section v-if="context.api">
            <span>{{ t("API contract") }}</span>
            <strong>{{ t("{count} relevant operations", { count: context.api.operations.length }) }}</strong>
            <p>
              {{ t(context.api.contracts === 1 ? "{count} contract" : "{count} contracts", { count: context.api.contracts }) }} ·
              {{ context.api.format }} ·
              {{ t("{count} authentication schemes", { count: context.api.authentication.length }) }}
            </p>
          </section>
        </div>

        <section v-if="context.findings?.length" class="decision-band">
          <header>
            <div>
              <span class="eyebrow">{{ t("Decision gate") }}</span>
              <strong>
                {{ t("{count} findings enter the decision gate.", { count: context.findings.length }) }}
                ·
                {{ t("{count} required reviews pending", { count: pendingBlockingFindings.length }) }}
              </strong>
            </div>
            <span :class="['gate-state', displayGateStatus]">
              {{ statusLabel(displayGateStatus) }}
            </span>
          </header>
          <article
            v-for="finding in context.findings"
            :key="finding.id"
            :class="['decision-record', finding.level]"
          >
            <div>
              <span>{{ statusLabel(finding.level) }}</span>
              <strong>{{ finding.title }}</strong>
              <p v-if="finding.question">{{ finding.question }}</p>
              <p>{{ finding.recommendation }}</p>
              <ul v-if="finding.evidence?.length">
                <li v-for="item in finding.evidence.slice(0, 3)" :key="item">
                  {{ item }}
                </li>
              </ul>
            </div>
            <button
              v-if="finding.level === 'decision-required'"
              class="secondary-button"
              :aria-pressed="acknowledgedFindingIds.has(finding.id)"
              @click="toggleFindingAcknowledgement(finding)"
            >
              {{
                acknowledgedFindingIds.has(finding.id)
                  ? t("Reviewed")
                  : t("Mark reviewed")
              }}
            </button>
          </article>
        </section>

        <section v-if="!activeRun" class="launch-row">
          <div>
            <strong>{{ t("Experimental embedded runner") }} · {{ agentStatus?.label ?? "Codex" }}</strong>
            <span>{{ agentStatus?.detail ? t(agentStatus.detail) : t("Checking the local agent adapter…") }}</span>
            <span v-if="pendingBlockingFindings.length" class="launch-blocker">
              {{ t("Review every decision-required finding before starting Codex.") }}
            </span>
          </div>
          <button
            class="secondary-button"
            :disabled="
              agentStatus?.state !== 'detected' ||
              pendingBlockingFindings.length > 0
            "
            @click="reviewLaunch(mode === 'prepare' ? 'read-only' : (selectedRun?.sandbox ?? 'read-only'))"
          >
            {{ launchButtonLabel() }}
          </button>
        </section>

        <section v-if="activeRun" class="run-ledger">
          <header>
            <div>
              <span class="eyebrow">{{ t("Agent activity") }} · {{ statusLabel(activeRun.state) }}</span>
              <h2>{{ activeRun.threadId ? t("Codex task in progress") : t("Starting Codex") }}</h2>
              <p v-if="activeRun.stale" class="stale-warning">
                {{ t("Atlas evidence changed after this run was reviewed.") }}
              </p>
            </div>
            <button
              v-if="['queued', 'running'].includes(activeRun.state)"
              class="secondary-button"
              @click="cancelRun"
            >
              {{ t("Cancel safely") }}
            </button>
          </header>
          <ol>
            <li v-for="item in progressEvents" :key="item.cursor">
              <span :class="['event-mark', item.event.type]" />
              <div>
                <strong>{{ eventLabel(item.event) }}</strong>
                <small>{{ formatDate(item.event.at) }}</small>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="materialQuestion && activeRun?.state === 'awaiting-input'" class="question-gate">
          <span class="eyebrow">{{ t("Material question") }}</span>
          <h2>{{ materialQuestion.prompt }}</h2>
          <ul>
            <li v-for="item in materialQuestion.evidence" :key="item">{{ item }}</li>
          </ul>
          <p><strong>{{ t("Recommendation") }}:</strong> {{ materialQuestion.recommendation }}</p>
          <textarea v-model="answer" rows="3" :placeholder="t('Confirm or correct the recommendation')" />
          <button class="primary-button" :disabled="!answer.trim()" @click="resumeRun">
            {{ t("Continue this task") }}
          </button>
        </section>

        <section v-if="latestResult" class="agent-result">
          <header>
            <div>
              <span class="eyebrow">{{ t("Compact agent result") }}</span>
              <h2>{{ latestResult.summary }}</h2>
            </div>
            <span :class="['result-state', latestResult.status]">{{ statusLabel(latestResult.status) }}</span>
          </header>
          <div class="result-ledgers">
            <section>
              <span>{{ t("Evidence") }}</span>
              <p v-for="item in latestResult.evidence" :key="`${item.source}:${item.label}`">
                <strong>{{ item.source }}</strong> {{ item.label }}
              </p>
            </section>
            <section>
              <span>{{ t("Decisions") }}</span>
              <p v-for="item in latestResult.decisions" :key="item.title">
                <strong>{{ item.status }}</strong> {{ item.title }}
              </p>
              <p v-if="!latestResult.decisions.length">{{ t("No new decision claimed.") }}</p>
            </section>
            <section>
              <span>{{ t("Risks") }}</span>
              <p v-for="item in latestResult.risks" :key="item.title">
                <strong>{{ item.level }}</strong> {{ item.title }}
              </p>
              <p v-if="!latestResult.risks.length">{{ t("No unresolved risk reported.") }}</p>
            </section>
          </div>
          <details
            v-if="latestResult.sourceReceipts?.length"
            class="receipt-disclosure"
          >
            <summary>
              {{ t("{count} source receipts", { count: latestResult.sourceReceipts?.length ?? 0 }) }}
            </summary>
            <article
              v-for="receipt in latestResult.sourceReceipts ?? []"
              :key="receipt.id"
            >
              <strong>{{ statusLabel(receipt.provider) }} · {{ receipt.id }}</strong>
              <span>{{ receipt.adapter }} · {{ receipt.scope.kind }}:{{ receipt.scope.id }}</span>
              <small>{{ statusLabel(receipt.freshness) }} · {{ formatDate(receipt.observedAt) }}</small>
            </article>
          </details>
          <section
            :class="[
              'memory-closeout',
              { confirmation: latestResult.memoryCloseout.confirmationRequired },
            ]"
            aria-labelledby="memory-closeout-heading"
          >
            <header>
              <div>
                <span class="eyebrow">{{ t("Memory candidates") }}</span>
                <h3 id="memory-closeout-heading">
                  {{ statusLabel(latestResult.memoryCloseout.status) }}
                </h3>
              </div>
              <span>
                {{
                  latestResult.memoryCloseout.status === "canonical-stored"
                    ? t("Stored after confirmation")
                    : t("No automatic memory writes")
                }}
              </span>
            </header>
            <p>{{ latestResult.memoryCloseout.summary }}</p>
            <article
              v-for="candidate in latestResult.memoryCloseout.candidates"
              :key="`${candidate.type}:${candidate.title}`"
              class="memory-candidate"
            >
              <strong>{{ statusLabel(candidate.type) }} · {{ candidate.title }}</strong>
              <p>{{ candidate.summary }}</p>
              <small>
                {{
                  t("{scope} · {count}% confidence", {
                    scope: statusLabel(candidate.scope),
                    count: Math.round(candidate.confidence * 100),
                  })
                }}
              </small>
              <ul>
                <li v-for="evidence in candidate.evidence" :key="evidence">
                  {{ evidence }}
                </li>
              </ul>
            </article>
            <article
              v-if="latestResult.memoryCloseout.localOutcome"
              class="memory-candidate local"
            >
              <strong>{{ t("Local / episodic outcome") }}</strong>
              <p>{{ latestResult.memoryCloseout.localOutcome.summary }}</p>
              <ul>
                <li
                  v-for="evidence in latestResult.memoryCloseout.localOutcome.evidence"
                  :key="evidence"
                >
                  {{ evidence }}
                </li>
              </ul>
            </article>
            <p
              v-if="latestResult.memoryCloseout.confirmationRequired"
              class="memory-confirmation"
            >
              <strong>{{ t("Explicit confirmation required:") }}</strong>
              {{ latestResult.memoryCloseout.confirmationPrompt }}
            </p>
            <div
              v-if="latestResult.memoryCloseout.confirmationRequired"
              class="memory-closeout-actions"
            >
              <button
                class="secondary-button"
                @click="respondToMemoryCloseout('confirm-canonical')"
              >
                {{ t("Confirm canonical memory") }}
              </button>
              <button
                class="text-button"
                @click="respondToMemoryCloseout('decline')"
              >
                {{ t("Continue without saving") }}
              </button>
            </div>
          </section>
          <label class="correction-box">
            {{ t("Correct or continue without restarting") }}
            <textarea
              v-model="correction"
              rows="3"
              :placeholder="t('Change the scope, correct a result, or describe the next step')"
            />
          </label>
          <button class="secondary-button" :disabled="!correction.trim()" @click="resumeRun">
            {{ t("Continue same Codex task") }}
          </button>
          <button
            v-if="activeRun?.mode === 'prepare' && activeRun.state === 'completed' && latestResult.status === 'completed'"
            class="primary-button"
            @click="reviewLaunch('workspace-write')"
          >
            {{ t("Review implementation") }}
          </button>
        </section>
        <p v-if="runError" class="inline-error" role="alert">{{ runtimeMessage(runError) }}</p>
      </template>
    </section>

    <aside class="workbench-inspector">
      <span class="eyebrow">{{ t("Context inspector") }}</span>
      <strong class="token-total">
        {{ context ? t("{count} tokens", { count: formatNumber(context.metrics.estimatedTokens) }) : t("No agent context") }}
      </strong>
      <div class="budget-meter">
        <span
          :style="{
            width: context
              ? `${Math.min(100, (context.metrics.usedChars / context.metrics.budgetChars) * 100)}%`
              : '0%',
          }"
        />
      </div>
      <dl>
        <div><dt>{{ t("Project") }}</dt><dd :title="projectName">{{ projectName }}</dd></div>
        <div>
          <dt>{{ t("Branch") }}</dt>
          <dd :title="identity?.branch ?? t('detached / unknown')">
            {{ identity?.branch ?? t("detached / unknown") }}
          </dd>
        </div>
        <div>
          <dt>{{ t("Checkout") }}</dt>
          <dd :title="identity?.checkoutId ?? t('path scoped')">
            {{ identity?.checkoutId.slice(0, 8) ?? t("path scoped") }}
          </dd>
        </div>
        <div>
          <dt>{{ t("Snapshot") }}</dt>
          <dd :title="reviewFingerprint">{{ reviewFingerprint.slice(0, 8) }}</dd>
        </div>
        <div class="source-count-row">
          <dt>{{ t("Sources") }}</dt>
          <dd class="source-count-summary">
            <span>
              <strong>{{ sourceCounts.confirmed }}</strong>
              <small>{{ t("Confirmed sources") }}</small>
            </span>
            <span>
              <strong>{{ sourceCounts.pending }}</strong>
              <small>{{ t("Pending sources") }}</small>
            </span>
            <span>
              <strong>{{ sourceCounts.omitted + sourceCounts.unavailable }}</strong>
              <small>{{ t("Omitted or unavailable sources") }}</small>
            </span>
          </dd>
        </div>
        <div><dt>{{ t("Context") }}</dt><dd>{{ t("{used} / {budget} chars", { used: formatNumber(context?.metrics.usedChars ?? 0), budget: formatNumber(budgetChars) }) }}</dd></div>
        <div><dt>{{ t("Truncated") }}</dt><dd>{{ context?.metrics.truncated ? t("Yes") : t("No") }}</dd></div>
        <div>
          <dt>{{ t("Retrieval") }}</dt>
          <dd>
            {{
              context?.metrics.retrieval
                ? t("{hits} hits · {misses} misses · {retries} retries", {
                    hits: context.metrics.retrieval.hits,
                    misses: context.metrics.retrieval.misses,
                    retries: context.metrics.retrieval.retries,
                  })
                : t("Not prepared")
            }}
          </dd>
        </div>
        <div><dt>{{ t("Decision gate") }}</dt><dd>{{ statusLabel(displayGateStatus) }}</dd></div>
        <div>
          <dt>{{ t("Run evidence") }}</dt>
          <dd>{{ activeRun?.stale || selectedRun?.stale ? t("snapshot changed") : t("current") }}</dd>
        </div>
      </dl>
      <details v-if="activeCheckpoint" class="checkpoint-disclosure">
        <summary>
          {{ t("Resume capsule") }} · {{ statusLabel(activeCheckpoint.status) }}
        </summary>
        <p>
          <strong>{{ t("Next safe action") }}</strong>
          <span>{{ t(activeCheckpoint.nextSafeAction) }}</span>
        </p>
        <dl>
          <div><dt>{{ t("Covered") }}</dt><dd>{{ activeCheckpoint.scope.covered.length }}</dd></div>
          <div><dt>{{ t("Remaining") }}</dt><dd>{{ activeCheckpoint.scope.remaining.length }}</dd></div>
          <div><dt>{{ t("Receipts") }}</dt><dd>{{ activeCheckpoint.sourceReceiptIds.length }}</dd></div>
          <div><dt>{{ t("HEAD") }}</dt><dd>{{ activeCheckpoint.workspace.head.slice(0, 8) }}</dd></div>
        </dl>
        <small>{{ t("Details expand by ID only; no transcript or full index is stored here.") }}</small>
      </details>
      <section class="inspector-sources">
        <span>{{ t("Confirmed references") }}</span>
        <p v-if="!sources.length">{{ t("Repository + Atlas only") }}</p>
        <p v-for="source in sources" :key="`${source.kind}:${source.value}`">
          <strong>{{ statusLabel(source.kind) }}</strong>
          <span :title="source.value">
            {{ source.value.replace(/^https?:\/\//, "").slice(0, 46) }}
          </span>
        </p>
        <details v-if="context?.sourceReceiptIds?.length" class="receipt-id-list">
          <summary>{{ t("Receipt IDs") }} · {{ context.sourceReceiptIds.length }}</summary>
          <code v-for="receiptId in context.sourceReceiptIds" :key="receiptId">
            {{ receiptId }}
          </code>
        </details>
      </section>
      <div class="boundary-legend">
        <span><i class="local" />{{ t("Local · 0 tokens") }}</span>
        <span><i class="agent" />{{ t("Agent · reviewed budget") }}</span>
        <span><i class="external" />{{ t("External write · approval") }}</span>
      </div>
    </aside>

    <div v-if="launchReviewOpen" class="dialog-backdrop" @click.self="launchReviewOpen = false">
      <section class="launch-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-title">
        <span class="eyebrow">
          {{
            mode === "continue" || mode === "correct"
              ? t("Review before Codex resumes")
              : t("Review before Codex starts")
          }}
        </span>
        <h2 id="launch-title">{{ t(activeAction?.intent ?? "") }}</h2>
        <p>{{ t(activeAction?.description ?? "") }}</p>
        <dl>
          <div><dt>{{ t("Project") }}</dt><dd>{{ projectName }}</dd></div>
          <div><dt>{{ t("Worktree") }}</dt><dd>{{ projectRoot }}</dd></div>
          <div><dt>{{ t("Branch") }}</dt><dd>{{ identity?.branch ?? t("unknown") }}</dd></div>
          <div><dt>{{ t("Snapshot") }}</dt><dd>{{ reviewFingerprint.slice(0, 8) }}</dd></div>
          <div><dt>{{ t("Permission") }}</dt><dd>{{ statusLabel(launchSandbox) }}</dd></div>
          <div><dt>{{ t("Risk") }}</dt><dd>{{ statusLabel(activeAction?.risk ?? risk.level) }}</dd></div>
          <div><dt>{{ t("Context") }}</dt><dd>{{ t("{count} estimated tokens", { count: formatNumber(context?.metrics.estimatedTokens ?? 0) }) }}</dd></div>
          <div><dt>{{ t("Decision reviews") }}</dt><dd>{{ blockingFindings.length }}</dd></div>
          <div><dt>{{ t("Possible writes") }}</dt><dd>{{ activeAction?.possibleWrites.map(statusLabel).join(", ") || t("none") }}</dd></div>
          <div><dt>{{ t("External writes") }}</dt><dd>{{ t("prohibited in this run") }}</dd></div>
        </dl>
        <section class="launch-review-section">
          <strong>{{ t("Exact sources") }}</strong>
          <p v-if="!sources.length">{{ t("Repository + Atlas only") }}</p>
          <ul v-else>
            <li v-for="source in sources" :key="`${source.kind}:${source.value}`">
              <span>{{ statusLabel(source.kind) }}</span>
              <code>{{ source.value }}</code>
            </li>
          </ul>
        </section>
        <section
          v-if="activeAction?.expectedQuestions.length"
          class="launch-review-section"
        >
          <strong>{{ t("Codex may pause for") }}</strong>
          <ul>
            <li v-for="question in activeAction.expectedQuestions" :key="question">
              {{ t(question) }}
            </li>
          </ul>
        </section>
        <div class="dialog-actions">
          <button class="secondary-button" @click="launchReviewOpen = false">{{ t("Back") }}</button>
          <button class="primary-button" @click="confirmLaunch">
            {{ launchActionLabel }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
