<script setup lang="ts">
import {
  componentImpact,
  searchComponents,
  similarComponents,
  type ComponentGraph,
  type ComponentNode,
} from "@component-atlas/core/browser";

const props = defineProps<{
  graph: ComponentGraph;
  initialComponentId?: string;
}>();

const query = ref("");
const scope = ref<"all" | ComponentNode["visibility"]>("all");
const selectedId = ref<string>();
const showSimilar = ref(true);
const showComposition = ref(true);

const scopeOptions = [
  { value: "all", label: "All", description: "Every indexed code node" },
  { value: "public", label: "Shared", description: "Reusable across features" },
  { value: "feature", label: "Feature", description: "Owned by one product area" },
  { value: "private", label: "Internal", description: "Local implementation detail" },
] as const;

const filteredComponents = computed(() => {
  const term = query.value.trim().toLowerCase();
  const matches = term
    ? [
        ...searchComponents(
        props.graph,
        query.value,
        props.graph.components.length,
        ).map((result) => result.component),
        ...props.graph.components.filter(
          (component) =>
            (component.kind === "route" || component.kind === "layout") &&
            [
              component.name,
              component.effectiveName,
              component.relativePath,
              ...component.imports,
              ...component.renderedNames,
            ]
              .join(" ")
              .toLowerCase()
              .includes(term),
        ),
      ].filter(
        (component, index, collection) =>
          collection.findIndex((item) => item.id === component.id) === index,
      )
    : props.graph.components;
  return matches.filter(
    (component) => scope.value === "all" || component.visibility === scope.value,
  );
});

const filteredIds = computed(
  () => new Set(filteredComponents.value.map((component) => component.id)),
);

const filteredEdges = computed(() =>
  props.graph.edges.filter(
    (edge) =>
      filteredIds.value.has(edge.source) &&
      filteredIds.value.has(edge.target) &&
      ((edge.kind === "similar_to" && showSimilar.value) ||
        (edge.kind === "renders" && showComposition.value)),
  ),
);

const selected = computed(
  () =>
    filteredComponents.value.find(
      (component) => component.id === selectedId.value,
    ) ?? filteredComponents.value[0],
);

watch(
  () => props.initialComponentId,
  (componentId) => {
    if (
      componentId &&
      props.graph.components.some((component) => component.id === componentId)
    ) {
      selectedId.value = componentId;
    }
  },
  { immediate: true },
);

watch(
  selected,
  (component) => {
    if (component && component.id !== selectedId.value) {
      selectedId.value = component.id;
    }
  },
  { immediate: true },
);

const details = computed(() => {
  if (!selected.value) return undefined;
  return {
    similar: similarComponents(props.graph, selected.value.id).slice(0, 6),
    impact: componentImpact(props.graph, selected.value.id),
  };
});

const counts = computed(() => ({
  public: props.graph.components.filter(
    (component) => component.visibility === "public",
  ).length,
  feature: props.graph.components.filter(
    (component) => component.visibility === "feature",
  ).length,
  private: props.graph.components.filter(
    (component) => component.visibility === "private",
  ).length,
}));

const impactSignal = computed(() => {
  const consumers = details.value?.impact.transitiveConsumers.length ?? 0;
  if (consumers >= 8) {
    return { label: "High blast radius", tone: "high", consumers };
  }
  if (consumers >= 3) {
    return { label: "Moderate impact", tone: "medium", consumers };
  }
  return { label: "Contained impact", tone: "low", consumers };
});

function scopeLabel(visibility: ComponentNode["visibility"]): string {
  return (
    scopeOptions.find((item) => item.value === visibility)?.label ?? visibility
  );
}

function scopeCount(value: (typeof scopeOptions)[number]["value"]): number {
  if (value === "all") return props.graph.components.length;
  return counts.value[value];
}

function selectComponent(component: ComponentNode): void {
  selectedId.value = component.id;
}
</script>

<template>
  <section class="code-atlas">
    <aside class="catalog-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Repository graph</span>
          <h2>Code index</h2>
        </div>
        <span class="result-count">{{ filteredComponents.length }}</span>
      </div>

      <label class="local-search">
        <span aria-hidden="true">⌕</span>
        <input
          v-model="query"
          type="search"
          aria-label="Filter Code Atlas nodes"
          placeholder="Name, path, prop, or intent"
        >
      </label>

      <div class="scope-tabs" role="tablist" aria-label="Component scope">
        <button
          v-for="item in scopeOptions"
          :key="item.value"
          :class="{ active: scope === item.value }"
          :title="item.description"
          role="tab"
          :aria-selected="scope === item.value"
          @click="scope = item.value"
        >
          {{ item.label }}
          <span>{{ scopeCount(item.value) }}</span>
        </button>
      </div>

      <div class="component-list">
        <button
          v-for="component in filteredComponents"
          :key="component.id"
          class="component-row"
          :class="{ selected: selected?.id === component.id }"
          @click="selectComponent(component)"
        >
          <span :class="['scope-dot', component.visibility]" />
          <span class="component-copy">
            <strong>{{ component.effectiveName }}</strong>
            <small>{{ component.relativePath }}</small>
          </span>
          <span class="api-count">
            {{ component.kind === "route" ? "route" : component.kind === "layout" ? "layout" : `${component.props.length}p` }}
          </span>
        </button>
        <div v-if="filteredComponents.length === 0" class="empty-results">
          No code node matches this evidence.
        </div>
      </div>
    </aside>

    <section class="map-panel">
      <div class="map-toolbar">
        <div>
          <span class="eyebrow">Dependency field</span>
          <p>Composition, similarity, and change surface</p>
        </div>
        <div class="edge-toggles">
          <label>
            <input v-model="showComposition" type="checkbox">
            <i class="line solid" />
            composition
          </label>
          <label>
            <input v-model="showSimilar" type="checkbox">
            <i class="line dashed" />
            similarity
          </label>
        </div>
      </div>
      <AtlasGraph
        :components="filteredComponents"
        :edges="filteredEdges"
        :selected-id="selected?.id"
        @select="selectedId = $event"
      />
      <div class="map-legend">
        <span><i class="scope-dot public" /> shared</span>
        <span><i class="scope-dot feature" /> feature</span>
        <span><i class="scope-dot private" /> internal</span>
        <span class="degree-legend">node size = relations</span>
      </div>
    </section>

    <aside v-if="selected" class="detail-panel">
      <div class="detail-header">
        <div class="detail-kicker">
          <span :class="['scope-badge', selected.visibility]">
            {{ scopeLabel(selected.visibility) }}
          </span>
          <span>{{ selected.kind ?? "component" }}</span>
          <span>{{ selected.props.length }} props</span>
        </div>
        <h2>{{ selected.effectiveName }}</h2>
        <code>{{ selected.relativePath }}</code>
        <div class="evidence-strip">
          <span :class="['impact-signal', impactSignal.tone]">
            {{ impactSignal.label }} · {{ impactSignal.consumers }}
          </span>
        </div>
      </div>

      <section class="detail-section">
        <div class="section-title">
          <h3>Public API</h3>
          <span>{{ selected.props.length }} props</span>
        </div>
        <div v-if="selected.props.length" class="property-list">
          <div v-for="prop in selected.props" :key="prop.name" class="property">
            <div>
              <strong>{{ prop.name }}</strong>
              <em v-if="prop.required">required</em>
            </div>
            <code>{{ prop.type }}</code>
          </div>
        </div>
        <p v-else class="muted">No statically declared props.</p>
        <div class="inline-meta">
          <span>{{ selected.events.length }} events</span>
          <span>{{ selected.slots.length }} slots</span>
          <span>{{ selected.models.length }} models</span>
        </div>
      </section>

      <section class="detail-section">
        <div class="section-title">
          <h3>Change impact</h3>
          <span>{{ details?.impact.transitiveConsumers.length ?? 0 }} consumers</span>
        </div>
        <button
          v-for="consumer in details?.impact.directConsumers"
          :key="consumer.id"
          class="relation-row"
          @click="selectComponent(consumer)"
        >
          <span>↳</span>
          <strong>{{ consumer.effectiveName }}</strong>
          <small>direct</small>
        </button>
        <p v-if="details?.impact.directConsumers.length === 0" class="muted">
          No indexed code node consumes it.
        </p>
      </section>

      <section v-if="(selected.kind ?? 'component') === 'component'" class="detail-section">
        <div class="section-title">
          <h3>Reuse candidates</h3>
          <span>explainable</span>
        </div>
        <button
          v-for="candidate in details?.similar"
          :key="candidate.component.id"
          class="similar-card"
          @click="selectComponent(candidate.component)"
        >
          <div>
            <strong>{{ candidate.component.effectiveName }}</strong>
            <span>{{ Math.round(candidate.evidence.score * 100) }}%</span>
          </div>
          <i class="similar-meter">
            <span
              :style="{ width: `${Math.round(candidate.evidence.score * 100)}%` }"
            />
          </i>
          <p>{{ candidate.evidence.reasons.slice(0, 2).join(" · ") }}</p>
        </button>
        <p v-if="details?.similar.length === 0" class="muted">
          No strong structural match yet.
        </p>
      </section>
    </aside>
  </section>
</template>
