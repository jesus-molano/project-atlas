<script setup lang="ts">
import type {
  MemoryItem,
  MemoryItemDraft,
  MemoryProposal,
  MemoryProposalReview,
  MemoryWriteTarget,
} from "@component-atlas/memory";
import {
  formatMemoryDate,
  formatMemoryDateTime,
  memoryEnumLabel,
  memoryText,
  type AtlasLocale,
  type MemoryMessageKey,
} from "../utils/memory-i18n";

const props = withDefaults(
  defineProps<{
    proposals: MemoryProposal[];
    memoryItems?: MemoryItem[];
    locale?: AtlasLocale;
  }>(),
  {
    memoryItems: () => [],
    locale: "en",
  },
);
const emit = defineEmits<{ changed: [] }>();
const selectedId = ref(props.proposals[0]?.id);
const mode = ref<"review" | "edit">("review");
const rationale = ref("");
const evidenceText = ref("");
const itemsText = ref("");
const target = ref<MemoryWriteTarget>("local");
const rejectReason = ref("");
const combineSource = ref("");
const pending = ref(false);
const error = ref("");
const message = ref("");
const review = ref<MemoryProposalReview>();
const reviewPending = ref(false);
const reviewError = ref("");
const confirmationOpen = ref(false);
const canonicalAcknowledged = ref(false);
const confirmationHeading = ref<HTMLElement>();
let reviewRequest = 0;

const t = (
  key: MemoryMessageKey,
  variables?: Record<string, string | number>,
) => memoryText(props.locale, key, variables);
const enumLabel = (value: string | undefined) =>
  memoryEnumLabel(props.locale, value);
const selected = computed(
  () =>
    props.proposals.find((proposal) => proposal.id === selectedId.value) ??
    props.proposals[0],
);
const combinable = computed(() =>
  props.proposals.filter(
    (proposal) =>
      proposal.status === "pending" &&
      proposal.id !== selected.value?.id,
  ),
);
const blockingFindings = computed(
  () =>
    selected.value?.findings.filter(
      (finding) => finding.level === "decision-required",
    ) ?? [],
);
const warningFindings = computed(
  () =>
    selected.value?.findings.filter(
      (finding) => finding.level === "warning",
    ) ?? [],
);
const canReviewApproval = computed(
  () =>
    selected.value?.status === "pending" &&
    !pending.value &&
    !reviewPending.value &&
    !reviewError.value &&
    Boolean(review.value?.canApply) &&
    blockingFindings.value.length === 0,
);
const canConfirmApproval = computed(
  () =>
    canReviewApproval.value &&
    (target.value === "local" || canonicalAcknowledged.value),
);

watch(
  selected,
  (proposal) => {
    if (!proposal) return;
    rationale.value = proposal.rationale;
    evidenceText.value = proposal.evidence.join("\n");
    itemsText.value = JSON.stringify(proposal.items, null, 2);
    mode.value = "review";
    target.value = "local";
    rejectReason.value = "";
    combineSource.value = "";
    confirmationOpen.value = false;
    canonicalAcknowledged.value = false;
    error.value = "";
    message.value = "";
  },
  { immediate: true },
);

watch(
  [() => selected.value?.id, target],
  ([proposalId]) => {
    confirmationOpen.value = false;
    canonicalAcknowledged.value = false;
    if (proposalId) void loadReview(proposalId);
  },
  { immediate: true },
);

async function loadReview(proposalId: string): Promise<void> {
  const request = ++reviewRequest;
  reviewPending.value = true;
  reviewError.value = "";
  review.value = undefined;
  try {
    const result = await $fetch<MemoryProposalReview>(
      "/api/memory-proposal/review",
      {
        query: { proposalId, target: target.value },
      },
    );
    if (request === reviewRequest) review.value = result;
  } catch (caught) {
    if (request === reviewRequest) {
      reviewError.value =
        caught instanceof Error ? caught.message : String(caught);
    }
  } finally {
    if (request === reviewRequest) reviewPending.value = false;
  }
}

async function act(body: Record<string, unknown>): Promise<void> {
  pending.value = true;
  error.value = "";
  message.value = "";
  try {
    const result = await $fetch<{ status?: string }>("/api/memory-proposal", {
      method: "POST",
      body,
    });
    message.value = result.status
      ? t("proposalResult", { status: enumLabel(result.status) })
      : t("proposalUpdated");
    confirmationOpen.value = false;
    emit("changed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    pending.value = false;
  }
}

async function revise(): Promise<void> {
  if (!selected.value) return;
  let items: MemoryItemDraft[];
  try {
    items = JSON.parse(itemsText.value) as MemoryItemDraft[];
    if (!Array.isArray(items)) throw new Error(t("invalidItems"));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    return;
  }
  await act({
    action: "revise",
    proposalId: selected.value.id,
    rationale: rationale.value,
    evidence: evidenceText.value
      .split("\n")
      .map((value) => value.trim())
      .filter(Boolean),
    items,
  });
}

async function openApprovalConfirmation(): Promise<void> {
  if (!canReviewApproval.value) return;
  confirmationOpen.value = true;
  canonicalAcknowledged.value = false;
  await nextTick();
  confirmationHeading.value?.focus();
}

function approveSelected(): void {
  if (!selected.value || !canConfirmApproval.value) return;
  void act({
    action: "apply",
    proposalId: selected.value.id,
    confirmed: true,
    target: target.value,
    canonicalConfirmed:
      target.value === "canonical" && canonicalAcknowledged.value,
  });
}

function rejectSelected(): void {
  if (!selected.value) return;
  void act({
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

function currentItems(item: MemoryItemDraft): MemoryItem[] {
  const superseded = new Set(item.supersedes ?? []);
  return props.memoryItems.filter((candidate) => superseded.has(candidate.id));
}

function reviewItem(index: number) {
  return review.value?.impact.items[index];
}
</script>

<template>
  <div v-if="!proposals.length" class="section-empty">
    <AtlasIcon name="inbox" />
    <h2>{{ t("inboxEmptyTitle") }}</h2>
    <p>{{ t("inboxEmptyCopy") }}</p>
  </div>
  <div
    v-else
    class="atlas-workspace inbox-layout"
    :aria-busy="pending || reviewPending"
  >
    <aside class="index-pane inbox-index">
      <div class="index-summary">
        <span>
          {{
            t("pendingCount", {
              count: proposals.filter((item) => item.status === "pending")
                .length,
            })
          }}
        </span>
        <span>{{ t("totalCount", { count: proposals.length }) }}</span>
      </div>
      <div class="entity-list" :aria-label="t('reviewTitle')">
        <button
          v-for="proposal in proposals"
          :key="proposal.id"
          :class="{ active: selected?.id === proposal.id }"
          :aria-pressed="selected?.id === proposal.id"
          @click="selectedId = proposal.id"
        >
          <span :class="['entity-mark', proposal.status]" />
          <span>
            <strong>{{ proposal.rationale }}</strong>
            <small>
              {{ t("itemCount", { count: proposal.items.length }) }} ·
              {{ formatMemoryDateTime(locale, proposal.createdAt) }}
            </small>
          </span>
          <em>{{ enumLabel(proposal.status) }}</em>
        </button>
      </div>
    </aside>

    <section v-if="selected" class="proposal-detail">
      <header class="workspace-toolbar proposal-heading">
        <div>
          <span class="eyebrow">{{ t("proposal") }} / {{ selected.id }}</span>
          <h2>{{ selected.rationale }}</h2>
          <dl class="proposal-origin">
            <div>
              <dt>{{ t("created") }}</dt>
              <dd>
                <time :datetime="selected.createdAt">
                  {{ formatMemoryDateTime(locale, selected.createdAt) }}
                </time>
              </dd>
            </div>
            <div v-if="selected.proposedBy">
              <dt>{{ t("proposedBy") }}</dt>
              <dd>{{ selected.proposedBy }}</dd>
            </div>
          </dl>
        </div>
        <div
          v-if="selected.status === 'pending'"
          class="segmented"
          role="group"
          :aria-label="t('proposal')"
        >
          <button
            :class="{ active: mode === 'review' }"
            :aria-pressed="mode === 'review'"
            @click="mode = 'review'"
          >
            {{ t("review") }}
          </button>
          <button
            :class="{ active: mode === 'edit' }"
            :aria-pressed="mode === 'edit'"
            @click="mode = 'edit'"
          >
            {{ t("edit") }}
          </button>
        </div>
      </header>

      <template v-if="mode === 'review'">
        <section class="detail-block proposal-delta">
          <header>
            <h3>{{ t("proposedDelta") }}</h3>
            <span>{{ selected.items.length }}</span>
          </header>

          <article
            v-for="(item, index) in selected.items"
            :key="item.id ?? `${item.type}:${item.title}`"
            class="proposal-review-card"
          >
            <header class="proposal-review-heading">
              <div>
                <span class="eyebrow">
                  {{ enumLabel(item.type) }} ·
                  {{ enumLabel(item.authority) }} ·
                  {{ Math.round(item.confidence * 100) }}%
                </span>
                <h3>{{ item.title }}</h3>
                <p>{{ item.summary }}</p>
              </div>
              <span
                :class="[
                  'status-chip',
                  item.status ?? 'active',
                ]"
              >
                {{ enumLabel(item.status ?? "active") }}
              </span>
            </header>

            <section
              v-if="item.supersedes?.length"
              class="proposal-current-values"
            >
              <h4>{{ t("currentValues") }}</h4>
              <article
                v-for="current in currentItems(item)"
                :key="current.id"
                class="proposal-current-card"
              >
                <header>
                  <strong>{{ current.title }}</strong>
                  <span>
                    {{ enumLabel(current.authority) }} ·
                    {{ enumLabel(current.scope) }}
                  </span>
                </header>
                <p>{{ current.summary }}</p>
                <pre v-if="current.body" class="proposal-body">{{ current.body }}</pre>
                <code>{{ current.bodyPath ?? current.id }}</code>
              </article>
              <p
                v-if="currentItems(item).length < item.supersedes.length"
                class="muted-copy"
              >
                {{ t("currentMissing") }}
              </p>
            </section>

            <section class="proposal-next-value">
              <h4>{{ t("proposedValue") }}</h4>
              <dl class="proposal-metadata">
                <div>
                  <dt>{{ t("identifier") }}</dt>
                  <dd>{{ reviewItem(index)?.id ?? item.id ?? "—" }}</dd>
                </div>
                <div v-if="item.namespace">
                  <dt>{{ t("namespace") }}</dt>
                  <dd>{{ item.namespace }}</dd>
                </div>
                <div>
                  <dt>{{ t("scope") }}</dt>
                  <dd>
                    {{
                      enumLabel(
                        reviewItem(index)?.scope ??
                          item.scope ??
                          (target === "canonical" ? "canonical" : "local"),
                      )
                    }}
                  </dd>
                </div>
                <div>
                  <dt>{{ t("authority") }}</dt>
                  <dd>{{ enumLabel(item.authority) }}</dd>
                </div>
                <div>
                  <dt>{{ t("confidence") }}</dt>
                  <dd>{{ Math.round(item.confidence * 100) }}%</dd>
                </div>
                <div v-if="item.owner">
                  <dt>{{ t("owner") }}</dt>
                  <dd>{{ item.owner }}</dd>
                </div>
                <div v-if="item.verifiedAt">
                  <dt>{{ t("verified") }}</dt>
                  <dd>{{ formatMemoryDateTime(locale, item.verifiedAt) }}</dd>
                </div>
                <div v-if="item.reviewAfter">
                  <dt>{{ t("reviewAfter") }}</dt>
                  <dd>{{ formatMemoryDate(locale, item.reviewAfter) }}</dd>
                </div>
                <div v-if="item.expiresAt">
                  <dt>{{ t("expires") }}</dt>
                  <dd>{{ formatMemoryDate(locale, item.expiresAt) }}</dd>
                </div>
                <div>
                  <dt>{{ t("writePath") }}</dt>
                  <dd>
                    <code>{{ reviewItem(index)?.path ?? "—" }}</code>
                  </dd>
                </div>
              </dl>

              <div class="proposal-content-block">
                <strong>{{ t("body") }}</strong>
                <pre class="proposal-body">{{ item.body ?? item.summary }}</pre>
              </div>

              <div class="proposal-content-block">
                <strong>{{ t("tags") }}</strong>
                <div v-if="item.tags?.length" class="tag-list">
                  <span v-for="tag in item.tags" :key="tag">{{ tag }}</span>
                </div>
                <p v-else class="muted-copy">{{ t("noTags") }}</p>
              </div>

              <div class="proposal-content-block">
                <strong>{{ t("relations") }}</strong>
                <ul v-if="item.relations?.length" class="proposal-relation-list">
                  <li
                    v-for="relation in item.relations"
                    :key="`${relation.kind}:${relation.targetId}`"
                  >
                    <span>{{ enumLabel(relation.kind) }}</span>
                    <code>{{ relation.targetId }}</code>
                    <small v-if="relation.summary">{{ relation.summary }}</small>
                  </li>
                </ul>
                <p v-else class="muted-copy">
                  {{ t("noOutgoingRelations") }}
                </p>
              </div>

              <div class="proposal-content-block">
                <strong>{{ t("provenance") }}</strong>
                <p>
                  {{ enumLabel(item.provenance?.kind ?? "agent-proposal") }}
                  <code v-if="item.provenance?.uri">
                    {{ item.provenance.uri }}
                  </code>
                </p>
                <ul
                  v-if="item.provenance?.evidence?.length"
                  class="proposal-evidence-list"
                >
                  <li
                    v-for="line in item.provenance.evidence"
                    :key="line"
                  >
                    {{ line }}
                  </li>
                </ul>
                <p v-else class="muted-copy">
                  {{ t("noProvenanceEvidence") }}
                </p>
              </div>

              <div class="proposal-content-block">
                <strong>{{ t("supersedes") }}</strong>
                <ul v-if="item.supersedes?.length">
                  <li v-for="id in item.supersedes" :key="id">
                    <code>{{ id }}</code>
                  </li>
                </ul>
                <p v-else class="muted-copy">{{ t("supersedesNone") }}</p>
              </div>
            </section>
          </article>
        </section>

        <section class="detail-block">
          <header><h3>{{ t("evidence") }}</h3></header>
          <ul v-if="selected.evidence.length" class="proposal-evidence-list">
            <li v-for="line in selected.evidence" :key="line">{{ line }}</li>
          </ul>
          <p v-else class="muted-copy">{{ t("noEvidence") }}</p>
        </section>

        <section v-if="selected.findings.length" class="detail-block">
          <header><h3>{{ t("findings") }}</h3></header>
          <article
            v-for="finding in selected.findings"
            :key="finding.id"
            :class="['proposal-finding', finding.level]"
          >
            <span>{{ enumLabel(finding.level) }}</span>
            <strong>{{ finding.title }}</strong>
            <p>{{ finding.recommendation }}</p>
            <p v-if="finding.question">{{ finding.question }}</p>
            <ul>
              <li v-for="line in finding.evidence" :key="line">{{ line }}</li>
            </ul>
          </article>
        </section>
      </template>

      <div v-else class="proposal-editor">
        <label class="field-label">
          {{ t("rationale") }}
          <textarea v-model="rationale" rows="3" />
        </label>
        <label class="field-label">
          {{ t("evidenceLines") }}
          <textarea v-model="evidenceText" rows="4" />
        </label>
        <label class="field-label">
          {{ t("typedItems") }}
          <textarea v-model="itemsText" rows="16" class="code-editor" />
        </label>
        <button
          class="primary-button"
          :disabled="pending"
          @click="revise"
        >
          {{ t("saveRevision") }}
        </button>
      </div>

      <p v-if="message" class="inline-success" role="status" aria-live="polite">
        {{ message }}
      </p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    </section>

    <aside v-if="selected" class="proposal-actions">
      <span class="eyebrow">{{ t("semanticGate") }}</span>
      <template v-if="selected.status === 'pending'">
        <fieldset class="target-picker">
          <legend>{{ t("targetLegend") }}</legend>
          <label :class="{ active: target === 'local' }">
            <input v-model="target" type="radio" value="local">
            <span>
              <strong>{{ t("localTitle") }}</strong>
              <small>{{ t("localCopy") }}</small>
              <code>{{ t("localPath") }}</code>
            </span>
          </label>
          <label :class="{ active: target === 'canonical' }">
            <input v-model="target" type="radio" value="canonical">
            <span>
              <strong>{{ t("canonicalTitle") }}</strong>
              <small>{{ t("canonicalCopy") }}</small>
              <code>{{ t("canonicalPath") }}</code>
            </span>
          </label>
        </fieldset>

        <section
          class="proposal-impact"
          :aria-busy="reviewPending"
          aria-live="polite"
        >
          <h3>{{ t("impactSummary") }}</h3>
          <p v-if="reviewPending">{{ t("loadingImpact") }}</p>
          <p v-else-if="reviewError" class="inline-error" role="alert">
            {{ t("impactError") }} {{ reviewError }}
          </p>
          <template v-else-if="review">
            <div class="impact-counts">
              <span>
                {{ t("affectedItems", { count: review.impact.itemCount }) }}
              </span>
              <span>
                {{
                  t("affectedSupersedences", {
                    count: review.impact.supersededIds.length,
                  })
                }}
              </span>
            </div>
            <strong>{{ t("exactPaths") }}</strong>
            <ul>
              <li v-for="item in review.impact.items" :key="item.id">
                <code>{{ item.path }}</code>
              </li>
            </ul>
          </template>
        </section>

        <div
          v-if="blockingFindings.length"
          id="memory-approval-blocker"
          class="approval-blocker"
          role="alert"
        >
          <strong>{{ t("approvalBlocked") }}</strong>
          <p>{{ t("approvalBlockedCopy") }}</p>
          <ul>
            <li v-for="finding in blockingFindings" :key="finding.id">
              {{ finding.title }}
            </li>
          </ul>
        </div>
        <p v-else-if="warningFindings.length" class="approval-warning">
          {{ t("warningReview", { count: warningFindings.length }) }}
        </p>

        <button
          class="primary-button approval-trigger"
          :disabled="!canReviewApproval"
          :aria-describedby="
            blockingFindings.length ? 'memory-approval-blocker' : undefined
          "
          @click="openApprovalConfirmation"
        >
          {{ t("reviewApproval") }}
        </button>

        <section
          v-if="confirmationOpen"
          class="approval-confirmation"
          role="dialog"
          :aria-label="t('confirmTitle')"
          @keydown.esc="confirmationOpen = false"
        >
          <h3 ref="confirmationHeading" tabindex="-1">
            {{ t("confirmTitle") }}
          </h3>
          <p>
            {{
              target === "canonical"
                ? t("confirmCanonicalCopy")
                : t("confirmLocalCopy")
            }}
          </p>
          <ul v-if="review">
            <li v-for="item in review.impact.items" :key="item.id">
              <code>{{ item.path }}</code>
            </li>
          </ul>
          <label
            v-if="target === 'canonical'"
            class="canonical-acknowledgement"
          >
            <input v-model="canonicalAcknowledged" type="checkbox">
            <span>{{ t("canonicalAcknowledgement") }}</span>
          </label>
          <div class="confirmation-actions">
            <button
              class="secondary-button"
              :disabled="pending"
              @click="confirmationOpen = false"
            >
              {{ t("cancel") }}
            </button>
            <button
              class="primary-button"
              :disabled="!canConfirmApproval"
              @click="approveSelected"
            >
              {{
                target === "canonical"
                  ? t("confirmCanonical")
                  : t("confirmLocal")
              }}
            </button>
          </div>
        </section>

        <hr>
        <label class="field-label">
          {{ t("rejectionReason") }}
          <textarea
            v-model="rejectReason"
            rows="3"
            :placeholder="t('rejectionPlaceholder')"
          />
        </label>
        <button
          class="danger-button"
          :disabled="pending || !rejectReason.trim()"
          @click="rejectSelected"
        >
          {{ t("rejectProposal") }}
        </button>

        <hr v-if="combinable.length">
        <template v-if="combinable.length">
          <label class="field-label">
            {{ t("combineLabel") }}
            <select v-model="combineSource">
              <option value="">{{ t("chooseProposal") }}</option>
              <option
                v-for="item in combinable"
                :key="item.id"
                :value="item.id"
              >
                {{ item.rationale }}
              </option>
            </select>
          </label>
          <button
            class="secondary-button"
            :disabled="pending || !combineSource"
            @click="combineSelected"
          >
            {{ t("combine") }}
          </button>
        </template>
      </template>

      <div v-else class="closed-proposal">
        <strong>
          {{
            t("closedProposal", {
              status: enumLabel(selected.status),
            })
          }}
        </strong>
        <p v-if="selected.rejectionReason">{{ selected.rejectionReason }}</p>
        <time
          v-else-if="selected.appliedAt ?? selected.rejectedAt"
          :datetime="selected.appliedAt ?? selected.rejectedAt"
        >
          {{
            formatMemoryDateTime(
              locale,
              selected.appliedAt ?? selected.rejectedAt,
            )
          }}
        </time>
      </div>

      <small>{{ t("safetyCopy") }}</small>
    </aside>
  </div>
</template>
