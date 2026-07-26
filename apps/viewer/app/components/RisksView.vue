<script setup lang="ts">
import {
  commandsForActionItem,
  isBulkSafeAction,
  isOpenActionState,
  nextMaterialAction,
  type ActionCenterCommand,
  type ActionCenterItem,
  type ActionCenterMutation,
  type ActionCenterSnapshot,
  type ActionResolutionScope,
} from "@component-atlas/core/browser";

const emit = defineEmits<{
  prepareTask: [payload: { intent: string; handles: string[] }];
  openEvidence: [handle: string];
  changed: [];
}>();

const {
  data: center,
  pending,
  error,
  refresh,
} = await useFetch<ActionCenterSnapshot>("/api/action-center");

const selectedId = ref<string>();
const selectedIds = ref<string[]>([]);
const guided = ref(false);
const statusFilter = ref<"open" | "closed" | "all" | "stale">("open");
const typeFilter = ref("all");
const severityFilter = ref("all");
const sourceFilter = ref("all");
const reason = ref("");
const scope = ref<ActionResolutionScope>("evidence");
const deferUntil = ref("");
const selectedOption = ref("");
const alternativeHandle = ref("");
const confirmed = ref(false);
const pendingAction = ref("");
const actionError = ref("");
const actionNotice = ref("");

const filteredItems = computed(() =>
  (center.value?.items ?? []).filter((item) => {
    const open = isOpenActionState(item.state);
    const statusMatches =
      statusFilter.value === "all" ||
      (statusFilter.value === "open" && open) ||
      (statusFilter.value === "closed" && !open) ||
      (statusFilter.value === "stale" && item.state === "stale");
    return (
      statusMatches &&
      (typeFilter.value === "all" || item.type === typeFilter.value) &&
      (severityFilter.value === "all" ||
        item.severity === severityFilter.value) &&
      (sourceFilter.value === "all" || item.source === sourceFilter.value)
    );
  }),
);

const selected = computed(
  () =>
    center.value?.items.find((item) => item.id === selectedId.value) ??
    filteredItems.value[0],
);

const materialBlockers = computed(
  () =>
    center.value?.items.filter(
      (item) => item.blocking && isOpenActionState(item.state),
    ) ?? [],
);

const availableCommands = computed(() =>
  selected.value ? commandsForActionItem(selected.value.type) : [],
);

const bulkItems = computed(() =>
  (center.value?.items ?? []).filter(
    (item) =>
      selectedIds.value.includes(item.id) && isOpenActionState(item.state),
  ),
);

const bulkCommands = computed(() => {
  const candidates: ActionCenterCommand[] = [
    "mark-reviewed",
    "defer",
    "dismiss",
  ];
  return candidates.filter(
    (command) =>
      isBulkSafeAction(command) &&
      bulkItems.value.length > 0 &&
      bulkItems.value.every((item) =>
        commandsForActionItem(item.type).includes(command),
      ),
  );
});

watch(
  filteredItems,
  (items) => {
    if (!items.some((item) => item.id === selectedId.value)) {
      selectedId.value = items[0]?.id;
    }
  },
  { immediate: true },
);

watch(selectedId, () => {
  resetResolutionForm();
});

function actionLabel(command: ActionCenterCommand): string {
  const labels: Record<ActionCenterCommand, string> = {
    "save-decision-and-continue": "Resolve & continue origin run",
    "resolve-decision": "Resolve decision",
    "resolve-contradiction": "Choose authority & resolve",
    "request-clarification": "Request clarification",
    "mitigate-current-task": "Mitigate in current task",
    "create-follow-up-task": "Create follow-up task",
    "accept-risk": "Accept risk",
    "add-check": "Add as task check",
    "mark-reviewed": "Mark reviewed",
    defer: "Postpone",
    "connect-source": "Connect / select source",
    "use-alternative": "Use alternative",
    "continue-without-evidence": "Continue without evidence",
    dismiss: "Ignore warning",
  };
  return labels[command];
}

function commandNeedsConfirmation(command: ActionCenterCommand): boolean {
  return ["accept-risk", "continue-without-evidence", "dismiss"].includes(command);
}

function commandDisabledReason(
  command: ActionCenterCommand,
  item = selected.value,
): string {
  if (!item) return "Select an action item first.";
  if (pendingAction.value) return "Another action is being saved.";
  if (!reason.value.trim()) return "Add an explicit, bounded reason.";
  if (scope.value === "until-date" && !deferUntil.value) {
    return "Choose a future date for this scope.";
  }
  if (scope.value === "run" && !item.runId) {
    return "This item is not bound to an originating run.";
  }
  if (commandNeedsConfirmation(command) && !confirmed.value) {
    return "Confirm the consequence and scope first.";
  }
  if (
    command === "save-decision-and-continue" &&
    !item.runId
  ) {
    return "No originating run is bound to this decision.";
  }
  if (
    command === "resolve-contradiction" &&
    !selectedOption.value
  ) {
    return "Choose the authoritative source.";
  }
  if (command === "use-alternative" && !alternativeHandle.value.trim()) {
    return "Provide a bounded Atlas evidence handle.";
  }
  return "";
}

async function sessionToken(): Promise<string> {
  const session = await $fetch<{ token: string }>("/api/agent/session");
  return session.token;
}

function mutationFor(
  item: ActionCenterItem,
  command: ActionCenterCommand,
  idempotencyKey: string,
): ActionCenterMutation {
  return {
    schemaVersion: 1,
    itemId: item.id,
    projectId: item.projectId,
    checkoutId: item.checkoutId,
    ...(item.runId ? { runId: item.runId } : {}),
    ...(item.taskId ? { taskId: item.taskId } : {}),
    command,
    scope: scope.value,
    reason: reason.value.trim(),
    ...(selectedOption.value
      ? {
          selectedOption: selectedOption.value,
          authorityHandle: selectedOption.value,
        }
      : {}),
    ...(alternativeHandle.value.trim()
      ? { alternativeHandle: alternativeHandle.value.trim() }
      : {}),
    ...(scope.value === "until-date" && deferUntil.value
      ? { deferUntil: new Date(`${deferUntil.value}T23:59:59`).toISOString() }
      : {}),
    expectedWorkspaceFingerprint: center.value!.workspaceFingerprint,
    expectedEvidenceFingerprint: item.evidenceFingerprint,
    idempotencyKey,
  };
}

function errorMessage(caught: unknown): string {
  if (
    typeof caught === "object" &&
    caught &&
    "data" in caught &&
    typeof caught.data === "object" &&
    caught.data &&
    "statusMessage" in caught.data &&
    typeof caught.data.statusMessage === "string"
  ) {
    return caught.data.statusMessage;
  }
  return caught instanceof Error
    ? caught.message
    : "The Action Center request could not be saved.";
}

async function runAction(command: ActionCenterCommand): Promise<void> {
  const item = selected.value;
  const disabledReason = commandDisabledReason(command, item);
  if (!item || !center.value || disabledReason) return;
  pendingAction.value = command;
  actionError.value = "";
  actionNotice.value = "";
  try {
    const token = await sessionToken();
    const result = await $fetch<{
      duplicate: boolean;
      followUpTask?: { id: string; intent: string; handles: string[] };
      delta?: { evidenceHandles: string[] };
      connector?: { next: "connections" };
    }>("/api/action-center/actions", {
      method: "POST",
      headers: { "x-atlas-session": token },
      body: mutationFor(item, command, crypto.randomUUID()),
    });
    if (result.followUpTask) {
      emit("prepareTask", {
        intent: result.followUpTask.intent,
        handles: result.followUpTask.handles,
      });
    } else if (result.delta) {
      emit("prepareTask", {
        intent: `${actionLabel(command)}: ${reason.value.trim()}`,
        handles: result.delta.evidenceHandles,
      });
    } else if (result.connector) {
      emit("openEvidence", "integration:connections");
    }
    actionNotice.value = result.duplicate
      ? "This request was already recorded; no action was repeated."
      : `${actionLabel(command)} recorded with evidence provenance.`;
    await refresh();
    emit("changed");
    if (guided.value) {
      selectedId.value = nextMaterialAction(center.value?.items ?? [])?.id;
    }
  } catch (caught) {
    actionError.value = errorMessage(caught);
  } finally {
    pendingAction.value = "";
  }
}

async function runBulk(command: ActionCenterCommand): Promise<void> {
  if (
    !center.value ||
    !bulkItems.value.length ||
    !bulkCommands.value.includes(command) ||
    commandDisabledReason(command, bulkItems.value[0])
  ) {
    return;
  }
  pendingAction.value = `bulk:${command}`;
  actionError.value = "";
  actionNotice.value = "";
  try {
    const token = await sessionToken();
    await $fetch("/api/action-center/bulk", {
      method: "POST",
      headers: { "x-atlas-session": token },
      body: {
        mutations: bulkItems.value.map((item) =>
          mutationFor(item, command, crypto.randomUUID()),
        ),
      },
    });
    actionNotice.value = `${bulkItems.value.length} safe triage actions recorded atomically.`;
    selectedIds.value = [];
    await refresh();
    emit("changed");
  } catch (caught) {
    actionError.value = errorMessage(caught);
  } finally {
    pendingAction.value = "";
  }
}

function resolveNext(): void {
  const next = nextMaterialAction(center.value?.items ?? []);
  if (!next) return;
  guided.value = true;
  statusFilter.value = "open";
  selectedId.value = next.id;
}

function toggleSelected(id: string): void {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((candidate) => candidate !== id)
    : [...selectedIds.value, id];
}

function resetResolutionForm(): void {
  reason.value = "";
  scope.value = "evidence";
  deferUntil.value = "";
  selectedOption.value = "";
  alternativeHandle.value = "";
  confirmed.value = false;
  actionError.value = "";
  actionNotice.value = "";
}
</script>

<template>
  <div class="action-center" aria-live="polite">
    <section v-if="pending && !center" class="action-state" aria-busy="true">
      <span class="mini-loader" />
      <div>
        <h2>Building the action queue</h2>
        <p>Atlas is matching canonical evidence to prior resolutions.</p>
      </div>
    </section>

    <section v-else-if="error && !center" class="action-state error" role="alert">
      <AtlasIcon name="risk" />
      <div>
        <h2>Action Center is unavailable</h2>
        <p>{{ error.message }}</p>
        <button class="secondary-button" @click="refresh()">Retry</button>
      </div>
    </section>

    <template v-else-if="center">
      <header class="action-toolbar">
        <div>
          <span class="eyebrow">Action Center · schema v{{ center.schemaVersion }}</span>
          <h2>
            {{ center.counts.materialBlockers }} material
            blocker{{ center.counts.materialBlockers === 1 ? "" : "s" }}
          </h2>
          <p>Every resolution keeps evidence, consequence, scope, and audit provenance intact.</p>
        </div>
        <button
          class="primary-button"
          :disabled="!center.counts.open"
          :title="center.counts.open ? 'Open the highest-priority item' : 'No open actions remain'"
          @click="resolveNext"
        >
          <AtlasIcon name="arrow-right" />
          Resolve next
        </button>
      </header>

      <div v-if="guided" class="guided-banner">
        <span>
          <strong>Guided triage</strong> · blockers and urgency determine the next item.
        </span>
        <span v-if="materialBlockers.length">
          Continue stays gated until {{ materialBlockers.length }} material
          blocker{{ materialBlockers.length === 1 ? "" : "s" }} are resolved.
        </span>
        <span v-else>All material blockers are resolved.</span>
        <button class="secondary-button" @click="guided = false">Exit guide</button>
      </div>

      <div class="action-filters" aria-label="Action Center filters">
        <label>
          Status
          <select v-model="statusFilter">
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="stale">Evidence changed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Type
          <select v-model="typeFilter">
            <option value="all">All types</option>
            <option value="decision-required">Decision required</option>
            <option value="contradiction">Contradiction</option>
            <option value="risk">Risk</option>
            <option value="warning">Warning</option>
            <option value="missing-evidence">Missing evidence</option>
          </select>
        </label>
        <label>
          Severity
          <select v-model="severityFilter">
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label>
          Source
          <select v-model="sourceFilter">
            <option value="all">All sources</option>
            <option value="repository">Repository</option>
            <option value="design">Design</option>
            <option value="memory">Memory</option>
            <option value="agent">Agent run</option>
            <option value="integration">Integration</option>
          </select>
        </label>
      </div>

      <section v-if="selectedIds.length" class="bulk-bar" aria-label="Safe bulk actions">
        <span>
          <strong>{{ selectedIds.length }} selected</strong>
          <small>Only reversible review, postpone, and ignore operations can be applied together.</small>
        </span>
        <button
          v-for="command in bulkCommands"
          :key="command"
          class="secondary-button"
          :disabled="Boolean(commandDisabledReason(command, bulkItems[0]))"
          :title="commandDisabledReason(command, bulkItems[0])"
          @click="runBulk(command)"
        >
          {{ actionLabel(command) }}
        </button>
        <button class="secondary-button" @click="selectedIds = []">Clear</button>
      </section>

      <p v-if="actionNotice" class="inline-success">{{ actionNotice }}</p>
      <p v-if="actionError" class="inline-error" role="alert">{{ actionError }}</p>

      <div v-if="!filteredItems.length" class="action-state empty">
        <AtlasIcon name="check" />
        <div>
          <h2>No actions match these filters</h2>
          <p>Change a filter or continue if no material blockers remain.</p>
        </div>
      </div>

      <div v-else class="action-layout">
        <section class="action-list" aria-label="Action queue">
          <article
            v-for="item in filteredItems"
            :key="item.id"
            :class="[
              'action-row',
              item.type,
              {
                selected: selected?.id === item.id,
                stale: item.resolutionInvalidated,
              },
            ]"
          >
            <label
              class="action-select"
              :title="isOpenActionState(item.state) ? 'Select for compatible safe triage' : 'Closed items cannot be triaged again'"
            >
              <input
                type="checkbox"
                :checked="selectedIds.includes(item.id)"
                :disabled="!isOpenActionState(item.state)"
                :aria-label="`Select ${item.title}`"
                @change="toggleSelected(item.id)"
              >
            </label>
            <button class="action-row-main" @click="selectedId = item.id">
              <span class="action-row-top">
                <span :class="['action-severity', item.severity]">{{ item.severity }}</span>
                <span>{{ item.type }}</span>
                <span>{{ item.state }}</span>
                <strong v-if="item.blocking">Blocking</strong>
              </span>
              <strong>{{ item.title }}</strong>
              <p>{{ item.detected }}</p>
              <small>{{ item.affectedTask }}</small>
            </button>
          </article>
        </section>

        <aside
          v-if="selected"
          class="action-inspector"
          :aria-label="`Action details: ${selected.title}`"
        >
          <header>
            <div>
              <span class="eyebrow">{{ selected.source }} · {{ selected.type }}</span>
              <h2>{{ selected.title }}</h2>
            </div>
            <span :class="['action-severity', selected.severity]">
              {{ selected.severity }}
            </span>
          </header>

          <div v-if="selected.resolutionInvalidated" class="stale-callout" role="status">
            <strong>Evidence changed</strong>
            <p>
              The prior {{ selected.resolution?.command }} resolution no longer
              matches this evidence fingerprint. Human review is required again.
            </p>
          </div>

          <dl class="action-explanation">
            <div>
              <dt>What Atlas detected</dt>
              <dd>{{ selected.detected }}</dd>
            </div>
            <div>
              <dt>Why it matters</dt>
              <dd>{{ selected.whyItMatters }}</dd>
            </div>
            <div>
              <dt>Affected task</dt>
              <dd>{{ selected.affectedTask }}</dd>
            </div>
            <div>
              <dt>If you do nothing</dt>
              <dd>{{ selected.consequence }}</dd>
            </div>
            <div>
              <dt>Recommended action</dt>
              <dd>{{ selected.recommendation }}</dd>
            </div>
          </dl>

          <section class="evidence-panel">
            <header>
              <div>
                <span class="eyebrow">Evidence</span>
                <h3>
                  {{ selected.evidence.length }} bounded
                  handle{{ selected.evidence.length === 1 ? "" : "s" }}
                </h3>
              </div>
              <code>{{ selected.evidenceFingerprint.slice(0, 10) }}</code>
            </header>
            <div :class="{ 'evidence-compare': selected.type === 'contradiction' }">
              <article
                v-for="evidence in selected.evidence"
                :key="evidence.handle"
              >
                <span>{{ evidence.source }}</span>
                <strong>{{ evidence.label }}</strong>
                <p>{{ evidence.summary }}</p>
                <button
                  class="text-button"
                  @click="emit('openEvidence', evidence.handle)"
                >
                  Open evidence
                </button>
              </article>
            </div>
          </section>

          <section v-if="isOpenActionState(selected.state)" class="resolution-panel">
            <span class="eyebrow">Resolution with provenance</span>
            <label v-if="selected.options?.length">
              Authority / option
              <select v-model="selectedOption">
                <option value="">Choose an option</option>
                <option
                  v-for="option in selected.options"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label v-if="availableCommands.includes('use-alternative')">
              Alternative Atlas handle
              <input
                v-model="alternativeHandle"
                maxlength="240"
                placeholder="memory:item-id or design:file:node"
              >
            </label>
            <label>
              Reason
              <textarea
                v-model="reason"
                maxlength="500"
                rows="3"
                placeholder="Why is this action correct for the selected scope?"
              />
            </label>
            <div class="resolution-scope">
              <label>
                <input v-model="scope" type="radio" value="run">
                Only the originating run
              </label>
              <label>
                <input v-model="scope" type="radio" value="evidence">
                Until evidence, code, or design changes
              </label>
              <label>
                <input v-model="scope" type="radio" value="until-date">
                Until a date
              </label>
              <label>
                <input v-model="scope" type="radio" value="project">
                Stable project decision
              </label>
            </div>
            <label v-if="scope === 'until-date'">
              Review again on
              <input v-model="deferUntil" type="date">
            </label>
            <p v-if="scope === 'project'" class="scope-note">
              This audit record does not bypass the Project Memory
              proposal-and-approval gate for canonical knowledge.
            </p>
            <label
              v-if="availableCommands.some(commandNeedsConfirmation)"
              class="confirmation-check"
            >
              <input v-model="confirmed" type="checkbox">
              I understand the consequence and confirm this scope. Canonical
              evidence will not be modified.
            </label>

            <div class="action-buttons">
              <button
                v-for="command in availableCommands"
                :key="command"
                :class="
                  commandNeedsConfirmation(command)
                    ? 'danger-button'
                    : command === 'save-decision-and-continue' ||
                        command === 'resolve-decision' ||
                        command === 'resolve-contradiction'
                      ? 'primary-button'
                      : 'secondary-button'
                "
                :disabled="Boolean(commandDisabledReason(command))"
                :title="commandDisabledReason(command)"
                @click="runAction(command)"
              >
                <span v-if="pendingAction === command" class="mini-loader" />
                {{ actionLabel(command) }}
              </button>
              <button
                class="text-button"
                :disabled="Boolean(pendingAction)"
                @click="resetResolutionForm"
              >
                Clear
              </button>
            </div>
          </section>

          <section v-else-if="selected.resolution" class="resolution-audit">
            <span class="eyebrow">Resolution audit</span>
            <dl>
              <div>
                <dt>Command</dt>
                <dd>{{ selected.resolution.command }}</dd>
              </div>
              <div>
                <dt>Scope</dt>
                <dd>{{ selected.resolution.scope }}</dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{{ selected.resolution.reason }}</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>{{ new Date(selected.resolution.resolvedAt).toLocaleString() }}</dd>
              </div>
            </dl>
            <p>Fingerprint {{ selected.resolution.evidenceFingerprint }}</p>
          </section>
        </aside>
      </div>
    </template>
  </div>
</template>
