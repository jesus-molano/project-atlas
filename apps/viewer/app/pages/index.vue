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
const scope = ref<"all" | ComponentNode["visibility"]>("all");
const selectedId = ref<string>();
const showSimilar = ref(true);
const showComposition = ref(true);

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

function selectComponent(component: ComponentNode): void {
  selectedId.value = component.id;
}
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
            <p>Component Atlas</p>
            <span>{{ graph.project.name }}</span>
          </div>
        </div>
        <div class="scan-meta">
          <span class="framework-pill">{{ graph.project.framework }}</span>
          <span>{{ graph.components.length }} components</span>
          <span>scanned {{ new Date(graph.project.scannedAt).toLocaleTimeString() }}</span>
        </div>
      </header>

      <section class="workspace">
        <aside class="catalog-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">Repository inventory</span>
              <h1>Components</h1>
            </div>
            <span class="result-count">{{ filteredComponents.length }}</span>
          </div>

          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              v-model="query"
              type="search"
              placeholder="Search intent, prop or name"
            >
            <kbd>⌘K</kbd>
          </label>

          <div class="scope-tabs" role="tablist" aria-label="Component scope">
            <button
              v-for="item in [
                ['all', graph.components.length],
                ['public', counts.public],
                ['feature', counts.feature],
                ['private', counts.private],
              ]"
              :key="item[0]"
              :class="{ active: scope === item[0] }"
              @click="scope = item[0] as typeof scope"
            >
              {{ item[0] }}
              <span>{{ item[1] }}</span>
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
              <span class="api-count">{{ component.props.length }}</span>
            </button>
            <div v-if="filteredComponents.length === 0" class="empty-results">
              No component matches this search.
            </div>
          </div>
        </aside>

        <section class="map-panel">
          <div class="map-toolbar">
            <div>
              <span class="eyebrow">Relationship map</span>
              <p>Click a node to isolate its neighborhood</p>
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
            <span><i class="scope-dot public" /> public</span>
            <span><i class="scope-dot feature" /> feature</span>
            <span><i class="scope-dot private" /> private</span>
          </div>
        </section>

        <aside v-if="selected" class="detail-panel">
          <div class="detail-header">
            <span :class="['scope-badge', selected.visibility]">
              {{ selected.visibility }}
            </span>
            <h2>{{ selected.effectiveName }}</h2>
            <code>{{ selected.relativePath }}</code>
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
            <div v-if="selected.events.length" class="inline-meta">
              <span>emits</span>
              <code v-for="event in selected.events" :key="event.name">
                {{ event.name }}
              </code>
            </div>
            <div v-if="selected.slots.length" class="inline-meta">
              <span>slots</span>
              <code v-for="slot in selected.slots" :key="slot">{{ slot }}</code>
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
            <p
              v-if="details?.impact.directConsumers.length === 0"
              class="muted"
            >
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
              <p>{{ candidate.evidence.reasons.slice(0, 2).join(" · ") }}</p>
            </button>
            <p v-if="details?.similar.length === 0" class="muted">
              No strong structural match yet.
            </p>
          </section>

          <section class="detail-section source-facts">
            <span>{{ selected.testPaths.length }} tests</span>
            <span>{{ selected.renderedNames.length }} child components</span>
            <span v-if="selected.feature">feature: {{ selected.feature }}</span>
          </section>
        </aside>
      </section>
    </template>

    <div v-else class="loading-state">
      <div class="loader" />
      <p>Building the component map…</p>
    </div>
  </main>
</template>
