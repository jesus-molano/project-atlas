<script setup lang="ts">
import type { MemoryItemDraft, MemoryProposal } from "@component-atlas/memory";

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
const pending = ref(false);
const error = ref("");
const message = ref("");
const selected = computed(
  () => props.proposals.find((proposal) => proposal.id === selectedId.value) ?? props.proposals[0],
);
const combinable = computed(() =>
  props.proposals.filter(
    (proposal) =>
      proposal.status === "pending" && proposal.id !== selected.value?.id,
  ),
);

watch(selected, (proposal) => {
  if (!proposal) return;
  rationale.value = proposal.rationale;
  evidenceText.value = proposal.evidence.join("\n");
  itemsText.value = JSON.stringify(proposal.items, null, 2);
  mode.value = "review";
}, { immediate: true });

async function act(body: Record<string, unknown>): Promise<void> {
  pending.value = true;
  error.value = "";
  message.value = "";
  try {
    const session = await $fetch<{ token: string }>("/api/agent/session");
    const result = await $fetch<{ status?: string }>("/api/memory-proposal", {
      method: "POST",
      headers: { "x-atlas-session": session.token },
      body,
    });
    message.value = result.status ? `Proposal ${result.status}.` : "Proposal updated.";
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
    if (!Array.isArray(items)) throw new Error("Items must be a JSON array.");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
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

function approveSelected(): void {
  if (!selected.value) return;
  void act({
    action: "apply",
    proposalId: selected.value.id,
    confirmed: true,
    target: target.value,
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
</script>

<template>
  <div v-if="!proposals.length" class="section-empty">
    <AtlasIcon name="inbox" />
    <h2>No memory proposals</h2>
    <p>Agents can read automatically, but durable semantic knowledge enters this inbox before it becomes active.</p>
  </div>
  <div v-else class="atlas-workspace inbox-layout">
    <aside class="index-pane">
      <div class="index-summary">
        <span>{{ proposals.filter((item) => item.status === "pending").length }} pending</span>
        <span>{{ proposals.length }} total</span>
      </div>
      <div class="entity-list">
        <button
          v-for="proposal in proposals"
          :key="proposal.id"
          :class="{ active: selected?.id === proposal.id }"
          @click="selectedId = proposal.id"
        >
          <span :class="['entity-mark', proposal.status]" />
          <span><strong>{{ proposal.rationale }}</strong><small>{{ proposal.items.length }} items · {{ proposal.createdAt }}</small></span>
          <em>{{ proposal.status }}</em>
        </button>
      </div>
    </aside>
    <section v-if="selected" class="proposal-detail">
      <header class="workspace-toolbar">
        <div>
          <span class="eyebrow">Proposal / {{ selected.id }}</span>
          <h2>{{ selected.rationale }}</h2>
        </div>
        <div v-if="selected.status === 'pending'" class="segmented">
          <button :class="{ active: mode === 'review' }" @click="mode = 'review'">Review</button>
          <button :class="{ active: mode === 'edit' }" @click="mode = 'edit'">Edit</button>
        </div>
      </header>
      <template v-if="mode === 'review'">
        <section class="detail-block">
          <header><h3>Proposed delta</h3><span>{{ selected.items.length }}</span></header>
          <article v-for="item in selected.items" :key="item.id ?? `${item.type}:${item.title}`" class="proposal-item">
            <span>{{ item.type }} · {{ item.authority }} · {{ Math.round(item.confidence * 100) }}%</span>
            <h3>{{ item.title }}</h3><p>{{ item.summary }}</p>
            <small v-if="item.supersedes?.length">Supersedes {{ item.supersedes.join(", ") }}</small>
          </article>
        </section>
        <section class="detail-block">
          <header><h3>Evidence</h3></header>
          <ul><li v-for="line in selected.evidence" :key="line">{{ line }}</li></ul>
          <p v-if="!selected.evidence.length" class="muted-copy">No external evidence attached.</p>
        </section>
        <section v-if="selected.findings.length" class="detail-block">
          <header><h3>Findings before approval</h3></header>
          <article v-for="finding in selected.findings" :key="finding.id" :class="['proposal-finding', finding.level]">
            <strong>{{ finding.title }}</strong><p>{{ finding.recommendation }}</p>
          </article>
        </section>
      </template>
      <div v-else class="proposal-editor">
        <label class="field-label">Rationale<textarea v-model="rationale" rows="3" /></label>
        <label class="field-label">Evidence · one line each<textarea v-model="evidenceText" rows="4" /></label>
        <label class="field-label">Typed items · JSON<textarea v-model="itemsText" rows="16" class="code-editor" /></label>
        <button class="primary-button" :disabled="pending" @click="revise">Validate and save revision</button>
      </div>
      <p v-if="message" class="inline-success">{{ message }}</p>
      <p v-if="error" class="inline-error">{{ error }}</p>
    </section>
    <aside v-if="selected" class="proposal-actions">
      <span class="eyebrow">Semantic write gate</span>
      <template v-if="selected.status === 'pending'">
        <label class="field-label">Write target<select v-model="target"><option value="local">Local / ignored</option><option value="canonical">Canonical Markdown</option></select></label>
        <button class="primary-button" :disabled="pending" @click="approveSelected">
          Approve and apply
        </button>
        <hr>
        <label class="field-label">Rejection reason<textarea v-model="rejectReason" rows="3" placeholder="Why this should not become project memory" /></label>
        <button class="danger-button" :disabled="pending || !rejectReason.trim()" @click="rejectSelected">
          Reject proposal
        </button>
        <hr v-if="combinable.length">
        <template v-if="combinable.length">
          <label class="field-label">Combine another pending proposal<select v-model="combineSource"><option value="">Choose proposal</option><option v-for="item in combinable" :key="item.id" :value="item.id">{{ item.rationale }}</option></select></label>
          <button class="secondary-button" :disabled="pending || !combineSource" @click="combineSelected">Combine into this proposal</button>
        </template>
      </template>
      <div v-else class="closed-proposal">
        <strong>Proposal {{ selected.status }}</strong>
        <p>{{ selected.rejectionReason ?? selected.appliedAt ?? selected.rejectedAt }}</p>
      </div>
      <small>
        Secret-like content is rejected by the runtime. Existing memory is never silently overwritten.
      </small>
    </aside>
  </div>
</template>
