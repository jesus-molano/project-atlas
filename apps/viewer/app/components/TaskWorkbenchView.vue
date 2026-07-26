<script setup lang="ts">
import type {
  ActionCapabilityManifest,
  AgentAdapterStatus,
  AgentRunEvent,
  AgentRunMode,
  AgentSandbox,
  AgentSourceReference,
} from "@component-atlas/agent";
import type {
  ActionResolution,
  AgentRunAuditRecord,
  ProjectCapabilityReport,
  ProjectIdentityMetadata,
} from "@component-atlas/core/browser";
import type { DesignFileIndex } from "@component-atlas/design";
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

const task = ref(props.initialTask ?? "");
const mode = ref<AgentRunMode>("prepare");
const budgetChars = ref(props.defaultBudget);
const topK = ref(props.defaultTopK);
const figmaFile = ref("");
const advancedOpen = ref(false);
const sourceKind = ref<AgentSourceReference["kind"]>("figma");
const sourceValue = ref("");
const manualSources = ref<AgentSourceReference[]>([]);
const ignoredSources = ref<Set<string>>(new Set());
const context = ref<CompactContext>();
const contextPending = ref(false);
const contextError = ref("");
const agentStatus = ref<AgentAdapterStatus>();
const agentToken = ref("");
const actions = ref<ActionCapabilityManifest[]>([]);
const activeRun = ref<RunResponse>();
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

const detectedSources = computed<AgentSourceReference[]>(() => {
  const matches =
    task.value.match(/https?:\/\/[^\s<>"')\]]+/gi)?.slice(0, 8) ?? [];
  return matches.map((value) => {
    const lower = value.toLowerCase();
    const kind: AgentSourceReference["kind"] = lower.includes("figma.com")
      ? "figma"
      : /confluence/.test(lower)
          ? "confluence"
        : /atlassian|jira/.test(lower)
          ? "jira"
          : "other";
    return { kind, value };
  });
});

const sources = computed(() => {
  const unique = new Map<string, AgentSourceReference>();
  for (const source of [...detectedSources.value, ...manualSources.value]) {
    const key = `${source.kind}:${source.value}`;
    if (!ignoredSources.value.has(key)) unique.set(key, source);
  }
  return [...unique.values()];
});

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
  const key = `${sourceKind.value}:${value}`;
  const nextIgnored = new Set(ignoredSources.value);
  nextIgnored.delete(key);
  ignoredSources.value = nextIgnored;
  manualSources.value.push({ kind: sourceKind.value, value });
  sourceValue.value = "";
}

function removeSource(index: number): void {
  const source = sources.value[index];
  if (!source) return;
  const key = `${source.kind}:${source.value}`;
  ignoredSources.value = new Set([...ignoredSources.value, key]);
  const manualIndex = manualSources.value.findIndex(
    (item) => item.kind === source.kind && item.value === source.value,
  );
  if (manualIndex >= 0) manualSources.value.splice(manualIndex, 1);
}

async function generateContext(): Promise<void> {
  preparedAt.value = Date.now();
  contextPending.value = true;
  contextError.value = "";
  copied.value = false;
  try {
    context.value = await $fetch<CompactContext>("/api/task-context", {
      method: "POST",
      body: {
        task: task.value,
        budgetChars: budgetChars.value,
        topK: topK.value,
        selectedHandles: props.pinnedHandles ?? [],
        ...(figmaFile.value ? { figmaFile: figmaFile.value } : {}),
      },
    });
    preparationMs.value = Math.max(0, Date.now() - (preparedAt.value ?? Date.now()));
  } catch (caught) {
    contextError.value =
      caught instanceof Error ? caught.message : "Local context failed.";
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
    runError.value =
      caught instanceof Error
        ? caught.message
        : "Codex integration status is unavailable.";
  }
}

function reviewLaunch(sandbox: AgentSandbox): void {
  launchSandbox.value = sandbox;
  launchReviewOpen.value = true;
}

async function startRun(): Promise<void> {
  if (!context.value || !agentToken.value) return;
  launchReviewOpen.value = false;
  runError.value = "";
  runEvents.value = [];
  try {
    activeRun.value = await $fetch<RunResponse>("/api/agent/runs", {
      method: "POST",
      headers: { "x-atlas-session": agentToken.value },
      body: {
        mode:
          mode.value === "continue" || mode.value === "correct"
            ? mode.value
            : launchSandbox.value === "workspace-write"
              ? "implement"
              : "prepare",
        task: task.value,
        sources: sources.value,
        sandbox: launchSandbox.value,
        budgetChars: budgetChars.value,
        topK: topK.value,
        selectedHandles: props.pinnedHandles ?? [],
        figmaFile: figmaFile.value || undefined,
        expectedFingerprint: props.workspaceFingerprint,
      },
    });
    pollRun();
  } catch (caught) {
    runError.value = caught instanceof Error ? caught.message : "Codex did not start.";
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
    if (
      props.localMetricsEnabled &&
      response.state === "completed" &&
      !recordedRuns.has(response.id) &&
      context.value
    ) {
      recordedRuns.add(response.id);
      await $fetch("/api/evaluations", {
        method: "POST",
        body: {
          task: task.value,
          necessaryQuestions: runEvents.value.filter(
            (item) => item.event.type === "question",
          ).length,
          contextChars: context.value.metrics.usedChars,
          preparationMs: preparationMs.value,
          conflictCount: context.value.findings?.length ?? 0,
          reworkRequired: mode.value === "correct",
        },
      }).catch(() => undefined);
    }
    if (["queued", "running"].includes(response.state)) {
      pollTimer = setTimeout(pollRun, 700);
    }
  } catch (caught) {
    runError.value =
      caught instanceof Error ? caught.message : "Agent activity could not refresh.";
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
      },
    },
  );
  answer.value = "";
  correction.value = "";
  pollTimer = setTimeout(pollRun, 100);
}

async function copyPackage(): Promise<void> {
  if (!context.value) return;
  await navigator.clipboard.writeText(JSON.stringify(context.value, null, 2));
  copied.value = true;
}

function eventLabel(event: AgentRunEvent): string {
  if (event.type === "run-started") return event.message;
  if (event.type === "activity") return event.message;
  if (event.type === "failed") return event.message;
  if (event.type === "cancelled") return event.message;
  return event.type;
}

onMounted(loadAgentSurface);
watch(
  () => props.initialTask,
  (value) => {
    if (value && value !== task.value) task.value = value;
  },
);
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer);
});
</script>

<template>
  <div class="workbench">
    <section class="workbench-composer" aria-labelledby="task-intent-heading">
      <div class="mode-switch" aria-label="Task mode">
        <button
          v-for="item in [
            { id: 'prepare', label: 'New task' },
            { id: 'continue', label: 'Continue' },
            { id: 'correct', label: 'Correct' },
          ]"
          :key="item.id"
          :class="{ active: mode === item.id }"
          @click="mode = item.id as AgentRunMode"
        >
          {{ item.label }}
        </button>
      </div>

      <label class="workbench-intent">
        <span id="task-intent-heading">What needs to change?</span>
        <textarea
          v-model="task"
          rows="5"
          placeholder="Describe the frontend outcome. Add links only when they are useful."
        />
      </label>

      <div v-if="props.pinnedHandles?.length" class="selection-strip">
        <span>Selected evidence</span>
        <code v-for="handle in props.pinnedHandles" :key="handle">{{ handle }}</code>
      </div>

      <div class="source-strip">
        <div class="source-strip-heading">
          <div>
            <strong>Task sources</strong>
            <span>Optional · detected links are never treated as write approval</span>
          </div>
          <button class="text-button" @click="advancedOpen = !advancedOpen">
            {{ advancedOpen ? "Hide source controls" : "Add source" }}
          </button>
        </div>
        <div v-if="sources.length" class="source-chips">
          <button
            v-for="(source, index) in sources"
            :key="`${source.kind}:${source.value}`"
            :title="source.value"
            @click="removeSource(index)"
          >
            <span>{{ source.kind }}</span>
            {{ source.value.replace(/^https?:\/\//, "").slice(0, 42) }}
            <AtlasIcon name="x" />
          </button>
        </div>
        <div v-if="advancedOpen" class="source-adder">
          <select v-model="sourceKind" aria-label="Source kind">
            <option value="figma">Figma</option>
            <option value="jira">Jira</option>
            <option value="confluence">Confluence</option>
            <option value="other">Other reference</option>
          </select>
          <input
            v-model="sourceValue"
            type="text"
            placeholder="Paste one URL or ID"
            @keydown.enter.prevent="addSource"
          >
          <button class="secondary-button" :disabled="!sourceValue.trim()" @click="addSource">
            Add
          </button>
        </div>
      </div>

      <div class="capability-line" aria-label="Detected task capabilities">
        <span
          v-for="capability in capabilitySummary"
          :key="capability.id"
          :class="['capability-pill', capability.state]"
          :title="`${capability.detail ?? ''} · ${capability.provenance}${isSimulatedCapability(capability) ? ' · fixture claim, not a live connection' : ''}`"
        >
          {{ capability.id }} · {{ capabilityDisplayState(capability) }}
        </span>
        <span v-if="!capabilitySummary.length" class="capability-pill unknown">
          Repository only
        </span>
      </div>

      <div class="workbench-actions">
        <button
          class="primary-button"
          :disabled="contextPending || !task.trim()"
          @click="generateContext"
        >
          {{ contextPending ? "Preparing local evidence…" : "Prepare task" }}
        </button>
        <button class="text-button" @click="advancedOpen = !advancedOpen">
          Context options
        </button>
      </div>
      <div v-if="advancedOpen" class="compact-options">
        <label>
          Design map
          <select v-model="figmaFile">
            <option value="">Automatic / none</option>
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
          Hard cap
          <select v-model.number="budgetChars">
            <option :value="2400">2,400 chars · ~600 tokens</option>
            <option :value="3600">3,600 chars · ~900 tokens</option>
            <option :value="6000">6,000 chars · ~1,500 tokens</option>
          </select>
        </label>
        <label>
          Candidates
          <select v-model.number="topK">
            <option :value="3">Top 3</option>
            <option :value="5">Top 5</option>
          </select>
        </label>
      </div>
      <p v-if="contextError" class="inline-error">{{ contextError }}</p>
    </section>

    <section class="workbench-canvas" aria-live="polite">
      <div v-if="!context && !activeRun" class="workbench-empty">
        <span>WORK / READY</span>
        <h2>Start with an outcome, not a form.</h2>
        <p>
          Atlas will search the current checkout and show exactly what is worth
          sending to an agent. Jira, Confluence, and Figma remain optional.
        </p>
        <ol>
          <li>Describe the task.</li>
          <li>Review the compact evidence and any material question.</li>
          <li>Prepare read-only or implement in the selected checkout.</li>
        </ol>
        <section v-if="recentRuns?.length || recentActions?.length" class="recent-runs">
          <header>
            <strong>Recent local activity</strong>
            <span>metadata only · no task text</span>
          </header>
          <div
            v-for="action in recentActions?.slice(0, 4)"
            :key="action.id"
            class="recent-run-row"
          >
            <time :datetime="action.resolvedAt">
              {{ new Date(action.resolvedAt).toLocaleString() }}
            </time>
            <strong>{{ action.command }} · {{ action.state }}</strong>
            <span>{{ action.scope }} scope · {{ action.itemId }}</span>
          </div>
          <div
            v-for="run in recentRuns?.slice(0, 5)"
            :key="run.id"
            class="recent-run-row"
          >
            <time :datetime="run.updatedAt">
              {{ new Date(run.updatedAt).toLocaleString() }}
            </time>
            <strong>{{ run.mode }} · {{ run.state }}</strong>
            <span>
              {{ run.estimatedTokens }} tokens · {{ run.questionCount }} questions
            </span>
          </div>
        </section>
      </div>

      <template v-else-if="context">
        <header class="workbench-result-head">
          <div>
            <span class="eyebrow">Reviewed local brief</span>
            <h2>{{ context.task }}</h2>
          </div>
          <button class="text-button" @click="copyPackage">
            {{ copied ? "Package copied" : "Copy package" }}
          </button>
        </header>

        <div class="evidence-lanes">
          <section>
            <span>Code</span>
            <strong>{{ context.code?.length ?? 0 }} candidates</strong>
            <p v-if="context.code?.length">
              {{ context.code.slice(0, 3).map((item) => item.name).join(" · ") }}
            </p>
            <p v-else>No matching code candidate yet.</p>
          </section>
          <section>
            <span>Design</span>
            <strong>{{ context.design?.candidates?.length ?? 0 }} candidates</strong>
            <p v-if="context.design?.selectionRequired">A design source needs selection.</p>
            <p v-else>{{ context.design?.available ? "Sparse design evidence available." : "Optional / unavailable." }}</p>
          </section>
          <section>
            <span>Memory</span>
            <strong>{{ context.memory?.length ?? 0 }} relevant items</strong>
            <p>{{ context.findings?.length ?? 0 }} findings enter the decision gate.</p>
          </section>
        </div>

        <section v-if="context.findings?.length" class="decision-band">
          <span>Needs review</span>
          <div>
            <strong>{{ context.findings[0]?.title }}</strong>
            <p>{{ context.findings[0]?.recommendation }}</p>
          </div>
        </section>

        <section v-if="!activeRun" class="launch-row">
          <div>
            <strong>{{ agentStatus?.label ?? "Codex" }}</strong>
            <span>{{ agentStatus?.detail ?? "Checking the local agent adapter…" }}</span>
          </div>
          <button
            class="secondary-button"
            :disabled="agentStatus?.state !== 'detected'"
            @click="reviewLaunch('read-only')"
          >
            Prepare with Codex
          </button>
          <button
            class="primary-button"
            :disabled="agentStatus?.state !== 'detected'"
            @click="reviewLaunch('workspace-write')"
          >
            Implement with Codex
          </button>
        </section>

        <section v-if="activeRun" class="run-ledger">
          <header>
            <div>
              <span class="eyebrow">Agent activity · {{ activeRun.state }}</span>
              <h2>{{ activeRun.threadId ? "Codex task in progress" : "Starting Codex" }}</h2>
            </div>
            <button
              v-if="['queued', 'running'].includes(activeRun.state)"
              class="secondary-button"
              @click="cancelRun"
            >
              Cancel safely
            </button>
          </header>
          <ol>
            <li v-for="item in progressEvents" :key="item.cursor">
              <span :class="['event-mark', item.event.type]" />
              <div>
                <strong>{{ eventLabel(item.event) }}</strong>
                <small>{{ new Date(item.event.at).toLocaleTimeString() }}</small>
              </div>
            </li>
          </ol>
        </section>

        <section v-if="materialQuestion && activeRun?.state === 'awaiting-input'" class="question-gate">
          <span class="eyebrow">Material question</span>
          <h2>{{ materialQuestion.prompt }}</h2>
          <ul>
            <li v-for="item in materialQuestion.evidence" :key="item">{{ item }}</li>
          </ul>
          <p><strong>Recommendation:</strong> {{ materialQuestion.recommendation }}</p>
          <textarea v-model="answer" rows="3" placeholder="Confirm or correct the recommendation" />
          <button class="primary-button" :disabled="!answer.trim()" @click="resumeRun">
            Continue this task
          </button>
        </section>

        <section v-if="latestResult" class="agent-result">
          <header>
            <div>
              <span class="eyebrow">Compact agent result</span>
              <h2>{{ latestResult.summary }}</h2>
            </div>
            <span :class="['result-state', latestResult.status]">{{ latestResult.status }}</span>
          </header>
          <div class="result-ledgers">
            <section>
              <span>Evidence</span>
              <p v-for="item in latestResult.evidence" :key="`${item.source}:${item.label}`">
                <strong>{{ item.source }}</strong> {{ item.label }}
              </p>
            </section>
            <section>
              <span>Decisions</span>
              <p v-for="item in latestResult.decisions" :key="item.title">
                <strong>{{ item.status }}</strong> {{ item.title }}
              </p>
              <p v-if="!latestResult.decisions.length">No new decision claimed.</p>
            </section>
            <section>
              <span>Risks</span>
              <p v-for="item in latestResult.risks" :key="item.title">
                <strong>{{ item.level }}</strong> {{ item.title }}
              </p>
              <p v-if="!latestResult.risks.length">No unresolved risk reported.</p>
            </section>
          </div>
          <label class="correction-box">
            Correct or continue without restarting
            <textarea
              v-model="correction"
              rows="3"
              placeholder="Change the scope, correct a result, or describe the next step"
            />
          </label>
          <button class="secondary-button" :disabled="!correction.trim()" @click="resumeRun">
            Continue same Codex task
          </button>
        </section>
        <p v-if="runError" class="inline-error">{{ runError }}</p>
      </template>
    </section>

    <aside class="workbench-inspector">
      <span class="eyebrow">Context inspector</span>
      <strong class="token-total">
        {{ context ? `${context.metrics.estimatedTokens} tokens` : "No agent context" }}
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
        <div><dt>Project</dt><dd>{{ projectName }}</dd></div>
        <div><dt>Branch</dt><dd>{{ identity?.branch ?? "detached / unknown" }}</dd></div>
        <div><dt>Checkout</dt><dd>{{ identity?.checkoutId.slice(0, 8) ?? "path scoped" }}</dd></div>
        <div><dt>Snapshot</dt><dd>{{ workspaceFingerprint.slice(0, 8) }}</dd></div>
        <div><dt>Sources</dt><dd>{{ sources.length }} explicit/detected</dd></div>
        <div><dt>Context</dt><dd>{{ context?.metrics.usedChars ?? 0 }} / {{ budgetChars }} chars</dd></div>
        <div><dt>Truncated</dt><dd>{{ context?.metrics.truncated ? "Yes" : "No" }}</dd></div>
      </dl>
      <div class="boundary-legend">
        <span><i class="local" />Local · 0 tokens</span>
        <span><i class="agent" />Agent · reviewed budget</span>
        <span><i class="external" />External write · approval</span>
      </div>
    </aside>

    <div v-if="launchReviewOpen" class="dialog-backdrop" @click.self="launchReviewOpen = false">
      <section class="launch-dialog" role="dialog" aria-modal="true" aria-labelledby="launch-title">
        <span class="eyebrow">Review before Codex starts</span>
        <h2 id="launch-title">{{ activeAction?.intent }}</h2>
        <p>{{ activeAction?.description }}</p>
        <dl>
          <div><dt>Project</dt><dd>{{ projectName }}</dd></div>
          <div><dt>Worktree</dt><dd>{{ projectRoot }}</dd></div>
          <div><dt>Branch</dt><dd>{{ identity?.branch ?? "unknown" }}</dd></div>
          <div><dt>Permission</dt><dd>{{ launchSandbox }}</dd></div>
          <div><dt>Context</dt><dd>{{ context?.metrics.estimatedTokens }} estimated tokens</dd></div>
          <div><dt>Sources</dt><dd>{{ sources.map((source) => source.kind).join(", ") || "repository + Atlas" }}</dd></div>
          <div><dt>Possible writes</dt><dd>{{ activeAction?.possibleWrites.join(", ") || "none" }}</dd></div>
          <div><dt>External writes</dt><dd>prohibited in this run</dd></div>
        </dl>
        <div class="dialog-actions">
          <button class="secondary-button" @click="launchReviewOpen = false">Back</button>
          <button class="primary-button" @click="startRun">
            Start reviewed Codex task
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
