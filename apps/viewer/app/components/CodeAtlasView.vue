<script setup lang="ts">
import {
  componentImpact,
  searchComponents,
  similarComponents,
  type ComponentGraph,
  type ComponentNode,
} from "@component-atlas/core/browser";
import {
  activateCodeInspectorGoal,
  CODE_ATLAS_PAGE_SIZE,
  codeAtlasPageCount,
  codeAtlasPageForIndex,
  codeAtlasPageSlice,
  type CodeInspectorGoal,
} from "~/utils/code-atlas";

const props = defineProps<{
  graph: ComponentGraph;
  initialComponentId?: string;
}>();
const emit = defineEmits<{
  useInTask: [handle: string, intent: string];
}>();

const query = ref("");
const scope = ref<"all" | ComponentNode["visibility"]>("all");
const selectedId = ref<string>();
const showSimilar = ref(true);
const showComposition = ref(true);
const goal = ref<CodeInspectorGoal>("reuse");
const page = ref(0);
const componentList = ref<HTMLElement>();
const inspectorTrigger = ref<HTMLButtonElement>();
const inspectorClose = ref<HTMLButtonElement>();
const inspectorPanel = ref<HTMLElement>();
const graphView = ref<{
  fitGraph: () => void;
  fitSelection: () => void;
  resetView: () => void;
  resize: () => void;
}>();
const inspectorOpen = ref(true);
const inspectorIsDrawer = ref(false);
let inspectorMedia: MediaQueryList | undefined;
let inspectorReturnFocus: HTMLElement | undefined;

const scopeOptions = [
  { value: "all", label: "All", description: "Every indexed code node" },
  { value: "public", label: "Shared", description: "Reusable across features" },
  { value: "feature", label: "Feature", description: "Owned by one product area" },
  { value: "private", label: "Internal", description: "Local implementation detail" },
] as const;
const goalOptions: Array<{
  value: CodeInspectorGoal;
  label: string;
  help: string;
}> = [
  {
    value: "reuse",
    label: "Reuse",
    help: "Compare the selected component with explainable structural matches.",
  },
  {
    value: "impact",
    label: "Change impact",
    help: "Trace direct and transitive consumers that could be affected.",
  },
  {
    value: "tests",
    label: "Associated tests",
    help: "Review test files linked by indexed imports or mounts.",
  },
];

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
const totalPages = computed(() =>
  codeAtlasPageCount(filteredComponents.value.length),
);
const visibleComponents = computed(() =>
  codeAtlasPageSlice(filteredComponents.value, page.value),
);
const visibleRange = computed(() => {
  if (filteredComponents.value.length === 0) return "0";
  const start = page.value * CODE_ATLAS_PAGE_SIZE + 1;
  const end = Math.min(
    filteredComponents.value.length,
    (page.value + 1) * CODE_ATLAS_PAGE_SIZE,
  );
  return `${start}–${end} of ${filteredComponents.value.length}`;
});

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

watch([query, scope], () => {
  page.value = 0;
  if (componentList.value) componentList.value.scrollTop = 0;
});

watch(
  () => selectedId.value,
  (id) => {
    if (!id) return;
    const index = filteredComponents.value.findIndex(
      (component) => component.id === id,
    );
    if (index < 0) return;
    const nextPage = codeAtlasPageForIndex(index);
    if (nextPage !== page.value) {
      page.value = nextPage;
      nextTick(() => {
        if (componentList.value) componentList.value.scrollTop = 0;
      });
    }
  },
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

function apiLabel(component: ComponentNode): string {
  if (component.kind === "route") return "route";
  if (component.kind === "layout") return "layout";
  const count = component.props.length;
  return `${count} ${count === 1 ? "prop" : "props"}`;
}

function scopeCount(value: (typeof scopeOptions)[number]["value"]): number {
  if (value === "all") return props.graph.components.length;
  return counts.value[value];
}

function selectComponent(component: ComponentNode): void {
  selectedId.value = component.id;
  if (!inspectorOpen.value) {
    inspectorReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : inspectorTrigger.value;
    inspectorOpen.value = true;
    if (inspectorIsDrawer.value) nextTick(() => inspectorClose.value?.focus());
  }
}

function selectById(id: string): void {
  const component = props.graph.components.find((item) => item.id === id);
  if (component) selectComponent(component);
}

function toggleInspector(): void {
  if (inspectorOpen.value) {
    closeInspector();
    return;
  }
  inspectorReturnFocus = inspectorTrigger.value;
  inspectorOpen.value = true;
  nextTick(() => {
    graphView.value?.resize();
    if (inspectorIsDrawer.value) inspectorClose.value?.focus();
  });
}

function activateGoal(nextGoal: CodeInspectorGoal): void {
  const next = activateCodeInspectorGoal(
    { goal: goal.value, open: inspectorOpen.value },
    nextGoal,
    Boolean(selected.value),
  );
  goal.value = next.goal;
  inspectorOpen.value = next.open;
}

function handleGoalKeydown(event: KeyboardEvent, index: number): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const last = goalOptions.length - 1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : event.key === "ArrowRight"
          ? (index + 1) % goalOptions.length
          : (index - 1 + goalOptions.length) % goalOptions.length;
  activateGoal(goalOptions[nextIndex]!.value);
  nextTick(() => {
    const tabs = inspectorPanel.value?.querySelectorAll<HTMLElement>(
      '[role="tab"]',
    );
    tabs?.[nextIndex]?.focus();
  });
}

function closeInspector(restoreFocus = true): void {
  inspectorOpen.value = false;
  nextTick(() => {
    graphView.value?.resize();
    if (restoreFocus) {
      (inspectorReturnFocus ?? inspectorTrigger.value)?.focus();
    }
  });
}

function updateInspectorMode(event?: MediaQueryListEvent): void {
  inspectorIsDrawer.value = event?.matches ?? inspectorMedia?.matches ?? false;
}

function handleInspectorKeyboard(event: KeyboardEvent): void {
  if (
    event.key === "Escape" &&
    inspectorOpen.value &&
    inspectorIsDrawer.value
  ) {
    event.preventDefault();
    closeInspector();
    return;
  }
  if (
    event.key === "Tab" &&
    inspectorOpen.value &&
    inspectorIsDrawer.value &&
    inspectorPanel.value
  ) {
    const focusable = [
      ...inspectorPanel.value.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ];
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function previousPage(): void {
  page.value = Math.max(0, page.value - 1);
  if (componentList.value) componentList.value.scrollTop = 0;
}

function nextPage(): void {
  page.value = Math.min(totalPages.value - 1, page.value + 1);
  if (componentList.value) componentList.value.scrollTop = 0;
}

function useSelectedInTask(): void {
  if (!selected.value) return;
  const intent =
    goal.value === "impact"
      ? `Assess the impact of changing ${selected.value.effectiveName}.`
      : goal.value === "tests"
        ? `Review or extend the tests for ${selected.value.effectiveName}.`
        : `Evaluate whether ${selected.value.effectiveName} should be reused for this task.`;
  emit("useInTask", `code:${selected.value.id}`, intent);
}

async function copySelectedPath(): Promise<void> {
  if (!selected.value) return;
  await navigator.clipboard.writeText(selected.value.relativePath);
}

async function copyTestPath(testPath: string): Promise<void> {
  await navigator.clipboard.writeText(testPath);
}

onMounted(() => {
  inspectorMedia = window.matchMedia("(max-width: 1360px)");
  updateInspectorMode();
  inspectorMedia.addEventListener("change", updateInspectorMode);
  window.addEventListener("keydown", handleInspectorKeyboard);
});

onBeforeUnmount(() => {
  inspectorMedia?.removeEventListener("change", updateInspectorMode);
  window.removeEventListener("keydown", handleInspectorKeyboard);
});
</script>

<template>
  <section :class="['code-atlas', { 'inspector-open': inspectorOpen }]">
    <aside class="catalog-panel">
      <div class="panel-heading">
        <div>
          <span class="eyebrow">Repository graph</span>
          <h2>Code index</h2>
        </div>
        <span class="result-count">{{ filteredComponents.length }}</span>
      </div>

      <label class="local-search">
        <AtlasIcon name="search" />
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

      <div ref="componentList" class="component-list">
        <button
          v-for="component in visibleComponents"
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
            {{ apiLabel(component) }}
          </span>
        </button>
        <div v-if="filteredComponents.length === 0" class="empty-results">
          No code node matches this evidence.
        </div>
      </div>
      <footer v-if="filteredComponents.length > CODE_ATLAS_PAGE_SIZE" class="catalog-pagination">
        <button
          class="icon-button"
          :disabled="page === 0"
          aria-label="Previous component page"
          @click="previousPage"
        >
          <AtlasIcon name="arrow-right" />
        </button>
        <span>{{ visibleRange }}</span>
        <button
          class="icon-button"
          :disabled="page >= totalPages - 1"
          aria-label="Next component page"
          @click="nextPage"
        >
          <AtlasIcon name="arrow-right" />
        </button>
      </footer>
    </aside>

    <section class="map-panel">
      <div class="map-toolbar">
        <div>
          <span class="eyebrow">Dependency field</span>
          <p>Explore exact relationships in the graph, then inspect evidence for the selected component.</p>
        </div>
        <details class="graph-options">
          <summary>Relations</summary>
          <div class="edge-toggles">
            <label>
              <input v-model="showComposition" type="checkbox">
              composition
            </label>
            <label>
              <input v-model="showSimilar" type="checkbox">
              similarity
            </label>
          </div>
        </details>
        <div class="graph-actions" aria-label="Graph viewport">
          <button
            ref="inspectorTrigger"
            :class="['icon-button', 'graph-icon-button', { active: inspectorOpen }]"
            :disabled="!selected"
            aria-label="Inspect selected component"
            title="Inspect selected component"
            @click="toggleInspector"
          >
            <AtlasIcon name="inspect" />
          </button>
          <button
            class="icon-button graph-icon-button"
            aria-label="Fit selection"
            title="Fit selection"
            @click="graphView?.fitSelection()"
          >
            <AtlasIcon name="focus" />
          </button>
          <button
            class="icon-button graph-icon-button"
            aria-label="Fit graph"
            title="Fit graph"
            @click="graphView?.fitGraph()"
          >
            <AtlasIcon name="maximize" />
          </button>
          <button
            class="icon-button graph-icon-button"
            aria-label="Reset graph view"
            title="Reset graph view"
            @click="graphView?.resetView()"
          >
            <AtlasIcon name="refresh" />
          </button>
        </div>
      </div>
      <AtlasGraph
        ref="graphView"
        :components="filteredComponents"
        :edges="filteredEdges"
        :selected-id="selected?.id"
        @select="selectById"
      />
      <div class="map-legend">
        <span><i class="scope-dot public" /> shared</span>
        <span><i class="scope-dot feature" /> feature</span>
        <span><i class="scope-dot private" /> internal</span>
        <span class="degree-legend">node size = relations</span>
      </div>
    </section>

    <button
      v-if="selected && inspectorOpen"
      class="inspector-backdrop"
      aria-label="Close component details"
      @click="closeInspector()"
    />
    <aside
      v-if="selected && inspectorOpen"
      ref="inspectorPanel"
      class="detail-panel"
      aria-label="Component details"
    >
      <div class="detail-panel-bar">
        <span>Component details</span>
        <button
          ref="inspectorClose"
          class="icon-button"
          aria-label="Close component details"
          @click="closeInspector()"
        >
          <AtlasIcon name="x" />
        </button>
      </div>
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
        <div class="entity-actions">
          <button class="primary-button" @click="useSelectedInTask">
            Use in task
          </button>
          <button class="text-button" @click="copySelectedPath">
            Copy path
          </button>
        </div>
      </div>

      <nav class="inspector-goal-nav" role="tablist" aria-label="Component evidence view">
        <button
          v-for="(item, index) in goalOptions"
          :id="`component-goal-${item.value}`"
          :key="item.value"
          role="tab"
          :aria-selected="goal === item.value"
          aria-controls="component-goal-panel"
          :tabindex="goal === item.value ? 0 : -1"
          :class="{ active: goal === item.value }"
          @click="activateGoal(item.value)"
          @keydown="handleGoalKeydown($event, index)"
        >
          {{ item.label }}
        </button>
      </nav>
      <p class="inspector-goal-help">
        {{ goalOptions.find((item) => item.value === goal)?.help }}
      </p>

      <div
        id="component-goal-panel"
        role="tabpanel"
        :aria-labelledby="`component-goal-${goal}`"
        class="inspector-goal-panel"
      >
      <section v-if="goal === 'impact' || goal === 'reuse'" class="detail-section">
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

      <section v-if="goal === 'impact'" class="detail-section">
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
          <AtlasIcon name="arrow-right" />
          <strong>{{ consumer.effectiveName }}</strong>
          <small>direct</small>
        </button>
        <p v-if="details?.impact.directConsumers.length === 0" class="muted">
          No indexed code node consumes it.
        </p>
      </section>

      <section
        v-if="goal === 'reuse' && (selected.kind ?? 'component') === 'component'"
        class="detail-section"
      >
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

      <section v-if="goal === 'tests'" class="detail-section">
        <div class="section-title">
          <h3>Test evidence</h3>
          <span>{{ selected.testPaths.length }} linked</span>
        </div>
        <div v-if="selected.testPaths.length" class="test-paths">
          <button
            v-for="testPath in selected.testPaths"
            :key="testPath"
            class="relation-row"
            @click="copyTestPath(testPath)"
          >
            <AtlasIcon name="check" />
            <strong>{{ testPath }}</strong>
            <small>copy path</small>
          </button>
        </div>
        <p v-else class="muted">
          No test import or mount relation is indexed. Name similarity alone is
          not treated as evidence.
        </p>
      </section>
      </div>
    </aside>
  </section>
</template>
