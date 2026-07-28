<script setup lang="ts">
import type { MemoryItemDraft, MemoryProposal } from "@component-atlas/memory";
import { localizeMemoryFinding } from "~/i18n/generated";

const props = defineProps<{ proposals: MemoryProposal[] }>();
const emit = defineEmits<{ changed: [] }>();
const selectedId = ref(props.proposals[0]?.id);
const mode = ref<"review" | "edit">("review");
const rationale = ref("");
const evidenceText = ref("");
const itemsText = ref("");
const target = ref<"local" | "canonical">("local");
const rejectReason = ref("");
const combineSource = ref("");
const decisionMode = ref<"approve" | "reject">();
const approveTrigger = ref<HTMLButtonElement>();
const rejectTrigger = ref<HTMLButtonElement>();
const approvalTarget = ref<HTMLSelectElement>();
const rejectionInput = ref<HTMLTextAreaElement>();
const decisionZone = ref<HTMLElement>();
const pending = ref(false);
const error = ref("");
const message = ref<{ key: string; status?: string }>();
const { formatDate, locale, runtimeMessage, statusLabel, t } = useAtlasI18n();
const selected = computed(
  () => props.proposals.find((proposal) => proposal.id === selectedId.value) ?? props.proposals[0],
);
const combinable = computed(() =>
  props.proposals.filter(
    (proposal) =>
      proposal.status === "pending" && proposal.id !== selected.value?.id,
  ),
);

function displayFinding(finding: MemoryProposal["findings"][number]) {
  return localizeMemoryFinding(finding, locale.value);
}

function selectProposal(proposalId: string): void {
  selectedId.value = proposalId;
  nextTick(() => {
    decisionZone.value?.focus({ preventScroll: true });
    decisionZone.value?.scrollIntoView({
      block: "start",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  });
}

watch(
  () => props.proposals,
  (proposals) => {
    if (!proposals.some((proposal) => proposal.id === selectedId.value)) {
      selectedId.value = proposals[0]?.id;
    }
  },
);

watch(selected, (proposal) => {
  if (!proposal) return;
  rationale.value = proposal.rationale;
  evidenceText.value = proposal.evidence.join("\n");
  itemsText.value = JSON.stringify(proposal.items, null, 2);
  mode.value = "review";
  decisionMode.value = undefined;
  rejectReason.value = "";
  combineSource.value = "";
}, { immediate: true });

function openDecision(nextMode: "approve" | "reject"): void {
  decisionMode.value = decisionMode.value === nextMode ? undefined : nextMode;
  if (!decisionMode.value) return;
  nextTick(() => {
    if (nextMode === "approve") approvalTarget.value?.focus();
    else rejectionInput.value?.focus();
  });
}

function cancelDecision(): void {
  const previousMode = decisionMode.value;
  decisionMode.value = undefined;
  nextTick(() => {
    if (previousMode === "approve") approveTrigger.value?.focus();
    else rejectTrigger.value?.focus();
  });
}

async function act(body: Record<string, unknown>): Promise<void> {
  pending.value = true;
  error.value = "";
  message.value = undefined;
  try {
    const session = await $fetch<{ token: string }>("/api/agent/session");
    const result = await $fetch<{ status?: string }>("/api/memory-proposal", {
      method: "POST",
      headers: { "x-atlas-session": session.token },
      body,
    });
    message.value = result.status
      ? { key: "Proposal {status}.", status: result.status }
      : { key: "Proposal updated." };
    emit("changed");
  } catch (caught) {
    error.value = atlasErrorSource(caught);
  } finally {
    pending.value = false;
  }
}

async function revise(): Promise<void> {
  if (!selected.value) return;
  let items: MemoryItemDraft[];
  try {
    items = JSON.parse(itemsText.value) as MemoryItemDraft[];
    if (!Array.isArray(items)) throw new Error("Items must be a JSON array.");
  } catch (caught) {
    error.value = atlasErrorSource(caught);
    return;
  }
  await act({
    action: "revise",
    proposalId: selected.value.id,
    rationale: rationale.value,
    evidence: evidenceText.value.split("\n").map((value) => value.trim()).filter(Boolean),
    items,
  });
}

async function approveSelected(): Promise<void> {
  if (!selected.value) return;
  await act({
    action: "apply",
    proposalId: selected.value.id,
    confirmed: true,
    target: target.value,
  });
}

async function rejectSelected(): Promise<void> {
  if (!selected.value) return;
  await act({
    action: "reject",
    proposalId: selected.value.id,
    confirmed: true,
    reason: rejectReason.value,
  });
}

function combineSelected(): void {
  if (!selected.value || !combineSource.value) return;
  void act({
    action: "combine",
    proposalId: selected.value.id,
    sourceProposalId: combineSource.value,
    confirmed: true,
  });
}
</script>

<template>
  <div v-if="!proposals.length" class="section-empty">
    <AtlasIcon name="inbox" />
    <h2>{{ t("No memory proposals") }}</h2>
    <p>{{ t("Agents can read automatically, but durable semantic knowledge enters this inbox before it becomes active.") }}</p>
  </div>
  <div v-else class="atlas-workspace inbox-layout">
    <aside class="index-pane">
      <div class="index-summary">
        <span>{{ t("{count} pending", { count: proposals.filter((item) => item.status === "pending").length }) }}</span>
        <span>{{ t("{count} total", { count: proposals.length }) }}</span>
      </div>
      <div class="entity-list">
        <button
          v-for="proposal in proposals"
          :key="proposal.id"
          :class="{ active: selected?.id === proposal.id }"
          :aria-pressed="selected?.id === proposal.id"
          :title="proposal.rationale"
          @click="selectProposal(proposal.id)"
        >
          <span :class="['entity-mark', proposal.status]" />
          <span><strong>{{ proposal.rationale }}</strong><small>{{ t(proposal.items.length === 1 ? "{count} item · {date}" : "{count} items · {date}", { count: proposal.items.length, date: formatDate(proposal.createdAt) }) }}</small></span>
          <em>{{ statusLabel(proposal.status) }}</em>
        </button>
      </div>
    </aside>
    <section v-if="selected" class="proposal-detail">
      <header class="workspace-toolbar">
        <div>
          <span class="eyebrow">{{ t("Proposal") }} / {{ selected.id }}</span>
          <h2>{{ selected.rationale }}</h2>
        </div>
        <div v-if="selected.status === 'pending'" class="segmented">
          <button :class="{ active: mode === 'review' }" @click="mode = 'review'">{{ t("Review") }}</button>
          <button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">{{ t("Edit") }}</button>
        </div>
      </header>
      <section
        ref="decisionZone"
        class="proposal-decision-zone"
        :aria-label="t('Proposal decision')"
        tabindex="-1"
      >
        <div class="proposal-decision-heading">
          <div>
            <span class="eyebrow">{{ t("Semantic write gate") }}</span>
            <p v-if="selected.status === 'pending'">
              {{ t("Choose Approve or Reject. Atlas asks for the runtime confirmation before changing project memory.") }}
            </p>
          </div>
          <span v-if="selected.status !== 'pending'" class="status-chip">
            {{ statusLabel(selected.status) }}
          </span>
        </div>
        <template v-if="selected.status === 'pending'">
          <div class="proposal-primary-actions" role="group" :aria-label="t('Proposal decision')">
            <button
              ref="approveTrigger"
              class="primary-button"
              :aria-expanded="decisionMode === 'approve'"
              aria-controls="proposal-approval-panel"
              :disabled="pending"
              @click="openDecision('approve')"
            >
              {{ t("Approve") }}
            </button>
            <button
              ref="rejectTrigger"
              class="danger-button"
              :aria-expanded="decisionMode === 'reject'"
              aria-controls="proposal-rejection-panel"
              :disabled="pending"
              @click="openDecision('reject')"
            >
              {{ t("Reject") }}
            </button>
          </div>
          <section
            v-if="decisionMode === 'approve'"
            id="proposal-approval-panel"
            class="proposal-confirmation-panel"
            aria-live="polite"
          >
            <label class="field-label">
              {{ t("Write target") }}
              <select ref="approvalTarget" v-model="target">
                <option value="local">{{ t("Local / ignored") }}</option>
                <option value="canonical">{{ t("Canonical Markdown") }}</option>
              </select>
            </label>
            <div class="proposal-confirmation-actions">
              <button class="primary-button" :disabled="pending" @click="approveSelected">
                <span v-if="pending" class="mini-loader" />
                {{ t("Approve and apply") }}
              </button>
              <button class="text-button" :disabled="pending" @click="cancelDecision">
                {{ t("Cancel") }}
              </button>
            </div>
          </section>
          <section
            v-if="decisionMode === 'reject'"
            id="proposal-rejection-panel"
            class="proposal-confirmation-panel rejection"
            aria-live="polite"
          >
            <label class="field-label">
              {{ t("Rejection reason") }}
              <textarea
                ref="rejectionInput"
                v-model="rejectReason"
                rows="3"
                :placeholder="t('Why this should not become project memory')"
              />
            </label>
            <div class="proposal-confirmation-actions">
              <button class="danger-button" :disabled="pending || !rejectReason.trim()" @click="rejectSelected">
                <span v-if="pending" class="mini-loader" />
                {{ t("Reject proposal") }}
              </button>
              <button class="text-button" :disabled="pending" @click="cancelDecision">
                {{ t("Cancel") }}
              </button>
            </div>
          </section>
          <details v-if="combinable.length" class="proposal-combine">
            <summary>{{ t("Combine another pending proposal") }}</summary>
            <div class="proposal-action-group">
              <label class="field-label">
                {{ t("Choose proposal") }}
                <select v-model="combineSource">
                  <option value="">{{ t("Choose proposal") }}</option>
                  <option v-for="item in combinable" :key="item.id" :value="item.id">
                    {{ item.rationale }}
                  </option>
                </select>
              </label>
              <button class="secondary-button" :disabled="pending || !combineSource" @click="combineSelected">
                {{ t("Combine into this proposal") }}
              </button>
            </div>
          </details>
          <small class="proposal-runtime-note">
            {{ t("Secret-like content is rejected by the runtime. Existing memory is never silently overwritten.") }}
          </small>
        </template>
        <div v-else class="closed-proposal">
          <strong>{{ t("Proposal {status}", { status: statusLabel(selected.status) }) }}</strong>
          <p>{{ selected.rejectionReason ?? selected.appliedAt ?? selected.rejectedAt }}</p>
        </div>
        <p v-if="message" class="inline-success" role="status">
          {{
            t(message.key, {
              status: message.status ? statusLabel(message.status) : "",
            })
          }}
        </p>
        <p v-if="error" class="inline-error" role="alert">{{ runtimeMessage(error) }}</p>
      </section>
      <template v-if="mode === 'review'">
        <section class="detail-block">
          <header><h3>{{ t("Proposed delta") }}</h3><span>{{ selected.items.length }}</span></header>
          <article v-for="item in selected.items" :key="item.id ?? `${item.type}:${item.title}`" class="proposal-item">
            <span class="proposal-item-meta">{{ statusLabel(item.type) }} · {{ statusLabel(item.authority) }} · {{ Math.round(item.confidence * 100) }}%</span>
            <h3>{{ item.title }}</h3>
            <p>{{ item.summary }}</p>
            <small v-if="item.supersedes?.length">{{ t("Supersedes") }} {{ item.supersedes.join(", ") }}</small>
          </article>
        </section>
        <section class="detail-block">
          <header><h3>{{ t("Evidence") }}</h3></header>
          <ul><li v-for="line in selected.evidence" :key="line">{{ line }}</li></ul>
          <p v-if="!selected.evidence.length" class="muted-copy">{{ t("No external evidence attached.") }}</p>
        </section>
        <section v-if="selected.findings.length" class="detail-block">
          <header><h3>{{ t("Findings before approval") }}</h3></header>
          <article v-for="finding in selected.findings" :key="finding.id" :class="['proposal-finding', finding.level]">
            <span>{{ statusLabel(finding.level) }}</span>
            <strong>{{ displayFinding(finding).title }}</strong>
            <p>{{ displayFinding(finding).recommendation }}</p>
            <p v-if="displayFinding(finding).question" class="proposal-finding-question">
              {{ displayFinding(finding).question }}
            </p>
            <details v-if="finding.evidence.length">
              <summary>{{ t("Show {count} evidence entries", { count: finding.evidence.length }) }}</summary>
              <ul><li v-for="line in finding.evidence" :key="line">{{ line }}</li></ul>
            </details>
          </article>
        </section>
      </template>
      <div v-else class="proposal-editor">
        <label class="field-label">{{ t("Rationale") }}<textarea v-model="rationale" rows="3" /></label>
        <label class="field-label">{{ t("Evidence · one line each") }}<textarea v-model="evidenceText" rows="4" /></label>
        <label class="field-label">{{ t("Typed items · JSON") }}<textarea v-model="itemsText" rows="16" class="code-editor" /></label>
        <button class="primary-button" :disabled="pending" @click="revise">{{ t("Validate and save revision") }}</button>
      </div>
    </section>
  </div>
</template>
