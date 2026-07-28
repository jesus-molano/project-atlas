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
import { localizeActionCenterItem } from "~/i18n/generated";

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
const actionNotice = ref<{
  key: string;
  command?: ActionCenterCommand;
  count?: number;
}>();
const actionInspector = ref<HTMLElement>();
const { formatDate, locale, runtimeMessage, statusLabel, t } = useAtlasI18n();

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
const localizedSelected = computed(() =>
  selected.value
    ? localizeActionCenterItem(selected.value, locale.value)
    : undefined,
);

function displayItem(item: ActionCenterItem) {
  return localizeActionCenterItem(item, locale.value);
}

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
  return t(labels[command]);
}

function commandNeedsConfirmation(command: ActionCenterCommand): boolean {
  return ["accept-risk", "continue-without-evidence", "dismiss"].includes(command);
}

function commandDisabledReason(
  command: ActionCenterCommand,
  item = selected.value,
): string {
  if (!item) return t("Select an action item first.");
  if (pendingAction.value) return t("Another action is being saved.");
  if (!reason.value.trim()) return t("Add an explicit, bounded reason.");
  if (scope.value === "until-date" && !deferUntil.value) {
    return t("Choose a future date for this scope.");
  }
  if (scope.value === "run" && !item.runId) {
    return t("This item is not bound to an originating run.");
  }
  if (commandNeedsConfirmation(command) && !confirmed.value) {
    return t("Confirm the consequence and scope first.");
  }
  if (
    command === "save-decision-and-continue" &&
    !item.runId
  ) {
    return t("No originating run is bound to this decision.");
  }
  if (
    command === "resolve-contradiction" &&
    !selectedOption.value
  ) {
    return t("Choose the authoritative source.");
  }
  if (command === "use-alternative" && !alternativeHandle.value.trim()) {
    return t("Provide a bounded Atlas evidence handle.");
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

async function runAction(command: ActionCenterCommand): Promise<void> {
  const item = selected.value;
  const disabledReason = commandDisabledReason(command, item);
  if (!item || !center.value || disabledReason) return;
  pendingAction.value = command;
  actionError.value = "";
  actionNotice.value = undefined;
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
      ? { key: "This request was already recorded; no action was repeated." }
      : {
          key: "{action} recorded with evidence provenance.",
          command,
        };
    await refresh();
    emit("changed");
    if (guided.value) {
      selectedId.value = nextMaterialAction(center.value?.items ?? [])?.id;
    }
  } catch (caught) {
    actionError.value = atlasErrorSource(
      caught,
      "The Action Center request could not be saved.",
    );
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
  actionNotice.value = undefined;
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
    actionNotice.value = {
      key: "{count} safe triage actions recorded atomically.",
      count: bulkItems.value.length,
    };
    selectedIds.value = [];
    await refresh();
    emit("changed");
  } catch (caught) {
    actionError.value = atlasErrorSource(
      caught,
      "The Action Center request could not be saved.",
    );
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
  actionNotice.value = undefined;
}
</script>

<template>
  <div class="action-center" aria-live="polite">
    <section v-if="pending && !center" class="action-state" aria-busy="true">
      <span class="mini-loader" />
      <div>
        <h2>{{ t("Building the action queue") }}</h2>
        <p>{{ t("Atlas is matching canonical evidence to prior resolutions.") }}</p>
      </div>
    </section>

    <section v-else-if="error && !center" class="action-state error" role="alert">
      <AtlasIcon name="risk" />
      <div>
        <h2>{{ t("Action Center is unavailable") }}</h2>
        <p>{{ runtimeMessage(error, "The Action Center request could not be saved.") }}</p>
        <button class="secondary-button" @click="refresh()">{{ t("Retry") }}</button>
      </div>
    </section>

    <template v-else-if="center">
      <header class="action-toolbar">
        <div>
          <span class="eyebrow">{{ t("Action Center") }} · {{ t("schema v{version}", { version: center.schemaVersion }) }}</span>
          <h2>
            {{ t(
              center.counts.materialBlockers === 1
                ? "{count} material blocker"
                : "{count} material blockers",
              { count: center.counts.materialBlockers },
            ) }}
          </h2>
          <p>{{ t("Every resolution keeps evidence, consequence, scope, and audit provenance intact.") }}</p>
        </div>
        <button
          class="primary-button"
          :disabled="!center.counts.open"
          :title="center.counts.open ? t('Open the highest-priority item') : t('No open actions remain')"
          @click="resolveNext"
        >
          <AtlasIcon name="arrow-right" />
          {{ t("Resolve next") }}
        </button>
      </header>

      <div v-if="guided" class="guided-banner">
        <span>
          <strong>{{ t("Guided triage") }}</strong> · {{ t("Blockers and urgency determine the next item.") }}
        </span>
        <span v-if="materialBlockers.length">
          {{ t(
            materialBlockers.length === 1
              ? "Continue stays gated until {count} material blocker is resolved."
              : "Continue stays gated until {count} material blockers are resolved.",
            { count: materialBlockers.length },
          ) }}
        </span>
        <span v-else>{{ t("All material blockers are resolved.") }}</span>
        <button class="secondary-button" @click="guided = false">{{ t("Exit guide") }}</button>
      </div>

      <div class="action-filters" :aria-label="t('Action Center filters')">
        <label>
          {{ t("Status") }}
          <select v-model="statusFilter">
            <option value="open">{{ statusLabel("open") }}</option>
            <option value="closed">{{ statusLabel("closed") }}</option>
            <option value="stale">{{ t("Evidence changed") }}</option>
            <option value="all">{{ t("All") }}</option>
          </select>
        </label>
        <label>
          {{ t("Type") }}
          <select v-model="typeFilter">
            <option value="all">{{ t("All types") }}</option>
            <option value="decision-required">{{ statusLabel("decision-required") }}</option>
            <option value="contradiction">{{ statusLabel("contradiction") }}</option>
            <option value="risk">{{ statusLabel("risk") }}</option>
            <option value="warning">{{ statusLabel("warning") }}</option>
            <option value="missing-evidence">{{ statusLabel("missing-evidence") }}</option>
          </select>
        </label>
        <label>
          {{ t("Severity") }}
          <select v-model="severityFilter">
            <option value="all">{{ t("All severities") }}</option>
            <option value="critical">{{ statusLabel("critical") }}</option>
            <option value="high">{{ statusLabel("high") }}</option>
            <option value="medium">{{ statusLabel("medium") }}</option>
            <option value="low">{{ statusLabel("low") }}</option>
            <option value="info">{{ statusLabel("info") }}</option>
          </select>
        </label>
        <label>
          {{ t("Source") }}
          <select v-model="sourceFilter">
            <option value="all">{{ t("All sources") }}</option>
            <option value="repository">{{ t("Repository") }}</option>
            <option value="design">{{ t("Design") }}</option>
            <option value="memory">{{ t("Memory") }}</option>
            <option value="agent">{{ t("Agent run") }}</option>
            <option value="integration">{{ t("Integration") }}</option>
          </select>
        </label>
      </div>

      <section v-if="selectedIds.length" class="bulk-bar" :aria-label="t('Safe bulk actions')">
        <span>
          <strong>{{ t("{count} selected", { count: selectedIds.length }) }}</strong>
          <small>{{ t("Only reversible review, postpone, and ignore operations can be applied together.") }}</small>
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
        <button class="secondary-button" @click="selectedIds = []">{{ t("Clear") }}</button>
      </section>

      <p v-if="actionNotice" class="inline-success">
        {{
          t(actionNotice.key, {
            action: actionNotice.command ? actionLabel(actionNotice.command) : "",
            count: actionNotice.count ?? 0,
          })
        }}
      </p>
      <p v-if="actionError" class="inline-error" role="alert">{{ runtimeMessage(actionError) }}</p>

      <div v-if="!filteredItems.length" class="action-state empty">
        <AtlasIcon name="check" />
        <div>
          <h2>{{ t("No actions match these filters") }}</h2>
          <p>{{ t("Change a filter or continue if no material blockers remain.") }}</p>
        </div>
      </div>

      <div v-else class="action-layout">
        <section class="action-list" :aria-label="t('Action queue')">
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
              :title="isOpenActionState(item.state) ? t('Select for compatible safe triage') : t('Closed items cannot be triaged again')"
            >
              <input
                type="checkbox"
                :checked="selectedIds.includes(item.id)"
                :disabled="!isOpenActionState(item.state)"
                :aria-label="t('Select {title}', { title: displayItem(item).title })"
                @change="toggleSelected(item.id)"
              >
            </label>
            <button class="action-row-main" @click="selectedId = item.id">
              <span class="action-row-top">
                <span :class="['action-severity', item.severity]">{{ statusLabel(item.severity) }}</span>
                <span>{{ statusLabel(item.type) }}</span>
                <span>{{ statusLabel(item.state) }}</span>
                <strong v-if="item.blocking">{{ t("Blocking") }}</strong>
              </span>
              <strong>{{ displayItem(item).title }}</strong>
              <p>{{ displayItem(item).detected }}</p>
              <small>{{ displayItem(item).affectedTask }}</small>
            </button>
          </article>
        </section>

        <aside
          v-if="selected"
          ref="actionInspector"
          class="action-inspector"
          tabindex="-1"
          :aria-label="t('Action details: {title}', { title: localizedSelected?.title ?? selected.title })"
        >
          <header>
            <div>
              <span class="eyebrow">{{ statusLabel(selected.source) }} · {{ statusLabel(selected.type) }}</span>
              <h2>{{ localizedSelected?.title }}</h2>
            </div>
            <span :class="['action-severity', selected.severity]">
              {{ statusLabel(selected.severity) }}
            </span>
          </header>

          <div v-if="selected.resolutionInvalidated" class="stale-callout" role="status">
            <strong>{{ t("Evidence changed") }}</strong>
            <p>
              {{ t("The prior {command} resolution no longer matches this evidence fingerprint. Human review is required again.", {
                command: selected.resolution?.command ? actionLabel(selected.resolution.command) : "",
              }) }}
            </p>
          </div>

          <dl class="action-explanation">
            <div>
              <dt>{{ t("What Atlas detected") }}</dt>
              <dd>{{ localizedSelected?.detected }}</dd>
            </div>
            <div>
              <dt>{{ t("Why it matters") }}</dt>
              <dd>{{ localizedSelected?.whyItMatters }}</dd>
            </div>
            <div>
              <dt>{{ t("Affected task") }}</dt>
              <dd>{{ localizedSelected?.affectedTask }}</dd>
            </div>
            <div>
              <dt>{{ t("If you do nothing") }}</dt>
              <dd>{{ localizedSelected?.consequence }}</dd>
            </div>
            <div>
              <dt>{{ t("Recommended action") }}</dt>
              <dd>{{ localizedSelected?.recommendation }}</dd>
            </div>
          </dl>

          <section class="evidence-panel">
            <header>
              <div>
                <span class="eyebrow">{{ t("Evidence") }}</span>
                <h3>
                  {{ t(
                    selected.evidence.length === 1
                      ? "{count} bounded handle"
                      : "{count} bounded handles",
                    { count: selected.evidence.length },
                  ) }}
                </h3>
              </div>
              <code>{{ selected.evidenceFingerprint.slice(0, 10) }}</code>
            </header>
            <div :class="{ 'evidence-compare': selected.type === 'contradiction' }">
              <article
                v-for="evidence in selected.evidence"
                :key="evidence.handle"
              >
                <span>{{ statusLabel(evidence.source) }}</span>
                <strong>{{ evidence.label }}</strong>
                <p>{{ evidence.summary }}</p>
                <button
                  class="text-button"
                  @click="emit('openEvidence', evidence.handle)"
                >
                  {{ t("Open evidence") }}
                </button>
              </article>
            </div>
          </section>

          <section v-if="isOpenActionState(selected.state)" class="resolution-panel">
            <span class="eyebrow">{{ t("Resolution with provenance") }}</span>
            <label v-if="selected.options?.length">
              {{ t("Authority / option") }}
              <select v-model="selectedOption">
                <option value="">{{ t("Choose an option") }}</option>
                <option
                  v-for="option in localizedSelected?.options"
                  :key="option.id"
                  :value="option.id"
                  :title="option.detail"
                >
                  {{ option.label }}
                </option>
              </select>
            </label>
            <label v-if="availableCommands.includes('use-alternative')">
              {{ t("Alternative Atlas handle") }}
              <input
                v-model="alternativeHandle"
                maxlength="240"
                :placeholder="t('memory:item-id or design:file:node')"
              >
            </label>
            <label>
              {{ t("Reason") }}
              <textarea
                v-model="reason"
                maxlength="500"
                rows="3"
                :placeholder="t('Why is this action correct for the selected scope?')"
              />
            </label>
            <div class="resolution-scope">
              <label>
                <input v-model="scope" type="radio" value="run">
                <span>{{ t("Only the originating run") }}</span>
              </label>
              <label>
                <input v-model="scope" type="radio" value="evidence">
                <span>{{ t("Until evidence, code, or design changes") }}</span>
              </label>
              <label>
                <input v-model="scope" type="radio" value="until-date">
                <span>{{ t("Until a date") }}</span>
              </label>
              <label>
                <input v-model="scope" type="radio" value="project">
                <span>{{ t("Stable project decision") }}</span>
              </label>
            </div>
            <label v-if="scope === 'until-date'">
              {{ t("Review again on") }}
              <input v-model="deferUntil" type="date">
            </label>
            <p v-if="scope === 'project'" class="scope-note">
              {{ t("This audit record does not bypass the Project Memory proposal-and-approval gate for canonical knowledge.") }}
            </p>
            <label
              v-if="availableCommands.some(commandNeedsConfirmation)"
              class="confirmation-check"
            >
              <input v-model="confirmed" type="checkbox">
              <span>{{ t("I understand the consequence and confirm this scope. Canonical evidence will not be modified.") }}</span>
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
                {{ t("Clear") }}
              </button>
            </div>
          </section>

          <section v-else-if="selected.resolution" class="resolution-audit">
            <span class="eyebrow">{{ t("Resolution audit") }}</span>
            <dl>
              <div>
                <dt>{{ t("Command") }}</dt>
                <dd>{{ actionLabel(selected.resolution.command) }}</dd>
              </div>
              <div>
                <dt>{{ t("Scope") }}</dt>
                <dd>{{ statusLabel(selected.resolution.scope) }}</dd>
              </div>
              <div>
                <dt>{{ t("Reason") }}</dt>
                <dd>{{ selected.resolution.reason }}</dd>
              </div>
              <div>
                <dt>{{ t("Recorded") }}</dt>
                <dd>{{ formatDate(selected.resolution.resolvedAt) }}</dd>
              </div>
            </dl>
            <p>{{ t("Fingerprint") }} {{ selected.resolution.evidenceFingerprint }}</p>
          </section>
        </aside>
        <ScrollToTopButton
          :target="actionInspector"
          :focus-target="actionInspector"
          placement="panel"
          :threshold="220"
          :min-overflow="360"
        />
      </div>
    </template>
  </div>
</template>
