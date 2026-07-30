<script setup lang="ts">
import type {
  MemoryItem,
  MemoryStatus,
  MemoryType,
} from "@component-atlas/memory";
import {
  formatMemoryDate,
  formatMemoryDateTime,
  memoryEnumLabel,
  memoryText,
  type MemoryMessageKey,
} from "../utils/memory-i18n";

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
const { locale } = useAtlasI18n();
const memoryT = (
  key: MemoryMessageKey,
  variables?: Record<string, string | number>,
) => memoryText(locale.value, key, variables);
const enumLabel = (value: string | undefined) =>
  memoryEnumLabel(locale.value, value);
const types = computed(() =>
  [...new Set(props.items.map((item) => item.type))].sort(),
);
const statuses = computed(() =>
  [...new Set(props.items.map((item) => item.status))].sort(),
);
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
  () =>
    filtered.value.find((item) => item.id === selectedId.value) ??
    filtered.value[0],
);
const backlinks = computed(() =>
  selected.value
    ? props.items.filter((item) =>
        item.relations.some(
          (relation) => relation.targetId === selected.value!.id,
        ),
      )
    : [],
);
const conceptualGroups = computed(() => {
  const groups = [
    {
      id: "orientation",
      label: memoryT("domainsSystems"),
      types: new Set<MemoryType>([
        "project",
        "domain",
        "subsystem",
        "module",
        "integration",
      ]),
    },
    {
      id: "guardrails",
      label: memoryT("decisionsGuardrails"),
      types: new Set<MemoryType>([
        "decision",
        "constraint",
        "convention",
        "fragile-area",
      ]),
    },
    {
      id: "learning",
      label: memoryT("attemptsOutcomes"),
      types: new Set<MemoryType>([
        "attempt",
        "outcome",
        "known-issue",
        "debt",
      ]),
    },
    {
      id: "language",
      label: memoryT("plansLanguage"),
      types: new Set<MemoryType>(["plan", "glossary-term", "note"]),
    },
  ];
  return groups
    .map((group) => ({
      ...group,
      items: filtered.value
        .filter((item) => group.types.has(item.type))
        .slice(0, 8),
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

function resetFilters(): void {
  query.value = "";
  type.value = "all";
  status.value = "all";
}

function useSelectedInTask(): void {
  if (!selected.value) return;
  emit(
    "useInTask",
    `memory:${selected.value.id}`,
    locale.value === "es"
      ? `Usa el conocimiento revisado del proyecto «${selected.value.title}» como evidencia para esta tarea.`
      : `Use the project knowledge "${selected.value.title}" as reviewed evidence for this task.`,
  );
}
</script>

<template>
  <div v-if="!items.length" class="section-empty">
    <AtlasIcon name="memory" />
    <h2>{{ memoryT("coldStartTitle") }}</h2>
    <p>{{ memoryT("coldStartCopy") }}</p>
    <button
      class="primary-button"
      @click="
        emit(
          'prepareTask',
          locale === 'es'
            ? 'Propón una memoria inicial revisada para este repositorio.'
            : 'Propose a reviewed Project Memory bootstrap from this repository.',
        )
      "
    >
      {{ memoryT("coldStartAction") }}
    </button>
  </div>
  <div v-else class="atlas-workspace memory-layout">
    <aside class="index-pane">
      <label class="filter-input">
        <span>{{ memoryT("search") }}</span>
        <input
          v-model="query"
          type="search"
          :placeholder="memoryT('searchPlaceholder')"
        >
      </label>
      <div class="filter-row">
        <select v-model="type" :aria-label="memoryT('memoryType')">
          <option value="all">{{ memoryT("allTypes") }}</option>
          <option v-for="value in types" :key="value" :value="value">
            {{ enumLabel(value) }}
          </option>
        </select>
        <select v-model="status" :aria-label="memoryT('memoryStatus')">
          <option value="all">{{ memoryT("activeDefault") }}</option>
          <option v-for="value in statuses" :key="value" :value="value">
            {{ enumLabel(value) }}
          </option>
        </select>
      </div>
      <div
        class="mode-switch"
        role="group"
        :aria-label="memoryT('orientation')"
      >
        <button
          :class="{ active: view === 'map' }"
          :aria-pressed="view === 'map'"
          @click="view = 'map'"
        >
          {{ memoryT("conceptMap") }}
        </button>
        <button
          :class="{ active: view === 'timeline' }"
          :aria-pressed="view === 'timeline'"
          @click="view = 'timeline'"
        >
          {{ memoryT("timeline") }}
        </button>
      </div>
      <p class="visually-hidden" aria-live="polite">
        {{ memoryT("itemCount", { count: filtered.length }) }}
      </p>
      <div class="entity-list" :aria-label="memoryT('exploreTitle')">
        <button
          v-for="item in filtered"
          :key="item.id"
          :class="{ active: selected?.id === item.id }"
          :aria-pressed="selected?.id === item.id"
          @click="selectedId = item.id"
        >
          <span :class="['entity-mark', item.authority]" />
          <span>
            <strong>{{ item.title }}</strong>
            <small>
              {{ enumLabel(item.type) }} · {{ enumLabel(item.scope) }}
            </small>
          </span>
          <em>{{ enumLabel(item.status) }}</em>
        </button>
      </div>
    </aside>

    <section v-if="!filtered.length" class="detail-pane memory-filter-empty">
      <AtlasIcon name="search" />
      <h2>{{ memoryT("noResultsTitle") }}</h2>
      <p>{{ memoryT("noResultsCopy") }}</p>
      <button class="secondary-button" @click="resetFilters">
        {{ memoryT("clearFilters") }}
      </button>
    </section>

    <section v-else-if="selected" class="detail-pane">
      <header class="entity-heading">
        <div>
          <span class="eyebrow">
            {{ enumLabel(selected.type) }} / {{ enumLabel(selected.authority) }}
          </span>
          <h2>{{ selected.title }}</h2>
          <p>{{ selected.summary }}</p>
        </div>
        <div class="entity-actions">
          <span :class="['status-chip', selected.status]">
            {{ enumLabel(selected.status) }}
          </span>
          <button class="primary-button" @click="useSelectedInTask">
            {{ memoryT("useInTask") }}
          </button>
        </div>
      </header>
      <section
        v-if="view === 'map'"
        class="memory-concept-map"
        :aria-label="memoryT('knowledgeMap')"
      >
        <div
          v-for="group in conceptualGroups"
          :key="group.id"
          class="memory-lane"
        >
          <header>
            <strong>{{ group.label }}</strong>
            <span>{{ group.items.length }}</span>
          </header>
          <button
            v-for="item in group.items"
            :key="item.id"
            :class="{ active: selected.id === item.id }"
            :aria-pressed="selected.id === item.id"
            @click="selectedId = item.id"
          >
            <span :class="['entity-mark', item.authority]" />
            <span>
              <strong>{{ item.title }}</strong>
              <small>
                {{ enumLabel(item.type) }} · {{ enumLabel(item.scope) }}
              </small>
            </span>
          </button>
        </div>
      </section>
      <section
        v-else
        class="memory-timeline"
        :aria-label="memoryT('memoryTimeline')"
      >
        <button
          v-for="item in timeline"
          :key="item.id"
          :class="{ active: selected.id === item.id }"
          :aria-pressed="selected.id === item.id"
          @click="selectedId = item.id"
        >
          <time :datetime="item.updatedAt">
            {{ formatMemoryDate(locale, item.updatedAt) }}
          </time>
          <span>
            <strong>{{ item.title }}</strong>
            <small>
              {{ enumLabel(item.type) }} ·
              {{ enumLabel(item.provenance.kind) }}
            </small>
          </span>
          <em>{{ enumLabel(item.status) }}</em>
        </button>
      </section>
      <section class="detail-block">
        <header><h3>{{ memoryT("declaredKnowledge") }}</h3></header>
        <p class="memory-body">
          {{ selected.body ?? memoryT("noExtendedBody") }}
        </p>
      </section>
      <section class="detail-block">
        <header>
          <h3>{{ memoryT("relations") }}</h3>
          <span>{{ selected.relations.length }}</span>
        </header>
        <div v-if="selected.relations.length" class="relation-list">
          <button
            v-for="relation in selected.relations"
            :key="`${relation.kind}:${relation.targetId}`"
            @click="selectedId = relation.targetId"
          >
            <span>{{ enumLabel(relation.kind) }}</span>
            <strong>{{ relation.targetId }}</strong>
            <small>{{ relation.summary }}</small>
          </button>
        </div>
        <p v-else class="muted-copy">{{ memoryT("noOutgoingRelations") }}</p>
      </section>
    </section>

    <aside v-if="selected && filtered.length" class="inspector-pane">
      <section>
        <span class="eyebrow">{{ memoryT("trustFreshness") }}</span>
        <dl class="stacked-facts">
          <div>
            <dt>{{ memoryT("authority") }}</dt>
            <dd>{{ enumLabel(selected.authority) }}</dd>
          </div>
          <div>
            <dt>{{ memoryT("confidence") }}</dt>
            <dd>{{ Math.round(selected.confidence * 100) }}%</dd>
          </div>
          <div>
            <dt>{{ memoryT("updated") }}</dt>
            <dd>
              <time :datetime="selected.updatedAt">
                {{ formatMemoryDateTime(locale, selected.updatedAt) }}
              </time>
            </dd>
          </div>
          <div>
            <dt>{{ memoryT("verified") }}</dt>
            <dd>
              <time v-if="selected.verifiedAt" :datetime="selected.verifiedAt">
                {{ formatMemoryDateTime(locale, selected.verifiedAt) }}
              </time>
              <template v-else>{{ memoryT("notVerified") }}</template>
            </dd>
          </div>
          <div>
            <dt>{{ memoryT("reviewAfter") }}</dt>
            <dd>
              <time
                v-if="selected.reviewAfter"
                :datetime="selected.reviewAfter"
              >
                {{ formatMemoryDate(locale, selected.reviewAfter) }}
              </time>
              <template v-else>{{ memoryT("notScheduled") }}</template>
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <span class="eyebrow">{{ memoryT("provenance") }}</span>
        <h3>{{ enumLabel(selected.provenance.kind) }}</h3>
        <p>
          {{
            selected.bodyPath
              ?? selected.provenance.uri
              ?? memoryT("episodicStore")
          }}
        </p>
        <div class="tag-list">
          <span v-for="tag in selected.tags" :key="tag">{{ tag }}</span>
        </div>
      </section>
      <section>
        <span class="eyebrow">{{ memoryT("backlinks") }}</span>
        <button
          v-for="item in backlinks"
          :key="item.id"
          class="backlink"
          @click="selectedId = item.id"
        >
          {{ item.title }}
        </button>
        <p v-if="!backlinks.length" class="muted-copy">
          {{ memoryT("noBacklinks") }}
        </p>
      </section>
    </aside>
  </div>
</template>
