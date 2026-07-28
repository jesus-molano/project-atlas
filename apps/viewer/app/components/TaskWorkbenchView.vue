<script setup lang="ts">
import type {
  ActionCapabilityManifest,
  AgentAdapterStatus,
  AgentRunEvent,
  AgentRunMode,
  AgentSandbox,
} from "@component-atlas/agent";
import { memoryCloseoutActionMessage } from "@component-atlas/agent";
import {
  assessTaskIntake,
  assessTaskRisk,
  confirmedTaskSources,
  detectTaskSources,
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

interface CompactContext {
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
    available: true;
    format: "openapi" | "swagger" | "mixed";
    contracts: number;
    operations: Array<{ method: string; path: string }>;
    authentication: Array<Record<string, unknown>>;
  };
  findings?: Array<Record<string, unknown>>;
  gate?: Record<string, unknown>;
  nextSteps?: string[];
  metrics: {
    budgetChars: number;
    usedChars: number;
    estimatedTokens: number;
    truncated: boolean;
    totalMatches: number;
    expandableIds: string[];
  };
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
  sandbox: AgentSandbox;
  startingFingerprint: string;
  currentFingerprint: string;
  stale: boolean;
  threadId?: string;
  events: Array<{ cursor: number; event: AgentRunEvent }>;
  nextCursor: number;
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
const objectiveConfirmed = ref(false);
const budgetChars = ref(props.defaultBudget);
const topK = ref(props.defaultTopK);
const figmaFile = ref("");
const advancedOpen = ref(false);
const sourceKind = ref<TaskSourceKind>("figma");
const sourceValue = ref("");
const replacementFor = ref("");
const sourceDecisions = ref<TaskSourceDecision[]>([]);
const context = ref<CompactContext>();
const contextPending = ref(false);
const contextError = ref("");
const agentStatus = ref<AgentAdapterStatus>();
const agentToken = ref("");
const actions = ref<ActionCapabilityManifest[]>([]);
const activeRun = ref<RunResponse>();
const figmaSyncAttemptRunId = ref<string>();
const figmaSyncAttemptSourceIds = ref<string[]>([]);
const runEvents = ref<Array<{ cursor: number; event: AgentRunEvent }>>([]);
const runError = ref("");
const launchReviewOpen = ref(false);
const launchSandbox = ref<AgentSandbox>("read-only");
const answer = ref("");
const correction = ref("");
const copied = ref(false);
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
const confirmedFigmaSources = computed(() =>
  sourceDecisions.value.filter(
    (source) => source.kind === "figma" && source.state === "confirmed",
  ),
);
const indexedFigmaKeys = computed(
  () => new Set(props.designIndexes.map((index) => index.file.key)),
);
const pendingFigmaSources = computed(() =>
  confirmedFigmaSources.value.filter((source) => {
    const key = figmaFileKey(source.reference);
    return !key || !indexedFigmaKeys.value.has(key);
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
  if (attemptedRun && ["failed", "cancelled"].includes(attemptedRun.state)) {
    return {
      status: "error",
      message:
        "Figma source could not be synchronized. Check Figma Desktop MCP access and the agent result.",
    };
  }
  if (!pendingFigmaSources.value.length) {
    return {
      status: "available",
      message: "Design Atlas available from the confirmed Figma source.",
    };
  }
  if (
    attemptedRun &&
    attemptedRun.state === "completed"
  ) {
    return {
      status: "error",
      message:
        "Figma source could not be synchronized. Check Figma Desktop MCP access and the agent result.",
    };
  }
  return {
    status: "confirmed-unsynced",
    message:
      "Figma source confirmed, not synchronized. Start Codex preparation to ingest it.",
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
const taskSessionKey = computed(
  () =>
    `atlas-task:${props.identity?.logicalId ?? props.projectName}:${
      props.identity?.checkoutId ?? props.projectRoot
    }`,
);

function figmaFileKey(reference: string): string | undefined {
  try {
    return parseFigmaReference(reference.replace(/^figma:/, "")).fileKey;
  } catch {
    return undefined;
  }
}

const capabilitySummary = computed(() =>
  props.capabilities.observations.filter(
    (item) => item.kind === "connector" || item.state !== "unknown",
  ),
);

const activeAction = computed(() =>
  actions.value.find((action) =>
    launchSandbox.value === "workspace-write"
      ? action.id === "implement-frontend-task"
      : action.id === "prepare-frontend-task",
  ),
);

const latestResult = computed(() => {
  const completed = [...runEvents.value]
    .reverse()
    .find((item) => item.event.type === "completed");
  return completed?.event.type === "completed"
    ? completed.event.result
    : undefined;
});

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
    required: false,
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
    ...sourceDecisions.value.filter((item) => item.id !== id),
    source,
  ];
  replacementFor.value = "";
  sourceValue.value = "";
}

function decideSource(
  id: string,
  state: Extract<
    TaskSourceDecision["state"],
    "confirmed" | "omitted" | "unavailable"
  >,
): void {
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
    const fileKey = handle.slice("design:".length).split("::")[0];
    const index = props.designIndexes.find((item) => item.file.key === fileKey);
    if (!index) continue;
    const reference = index.file.url;
    const id = taskSourceId("figma", reference);
    if (!detected.some((source) => source.id === id)) {
      detected.push({
        id,
        kind: "figma",
        reference,
        origin: "inferred",
        state: "pending",
        required: false,
      });
    }
  }
  const detectedIds = new Set(detected.map((source) => source.id));
  const retained = sourceDecisions.value.filter(
    (source) => source.origin === "manual" || detectedIds.has(source.id),
  );
  for (const source of detected) {
    if (!retained.some((candidate) => candidate.id === source.id)) {
      retained.push(source);
    }
  }
  sourceDecisions.value = retained;
}

async function generateContext(): Promise<void> {
  if (intakeAssessment.value.status !== "ready") return;
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
        task: task.value,
        objectiveConfirmed: objectiveConfirmed.value,
        sourceDecisions: sourceDecisions.value,
        budgetChars: budgetChars.value,
        topK: topK.value,
        selectedHandles: props.pinnedHandles ?? [],
        ...(figmaFile.value ? { figmaFile: figmaFile.value } : {}),
      },
    });
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
    [agentStatus.value, actions.value] = await Promise.all([
      $fetch<AgentAdapterStatus>("/api/agent/status", { headers }),
      $fetch<ActionCapabilityManifest[]>("/api/actions"),
    ]);
  } catch (caught) {
    runError.value = atlasErrorSource(
      caught,
      "Codex integration status is unavailable.",
    );
  }
}

function reviewLaunch(sandbox: AgentSandbox): void {
  launchSandbox.value = sandbox;
  launchReviewOpen.value = true;
}

async function startRun(): Promise<void> {
  if (
    !context.value ||
    !agentToken.value ||
    intakeAssessment.value.status !== "ready" ||
    launchSandbox.value !== "read-only"
  ) {
    return;
  }
  launchReviewOpen.value = false;
  runError.value = "";
  runEvents.value = [];
  try {
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
    if (confirmedFigmaSources.value.length) {
      figmaSyncAttemptRunId.value = activeRun.value.id;
      figmaSyncAttemptSourceIds.value = confirmedFigmaSources.value.map(
        (source) => source.id,
      );
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
      },
    },
  );
  pollTimer = setTimeout(pollRun, 100);
}

function confirmLaunch(): void {
  if (launchSandbox.value === "workspace-write") {
    void implementReviewedRun();
  } else {
    void startRun();
  }
}

function newTask(): void {
  if (pollTimer) clearTimeout(pollTimer);
  task.value = "";
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
  await navigator.clipboard.writeText(JSON.stringify(context.value, null, 2));
  copied.value = true;
}

function eventLabel(event: AgentRunEvent): string {
  if (event.type === "run-started") return t(event.message);
  if (event.type === "activity") return t(event.message);
  if (event.type === "failed") return t(event.message);
  if (event.type === "cancelled") return t(event.message);
  return statusLabel(event.type);
}

onMounted(async () => {
  restoreTaskSession();
  syncDetectedSources();
  await loadAgentSurface();
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
      decidedAt: new Date().toISOString(),
    },
  ];
});
watch(
  [
    task,
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
      <div class="mode-switch" :aria-label="t('Task intake status')">
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

      <label class="workbench-intent">
        <span id="task-intent-heading">{{ t("What needs to change?") }}</span>
        <textarea
          v-model="task"
          rows="5"
          :disabled="Boolean(activeRun)"
          :placeholder="t('Describe the frontend outcome. Add links only when they are useful.')"
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
              <strong>{{ source.reference.replace(/^https?:\/\//, "").slice(0, 54) }}</strong>
              <small>{{ source.origin === "manual" ? t("Added by you") : t("Detected in the task") }}</small>
            </div>
            <div v-if="source.state === 'pending'" class="source-decision-actions">
              <button class="secondary-button" @click="decideSource(source.id, 'confirmed')">
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
            <button
              v-else-if="source.origin === 'manual'"
              class="text-button"
              :aria-label="t('Remove manually added source')"
              @click="removeManualSource(source.id)"
            >
              {{ t("Remove") }}
            </button>
            <button
              v-else-if="source.state !== 'confirmed'"
              class="text-button"
              @click="decideSource(source.id, 'confirmed')"
            >
              {{ t("Use instead") }}
            </button>
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
          <button class="secondary-button" :disabled="!sourceValue.trim()" @click="addSource">
            {{ t("Add") }}
          </button>
        </div>
      </div>

      <div
        v-if="figmaSyncState.status !== 'idle'"
        :class="['figma-sync-band', figmaSyncState.status]"
        role="status"
      >
        <span v-if="figmaSyncState.status === 'loading'" class="mini-loader" />
        <AtlasIcon v-else :name="figmaSyncState.status === 'available' ? 'check' : 'design'" />
        <div>
          <strong>{{ figmaSyncLabel }}</strong>
          <span>{{ t(figmaSyncState.message) }}</span>
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
          :disabled="contextPending || intakeAssessment.status !== 'ready' || !agentToken"
          @click="generateContext"
        >
          {{ contextPending ? t("Preparing local evidence…") : t("Prepare task") }}
        </button>
        <button class="text-button" @click="advancedOpen = !advancedOpen">
          {{ t("Context options") }}
        </button>
      </div>
      <div v-if="advancedOpen" class="compact-options">
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
      <p v-if="contextError" class="inline-error">{{ runtimeMessage(contextError) }}</p>
    </section>

    <section class="workbench-canvas" aria-live="polite">
      <div v-if="!context && !activeRun" class="workbench-empty">
        <span>{{ t("WORK / READY") }}</span>
        <h2>{{ t("Start with an outcome, not a form.") }}</h2>
        <p>
          {{ t("Atlas will search the current checkout and show exactly what is worth sending to an agent. Jira, Confluence, Figma, and OpenAPI remain optional.") }}
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
            {{ copied ? t("Package copied") : t("Copy package") }}
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
          <span>{{ t("Needs review") }}</span>
          <div>
            <strong>{{ context.findings[0]?.title }}</strong>
            <p>{{ context.findings[0]?.recommendation }}</p>
          </div>
        </section>

        <section v-if="!activeRun" class="launch-row">
          <div>
            <strong>{{ agentStatus?.label ?? "Codex" }}</strong>
            <span>{{ agentStatus?.detail ? t(agentStatus.detail) : t("Checking the local agent adapter…") }}</span>
          </div>
          <button
            class="secondary-button"
            :disabled="agentStatus?.state !== 'detected'"
            @click="reviewLaunch('read-only')"
          >
            {{
              confirmedFigmaSources.length
                ? t("Prepare with Codex & sync Figma")
                : t("Prepare with Codex")
            }}
          </button>
        </section>

        <section v-if="activeRun" class="run-ledger">
          <header>
            <div>
              <span class="eyebrow">{{ t("Agent activity") }} · {{ statusLabel(activeRun.state) }}</span>
              <h2>{{ activeRun.threadId ? t("Codex task in progress") : t("Starting Codex") }}</h2>
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
        <p v-if="runError" class="inline-error">{{ runtimeMessage(runError) }}</p>
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
        <div><dt>{{ t("Project") }}</dt><dd>{{ projectName }}</dd></div>
        <div><dt>{{ t("Branch") }}</dt><dd>{{ identity?.branch ?? t("detached / unknown") }}</dd></div>
        <div><dt>{{ t("Checkout") }}</dt><dd>{{ identity?.checkoutId.slice(0, 8) ?? t("path scoped") }}</dd></div>
        <div><dt>{{ t("Snapshot") }}</dt><dd>{{ workspaceFingerprint.slice(0, 8) }}</dd></div>
        <div>
          <dt>{{ t("Sources") }}</dt>
          <dd>
            {{ t("{confirmed} confirmed · {pending} pending · {omitted} omitted/unavailable", {
              confirmed: sourceCounts.confirmed,
              pending: sourceCounts.pending,
              omitted: sourceCounts.omitted + sourceCounts.unavailable,
            }) }}
          </dd>
        </div>
        <div><dt>{{ t("Context") }}</dt><dd>{{ t("{used} / {budget} chars", { used: formatNumber(context?.metrics.usedChars ?? 0), budget: formatNumber(budgetChars) }) }}</dd></div>
        <div><dt>{{ t("Truncated") }}</dt><dd>{{ context?.metrics.truncated ? t("Yes") : t("No") }}</dd></div>
      </dl>
      <div class="boundary-legend">
        <span><i class="local" />{{ t("Local · 0 tokens") }}</span>
        <span><i class="agent" />{{ t("Agent · reviewed budget") }}</span>
        <span><i class="external" />{{ t("External write · approval") }}</span>
      </div>
    </aside>

    <div v-if="launchReviewOpen" class="dialog-backdrop" @click.self="launchReviewOpen = false">
      <section class="launch-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-title">
        <span class="eyebrow">{{ t("Review before Codex starts") }}</span>
        <h2 id="launch-title">{{ t(activeAction?.intent ?? "") }}</h2>
        <p>{{ t(activeAction?.description ?? "") }}</p>
        <dl>
          <div><dt>{{ t("Project") }}</dt><dd>{{ projectName }}</dd></div>
          <div><dt>{{ t("Worktree") }}</dt><dd>{{ projectRoot }}</dd></div>
          <div><dt>{{ t("Branch") }}</dt><dd>{{ identity?.branch ?? t("unknown") }}</dd></div>
          <div><dt>{{ t("Permission") }}</dt><dd>{{ statusLabel(launchSandbox) }}</dd></div>
          <div><dt>{{ t("Context") }}</dt><dd>{{ t("{count} estimated tokens", { count: formatNumber(context?.metrics.estimatedTokens ?? 0) }) }}</dd></div>
          <div><dt>{{ t("Sources") }}</dt><dd>{{ sources.map((source) => statusLabel(source.kind)).join(", ") || t("repository + confirmed Atlas memory") }}</dd></div>
          <div><dt>{{ t("Possible writes") }}</dt><dd>{{ activeAction?.possibleWrites.map(statusLabel).join(", ") || t("none") }}</dd></div>
          <div><dt>{{ t("External writes") }}</dt><dd>{{ t("prohibited in this run") }}</dd></div>
        </dl>
        <div class="dialog-actions">
          <button class="secondary-button" @click="launchReviewOpen = false">{{ t("Back") }}</button>
          <button class="primary-button" @click="confirmLaunch">
            {{ launchSandbox === "workspace-write" ? t("Implement in this task") : t("Start read-only preparation") }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
