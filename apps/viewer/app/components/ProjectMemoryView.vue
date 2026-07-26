<script setup lang="ts">
import type { MemoryItem, MemoryStatus, MemoryType } from "@component-atlas/memory";

const props = defineProps<{
  items: MemoryItem[];
  initialItemId?: string;
  includeInactive?: boolean;
}>();
const emit = defineEmits<{
  useInTask: [handle: string, intent: string];
  prepareTask: [intent: string];
}>();

const query = ref("");
const type = ref<MemoryType | "all">("all");
const status = ref<MemoryStatus | "all">("all");
const view = ref<"map" | "timeline">("map");
const selectedId = ref(props.initialItemId);
const types = computed(() => [...new Set(props.items.map((item) => item.type))].sort());
const statuses = computed(() => [...new Set(props.items.map((item) => item.status))].sort());
const filtered = computed(() => {
  const term = query.value.trim().toLowerCase();
  return props.items.filter(
    (item) =>
      (props.includeInactive ||
        status.value !== "all" ||
        item.status === "active") &&
      (type.value === "all" || item.type === type.value) &&
      (status.value === "all" || item.status === status.value) &&
      (!term ||
        [item.title, item.summary, item.body, ...item.tags]
          .join(" ")
          .toLowerCase()
          .includes(term)),
  );
});
const selected = computed(
  () => filtered.value.find((item) => item.id === selectedId.value) ?? filtered.value[0],
);
const backlinks = computed(() =>
  selected.value
    ? props.items.filter((item) =>
        item.relations.some((relation) => relation.targetId === selected.value!.id),
      )
    : [],
);
const conceptualGroups = computed(() => {
  const groups = [
    {
      id: "orientation",
      label: "Domains & systems",
      types: new Set<MemoryType>(["project", "domain", "subsystem", "module", "integration"]),
    },
    {
      id: "guardrails",
      label: "Decisions & guardrails",
      types: new Set<MemoryType>(["decision", "constraint", "convention", "fragile-area"]),
    },
    {
      id: "learning",
      label: "Attempts & outcomes",
      types: new Set<MemoryType>(["attempt", "outcome", "known-issue", "debt"]),
    },
    {
      id: "language",
      label: "Plans & project language",
      types: new Set<MemoryType>(["plan", "glossary-term", "note"]),
    },
  ];
  return groups
    .map((group) => ({
      ...group,
      items: filtered.value.filter((item) => group.types.has(item.type)).slice(0, 8),
    }))
    .filter((group) => group.items.length > 0);
});
const timeline = computed(() =>
  [...filtered.value]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 30),
);

watch(
  () => props.initialItemId,
  (value) => {
    if (value) selectedId.value = value;
  },
);

function useSelectedInTask(): void {
  if (!selected.value) return;
  emit(
    "useInTask",
    `memory:${selected.value.id}`,
    `Use the project knowledge "${selected.value.title}" as reviewed evidence for this task.`,
  );
}
</script>

<template>
  <div v-if="!items.length" class="section-empty">
    <AtlasIcon name="memory" />
    <h2>Project Memory is at cold start</h2>
    <p>
      Code Atlas remains usable. Add canonical Markdown when the project has a
      durable decision, convention, or domain concept worth recalling.
    </p>
    <button
      class="primary-button"
      @click="emit('prepareTask', 'Propose a reviewed Project Memory bootstrap from this repository.')"
    >
      Propose a memory bootstrap
    </button>
  </div>
  <div v-else class="atlas-workspace memory-layout">
    <aside class="index-pane">
      <label class="filter-input">
        <span>Search</span>
        <input v-model="query" type="search" placeholder="Decision, convention, failure…" >
      </label>
      <div class="filter-row">
        <select v-model="type" aria-label="Memory type">
          <option value="all">All types</option>
          <option v-for="value in types" :key="value" :value="value">{{ value }}</option>
        </select>
        <select v-model="status" aria-label="Memory status">
          <option value="all">All states</option>
          <option v-for="value in statuses" :key="value" :value="value">{{ value }}</option>
        </select>
      </div>
      <div class="mode-switch" aria-label="Memory orientation">
        <button :class="{ active: view === 'map' }" @click="view = 'map'">
          Concept map
        </button>
        <button :class="{ active: view === 'timeline' }" @click="view = 'timeline'">
          Timeline
        </button>
      </div>
      <div class="entity-list">
        <button
          v-for="item in filtered"
          :key="item.id"
          :class="{ active: selected?.id === item.id }"
          @click="selectedId = item.id"
        >
          <span :class="['entity-mark', item.authority]" />
          <span>
            <strong>{{ item.title }}</strong>
            <small>{{ item.type }} · {{ item.scope }}</small>
          </span>
          <em>{{ item.status }}</em>
        </button>
      </div>
    </aside>
    <section v-if="selected" class="detail-pane">
      <header class="entity-heading">
        <div>
          <span class="eyebrow">{{ selected.type }} / {{ selected.authority }}</span>
          <h2>{{ selected.title }}</h2>
          <p>{{ selected.summary }}</p>
        </div>
        <div class="entity-actions">
          <span :class="['status-chip', selected.status]">{{ selected.status }}</span>
          <button class="primary-button" @click="useSelectedInTask">
            Use in task
          </button>
        </div>
      </header>
      <section v-if="view === 'map'" class="memory-concept-map" aria-label="Project knowledge map">
        <div v-for="group in conceptualGroups" :key="group.id" class="memory-lane">
          <header>
            <strong>{{ group.label }}</strong>
            <span>{{ group.items.length }}</span>
          </header>
          <button
            v-for="item in group.items"
            :key="item.id"
            :class="{ active: selected.id === item.id }"
            @click="selectedId = item.id"
          >
            <span :class="['entity-mark', item.authority]" />
            <span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.type }} · {{ item.scope }}</small>
            </span>
          </button>
        </div>
      </section>
      <section v-else class="memory-timeline" aria-label="Project memory timeline">
        <button
          v-for="item in timeline"
          :key="item.id"
          :class="{ active: selected.id === item.id }"
          @click="selectedId = item.id"
        >
          <time :datetime="item.updatedAt">{{ new Date(item.updatedAt).toLocaleDateString() }}</time>
          <span>
            <strong>{{ item.title }}</strong>
            <small>{{ item.type }} · {{ item.provenance.kind }}</small>
          </span>
          <em>{{ item.status }}</em>
        </button>
      </section>
      <section class="detail-block">
        <header><h3>Declared knowledge</h3></header>
        <p class="memory-body">{{ selected.body ?? "No extended body. The compact summary is canonical." }}</p>
      </section>
      <section class="detail-block">
        <header><h3>Relations</h3><span>{{ selected.relations.length }}</span></header>
        <div v-if="selected.relations.length" class="relation-list">
          <button
            v-for="relation in selected.relations"
            :key="`${relation.kind}:${relation.targetId}`"
            @click="selectedId = relation.targetId"
          >
            <span>{{ relation.kind }}</span>
            <strong>{{ relation.targetId }}</strong>
            <small>{{ relation.summary }}</small>
          </button>
        </div>
        <p v-else class="muted-copy">No outgoing relations.</p>
      </section>
    </section>
    <aside v-if="selected" class="inspector-pane">
      <section>
        <span class="eyebrow">Trust & freshness</span>
        <dl class="stacked-facts">
          <div><dt>Authority</dt><dd>{{ selected.authority }}</dd></div>
          <div><dt>Confidence</dt><dd>{{ Math.round(selected.confidence * 100) }}%</dd></div>
          <div><dt>Updated</dt><dd>{{ selected.updatedAt }}</dd></div>
          <div><dt>Verified</dt><dd>{{ selected.verifiedAt ?? "Not verified" }}</dd></div>
          <div><dt>Review after</dt><dd>{{ selected.reviewAfter ?? "Not scheduled" }}</dd></div>
        </dl>
      </section>
      <section>
        <span class="eyebrow">Provenance</span>
        <h3>{{ selected.provenance.kind }}</h3>
        <p>{{ selected.bodyPath ?? selected.provenance.uri ?? "Atlas episodic store" }}</p>
        <div class="tag-list"><span v-for="tag in selected.tags" :key="tag">{{ tag }}</span></div>
      </section>
      <section>
        <span class="eyebrow">Backlinks</span>
        <button
          v-for="item in backlinks"
          :key="item.id"
          class="backlink"
          @click="selectedId = item.id"
        >
          {{ item.title }}
        </button>
        <p v-if="!backlinks.length" class="muted-copy">No indexed backlinks.</p>
      </section>
    </aside>
  </div>
</template>
