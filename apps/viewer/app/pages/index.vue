<script setup lang="ts">
import {
  componentImpact,
  searchComponents,
  similarComponents,
  type ComponentGraph,
  type ComponentNode,
} from "@component-atlas/core/browser";

const { data: graph, error, refresh } = await useFetch<ComponentGraph>("/api/graph");

const query = ref("");
const scope = ref<"all" | ComponentNode["visibility"]>("public");
const selectedId = ref<string>();
const showSimilar = ref(true);
const showComposition = ref(true);
const searchInput = ref<HTMLInputElement>();

const scopeOptions = [
  {
    value: "all",
    label: "All",
    description: "Every indexed component",
  },
  {
    value: "public",
    label: "Shared",
    description: "Reusable UI from ui, shared, or common folders",
  },
  {
    value: "feature",
    label: "Feature",
    description: "Owned by a product area such as anime, auth, or layout",
  },
  {
    value: "private",
    label: "Internal",
    description: "File-local or explicitly internal implementation detail",
  },
] as const;

const filteredComponents = computed(() => {
  if (!graph.value) return [];
  const matches = query.value.trim()
    ? searchComponents(graph.value, query.value, graph.value.components.length).map(
        (result) => result.component,
      )
    : graph.value.components;
  return matches.filter(
    (component) => scope.value === "all" || component.visibility === scope.value,
  );
});

const filteredIds = computed(
  () => new Set(filteredComponents.value.map((component) => component.id)),
);

const filteredEdges = computed(() => {
  if (!graph.value) return [];
  return graph.value.edges.filter(
    (edge) =>
      filteredIds.value.has(edge.source) &&
      filteredIds.value.has(edge.target) &&
      ((edge.kind === "similar_to" && showSimilar.value) ||
        (edge.kind === "renders" && showComposition.value)),
  );
});

const selected = computed(
  () =>
    filteredComponents.value.find(
      (component) => component.id === selectedId.value,
    ) ?? filteredComponents.value[0],
);

watch(
  selected,
  (component) => {
    if (component && component.id !== selectedId.value) selectedId.value = component.id;
  },
  { immediate: true },
);

const details = computed(() => {
  if (!graph.value || !selected.value) return undefined;
  return {
    similar: similarComponents(graph.value, selected.value.id).slice(0, 6),
    impact: componentImpact(graph.value, selected.value.id),
  };
});

const counts = computed(() => {
  const components = graph.value?.components ?? [];
  return {
    public: components.filter((item) => item.visibility === "public").length,
    feature: components.filter((item) => item.visibility === "feature").length,
    private: components.filter((item) => item.visibility === "private").length,
  };
});

const impactSignal = computed(() => {
  const consumers = details.value?.impact.transitiveConsumers.length ?? 0;
  if (consumers >= 8) return { label: "High blast radius", tone: "high", consumers };
  if (consumers >= 3) return { label: "Moderate impact", tone: "medium", consumers };
  return { label: "Contained impact", tone: "low", consumers };
});

const reuseSignal = computed(() => {
  if (selected.value?.visibility === "public") return "Shared primitive";
  if (selected.value?.visibility === "feature") return "Feature-owned";
  return "Internal detail";
});

function scopeLabel(visibility: ComponentNode["visibility"]): string {
  return scopeOptions.find((item) => item.value === visibility)?.label ?? visibility;
}

function scopeCount(value: (typeof scopeOptions)[number]["value"]): number {
  if (value === "all") return graph.value?.components.length ?? 0;
  return counts.value[value];
}

function selectComponent(component: ComponentNode): void {
  selectedId.value = component.id;
}

function focusSearch(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
  }
}

function moveSelection(direction: 1 | -1): void {
  if (filteredComponents.value.length === 0) return;
  const currentIndex = filteredComponents.value.findIndex(
    (component) => component.id === selected.value?.id,
  );
  const nextIndex =
    currentIndex < 0
      ? 0
      : Math.min(
          filteredComponents.value.length - 1,
          Math.max(0, currentIndex + direction),
        );
  selectedId.value = filteredComponents.value[nextIndex]?.id;
}

onMounted(() => window.addEventListener("keydown", focusSearch));
onBeforeUnmount(() => window.removeEventListener("keydown", focusSearch));
</script>

<template>
  <main class="app-shell">
    <div v-if="error" class="fatal-state">
      <span class="eyebrow">Index unavailable</span>
      <h1>Component Atlas could not load this repository.</h1>
      <p>{{ error.message }}</p>
      <button class="primary-button" @click="refresh()">Try again</button>
    </div>

    <template v-else-if="graph">
      <header class="topbar">
        <div class="brand">
          <div class="mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p>Atlas</p>
            <span>{{ graph.project.name }} · component context engine</span>
          </div>
        </div>

        <div class="surface-label">
          <i class="map-glyph" />
          Relationship map
        </div>

        <div class="scan-meta">
          <span class="framework-pill">{{ graph.project.framework }}</span>
          <span>{{ graph.components.length }} components</span>
          <span>{{ graph.edges.length }} relations</span>
        </div>
      </header>

      <section class="workspace">
        <aside class="catalog-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">Repository graph</span>
              <h1>Component index</h1>
            </div>
            <span class="result-count">{{ filteredComponents.length }}</span>
          </div>

          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              ref="searchInput"
              v-model="query"
              type="search"
              aria-label="Search components"
              placeholder="Find by name, prop, or intent"
              @keydown.down.prevent="moveSelection(1)"
              @keydown.up.prevent="moveSelection(-1)"
            >
            <kbd>Ctrl K</kbd>
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

          <details class="scope-guide">
            <summary>Start here before creating</summary>
            <p>
              <strong>Shared</strong> is reusable.
              <strong>Feature</strong> has product ownership.
              <strong>Internal</strong> should not cross boundaries.
            </p>
          </details>

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
                {{ component.props.length }} {{ component.props.length === 1 ? "prop" : "props" }}
              </span>
            </button>
            <div v-if="filteredComponents.length === 0" class="empty-results">
              No indexed component matches this search.
            </div>
          </div>
        </aside>

        <section class="map-panel">
          <div class="map-toolbar">
            <div>
              <span class="eyebrow">Dependency graph</span>
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
            <span class="degree-legend">node size = connections</span>
          </div>
        </section>

        <aside v-if="selected" class="detail-panel">
          <div class="detail-header">
            <div class="detail-kicker">
              <span :class="['scope-badge', selected.visibility]">
                {{ scopeLabel(selected.visibility) }}
              </span>
              <span>{{ selected.props.length }} props</span>
            </div>
            <h2>{{ selected.effectiveName }}</h2>
            <code>{{ selected.relativePath }}</code>
            <div class="evidence-strip">
              <span>
                <i :class="['scope-dot', selected.visibility]" />
                {{ reuseSignal }}
              </span>
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
              No indexed component consumes it.
            </p>
          </section>

          <section class="detail-section">
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

          <section class="detail-section source-facts">
            <span>{{ selected.testPaths.length }} tests</span>
            <span>{{ selected.renderedNames.length }} children</span>
            <span v-if="selected.feature">owner: {{ selected.feature }}</span>
          </section>
        </aside>
      </section>
    </template>

    <div v-else class="loading-state">
      <div class="loader" />
      <p>Indexing the component graph…</p>
    </div>
  </main>
</template>
