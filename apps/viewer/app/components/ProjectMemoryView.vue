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
const { formatDate, statusLabel, t } = useAtlasI18n();

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
      label: t("Domains & systems"),
      types: new Set<MemoryType>(["project", "domain", "subsystem", "module", "integration"]),
    },
    {
      id: "guardrails",
      label: t("Decisions & guardrails"),
      types: new Set<MemoryType>(["decision", "constraint", "convention", "fragile-area"]),
    },
    {
      id: "learning",
      label: t("Attempts & outcomes"),
      types: new Set<MemoryType>(["attempt", "outcome", "known-issue", "debt"]),
    },
    {
      id: "language",
      label: t("Plans & project language"),
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
    t('Use the project knowledge "{title}" as reviewed evidence for this task.', {
      title: selected.value.title,
    }),
  );
}
</script>

<template>
  <div v-if="!items.length" class="section-empty">
    <AtlasIcon name="memory" />
    <h2>{{ t("Project Memory is at cold start") }}</h2>
    <p>
      {{ t("Code Atlas remains usable. Add canonical Markdown when the project has a durable decision, convention, or domain concept worth recalling.") }}
    </p>
    <button
      class="primary-button"
      @click="emit('prepareTask', t('Propose a reviewed Project Memory bootstrap from this repository.'))"
    >
      {{ t("Propose a memory bootstrap") }}
    </button>
  </div>
  <div v-else class="atlas-workspace memory-layout">
    <aside class="index-pane">
      <label class="filter-input">
        <span>{{ t("Search") }}</span>
        <input v-model="query" type="search" :placeholder="t('Decision, convention, failure…')" >
      </label>
      <div class="filter-row">
        <select v-model="type" :aria-label="t('Memory type')">
          <option value="all">{{ t("All types") }}</option>
          <option v-for="value in types" :key="value" :value="value">{{ statusLabel(value) }}</option>
        </select>
        <select v-model="status" :aria-label="t('Memory status')">
          <option value="all">{{ t("Active by default") }}</option>
          <option v-for="value in statuses" :key="value" :value="value">{{ statusLabel(value) }}</option>
        </select>
      </div>
      <div class="mode-switch" :aria-label="t('Memory orientation')">
        <button :class="{ active: view === 'map' }" @click="view = 'map'">
          {{ t("Concept map") }}
        </button>
        <button :class="{ active: view === 'timeline' }" @click="view = 'timeline'">
          {{ t("Timeline") }}
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
            <small>{{ statusLabel(item.type) }} · {{ statusLabel(item.scope) }}</small>
          </span>
          <em>{{ statusLabel(item.status) }}</em>
        </button>
      </div>
    </aside>
    <section v-if="selected" class="detail-pane">
      <header class="entity-heading">
        <div>
          <span class="eyebrow">{{ statusLabel(selected.type) }} / {{ statusLabel(selected.authority) }}</span>
          <h2>{{ selected.title }}</h2>
          <p>{{ selected.summary }}</p>
        </div>
        <div class="entity-actions">
          <span :class="['status-chip', selected.status]">{{ statusLabel(selected.status) }}</span>
          <button class="primary-button" @click="useSelectedInTask">
            {{ t("Use in task") }}
          </button>
        </div>
      </header>
      <section v-if="view === 'map'" class="memory-concept-map" :aria-label="t('Project knowledge map')">
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
              <small>{{ statusLabel(item.type) }} · {{ statusLabel(item.scope) }}</small>
            </span>
          </button>
        </div>
      </section>
      <section v-else class="memory-timeline" :aria-label="t('Project memory timeline')">
        <button
          v-for="item in timeline"
          :key="item.id"
          :class="{ active: selected.id === item.id }"
          @click="selectedId = item.id"
        >
          <time :datetime="item.updatedAt">{{ formatDate(item.updatedAt) }}</time>
          <span>
            <strong>{{ item.title }}</strong>
            <small>{{ statusLabel(item.type) }} · {{ statusLabel(item.provenance.kind) }}</small>
          </span>
          <em>{{ statusLabel(item.status) }}</em>
        </button>
      </section>
      <section class="detail-block">
        <header><h3>{{ t("Declared knowledge") }}</h3></header>
        <p class="memory-body">{{ selected.body ?? t("No extended body. The compact summary is canonical.") }}</p>
      </section>
      <section class="detail-block">
        <header><h3>{{ t("Relations") }}</h3><span>{{ selected.relations.length }}</span></header>
        <div v-if="selected.relations.length" class="relation-list">
          <button
            v-for="relation in selected.relations"
            :key="`${relation.kind}:${relation.targetId}`"
            @click="selectedId = relation.targetId"
          >
            <span>{{ statusLabel(relation.kind) }}</span>
            <strong>{{ relation.targetId }}</strong>
            <small>{{ relation.summary }}</small>
          </button>
        </div>
        <p v-else class="muted-copy">{{ t("No outgoing relations.") }}</p>
      </section>
    </section>
    <aside v-if="selected" class="inspector-pane">
      <section>
        <span class="eyebrow">{{ t("Trust & freshness") }}</span>
        <dl class="stacked-facts">
          <div><dt>{{ t("Authority") }}</dt><dd>{{ statusLabel(selected.authority) }}</dd></div>
          <div><dt>{{ t("Confidence") }}</dt><dd>{{ Math.round(selected.confidence * 100) }}%</dd></div>
          <div><dt>{{ t("Updated") }}</dt><dd>{{ formatDate(selected.updatedAt) }}</dd></div>
          <div><dt>{{ t("Verified") }}</dt><dd>{{ selected.verifiedAt ? formatDate(selected.verifiedAt) : t("Not verified") }}</dd></div>
          <div><dt>{{ t("Review after") }}</dt><dd>{{ selected.reviewAfter ? formatDate(selected.reviewAfter) : t("Not scheduled") }}</dd></div>
        </dl>
      </section>
      <section>
        <span class="eyebrow">{{ t("Provenance") }}</span>
        <h3>{{ statusLabel(selected.provenance.kind) }}</h3>
        <p>{{ selected.bodyPath ?? selected.provenance.uri ?? t("Atlas episodic store") }}</p>
        <div class="tag-list"><span v-for="tag in selected.tags" :key="tag">{{ tag }}</span></div>
      </section>
      <section>
        <span class="eyebrow">{{ t("Backlinks") }}</span>
        <button
          v-for="item in backlinks"
          :key="item.id"
          class="backlink"
          @click="selectedId = item.id"
        >
          {{ item.title }}
        </button>
        <p v-if="!backlinks.length" class="muted-copy">{{ t("No indexed backlinks.") }}</p>
      </section>
    </aside>
  </div>
</template>
