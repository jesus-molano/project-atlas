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
const { statusLabel, t } = useAtlasI18n();

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
  fitSelection: (offsetX?: number) => void;
  resetView: () => void;
  resize: () => void;
}>();
const inspectorOpen = ref(false);
const inspectorIsDrawer = ref(false);
let inspectorMedia: MediaQueryList | undefined;
let inspectorReturnFocus: HTMLElement | undefined;

const coverage = computed(() => props.graph.project.scan?.coverage);
const profileLabel = computed(() => {
  const profile = props.graph.project.profile;
  if (!profile) return props.graph.project.framework;
  return [
    ...new Set(
      profile.packages.map((packageProfile) => {
        const technology =
          packageProfile.metaFramework ?? packageProfile.primaryFramework;
        const version =
          packageProfile.versions[technology] ??
          packageProfile.versions[packageProfile.primaryFramework];
        return `${technology}${version ? ` ${version}` : ""}`;
      }),
    ),
  ].join(" · ");
});
const coverageTone = computed(() =>
  coverage.value?.errorFiles
    ? "danger"
    : !coverage.value?.complete
      ? "warning"
      : "healthy",
);

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
            (
              component.kind === "route" ||
              component.kind === "layout" ||
              component.kind === "special"
            ) &&
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
  return t("{start}–{end} of {total}", {
    start,
    end,
    total: filteredComponents.value.length,
  });
});

const filteredEdges = computed(() =>
  props.graph.edges.filter(
    (edge) =>
      filteredIds.value.has(edge.source) &&
      filteredIds.value.has(edge.target) &&
      ((edge.kind === "similar_to" && showSimilar.value) ||
        (
          ["renders", "uses_layout", "route_parent", "hydrates", "defers"].includes(
            edge.kind,
          ) &&
          showComposition.value
        )),
  ),
);

const selected = computed(
  () =>
    filteredComponents.value.find(
      (component) => component.id === selectedId.value,
    ),
);

watch(
  () => props.initialComponentId,
  (componentId) => {
    if (
      componentId &&
      props.graph.components.some((component) => component.id === componentId)
    ) {
      selectedId.value = componentId;
      inspectorOpen.value = true;
    }
  },
  { immediate: true },
);

watch([query, scope], () => {
  page.value = 0;
  if (componentList.value) componentList.value.scrollTop = 0;
  if (
    selectedId.value &&
    !filteredComponents.value.some(
      (component) => component.id === selectedId.value,
    )
  ) {
    selectedId.value = undefined;
    inspectorOpen.value = false;
  }
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
    return { label: t("High blast radius"), tone: "high", consumers };
  }
  if (consumers >= 3) {
    return { label: t("Moderate impact"), tone: "medium", consumers };
  }
  return { label: t("Contained impact"), tone: "low", consumers };
});

const inspectorActionLabel = computed(() =>
  inspectorOpen.value
    ? t("Hide component details")
    : t("Inspect selected component"),
);

function scopeLabel(visibility: ComponentNode["visibility"]): string {
  return t(
    scopeOptions.find((item) => item.value === visibility)?.label ?? visibility,
  );
}

function apiLabel(component: ComponentNode): string {
  if (component.kind === "route") return statusLabel("route");
  if (component.kind === "layout") return statusLabel("layout");
  if (component.kind === "special") return t(component.role ?? "special");
  const count = component.props.length;
  return t(count === 1 ? "{count} prop" : "{count} props", { count });
}

function scopeCount(value: (typeof scopeOptions)[number]["value"]): number {
  if (value === "all") return props.graph.components.length;
  return counts.value[value];
}

function similarityReason(reason: string): string {
  const prefixes: Readonly<Record<string, string>> = {
    "shared props:": "shared props:",
    "shared children:": "shared children:",
    "shared style tokens:": "shared style tokens:",
  };
  const prefix = Object.keys(prefixes).find((candidate) =>
    reason.startsWith(candidate),
  );
  if (!prefix) return t(reason);
  return `${t(prefixes[prefix]!)} ${reason.slice(prefix.length).trim()}`;
}

function selectComponent(component: ComponentNode): void {
  selectedId.value = component.id;
  if (!inspectorOpen.value) {
    inspectorReturnFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : inspectorTrigger.value;
    inspectorOpen.value = true;
    nextTick(() => {
      graphView.value?.resize();
      graphView.value?.fitSelection(graphSelectionOffset());
      if (inspectorIsDrawer.value) inspectorClose.value?.focus();
    });
  }
}

function graphSelectionOffset(): number {
  return inspectorOpen.value &&
    window.matchMedia("(min-width: 861px) and (max-width: 1360px)").matches
    ? -175
    : 0;
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
      ? t("Assess the impact of changing {name}.", {
          name: selected.value.effectiveName,
        })
      : goal.value === "tests"
        ? t("Review or extend the tests for {name}.", {
            name: selected.value.effectiveName,
          })
        : t("Evaluate whether {name} should be reused for this task.", {
            name: selected.value.effectiveName,
          });
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
          <span class="eyebrow">{{ t("Repository graph") }}</span>
          <h2>{{ t("Code index") }}</h2>
        </div>
        <span class="result-count">{{ filteredComponents.length }}</span>
      </div>

      <details
        v-if="coverage"
        class="coverage-strip"
        :data-tone="coverageTone"
      >
        <summary>
          <strong :title="profileLabel">{{ profileLabel }}</strong>
          <span>
            {{ coverage.parsedFiles }}/{{ coverage.candidateFiles }}
            {{ t("parsed") }}
            <template v-if="coverage.skippedFiles">
              · {{ coverage.skippedFiles }} {{ t("skipped") }}
            </template>
            <template v-if="coverage.errorFiles">
              · {{ coverage.errorFiles }} {{ t("errors") }}
            </template>
          </span>
        </summary>
        <ul v-if="coverage.diagnostics.length">
          <li
            v-for="diagnostic in coverage.diagnostics.slice(0, 5)"
            :key="`${diagnostic.code}:${diagnostic.path ?? diagnostic.message}`"
          >
            <strong>{{ diagnostic.code }}</strong>
            <span>
              <template v-if="diagnostic.path">{{ diagnostic.path }} · </template>
              {{ diagnostic.message }}
            </span>
          </li>
        </ul>
        <p v-else>{{ t("All discovered frontend files were parsed.") }}</p>
      </details>

      <label class="local-search">
        <AtlasIcon name="search" />
        <input
          v-model="query"
          type="search"
          :aria-label="t('Filter Code Atlas nodes')"
          :placeholder="t('Name, path, prop, or intent')"
        >
      </label>

      <div class="scope-tabs" role="tablist" :aria-label="t('Component scope')">
        <button
          v-for="item in scopeOptions"
          :key="item.value"
          :class="{ active: scope === item.value }"
          :title="t(item.description)"
          role="tab"
          :aria-selected="scope === item.value"
          @click="scope = item.value"
        >
          {{ t(item.label) }}
          <span>{{ scopeCount(item.value) }}</span>
        </button>
      </div>

      <div
        ref="componentList"
        class="component-list"
        tabindex="-1"
        :aria-label="t('Code catalog results')"
      >
        <button
          v-for="component in visibleComponents"
          :key="component.id"
          class="component-row"
          :class="{ selected: selected?.id === component.id }"
          :title="`${component.effectiveName} · ${component.relativePath} · ${apiLabel(component)}`"
          @click="selectComponent(component)"
        >
          <span :class="['scope-dot', component.visibility]" />
          <span class="component-copy">
            <strong :title="component.effectiveName">{{ component.effectiveName }}</strong>
            <small :title="component.relativePath">{{ component.relativePath }}</small>
          </span>
          <span class="api-count" :title="apiLabel(component)">
            {{ apiLabel(component) }}
          </span>
        </button>
        <div v-if="filteredComponents.length === 0" class="empty-results">
          {{ t("No code node matches this evidence.") }}
        </div>
      </div>
      <footer v-if="filteredComponents.length > CODE_ATLAS_PAGE_SIZE" class="catalog-pagination">
        <button
          class="icon-button"
          :disabled="page === 0"
          :aria-label="t('Previous component page')"
          @click="previousPage"
        >
          <AtlasIcon name="arrow-right" />
        </button>
        <span>{{ visibleRange }}</span>
        <button
          class="icon-button"
          :disabled="page >= totalPages - 1"
          :aria-label="t('Next component page')"
          @click="nextPage"
        >
          <AtlasIcon name="arrow-right" />
        </button>
      </footer>
    </aside>

    <section class="map-panel">
      <div class="map-toolbar">
        <div>
          <span class="eyebrow">{{ t("Dependency field") }}</span>
          <p>{{ t("Explore resolved and inferred relationships, then inspect evidence for the selected node.") }}</p>
        </div>
        <details class="graph-options">
          <summary>{{ t("Relations") }}</summary>
          <div class="edge-toggles">
            <label>
              <input v-model="showComposition" type="checkbox">
              {{ t("composition") }}
            </label>
            <label>
              <input v-model="showSimilar" type="checkbox">
              {{ t("similarity") }}
            </label>
          </div>
        </details>
        <div class="graph-actions" :aria-label="t('Graph viewport')">
          <button
            ref="inspectorTrigger"
            :class="['icon-button', 'graph-icon-button', { active: inspectorOpen }]"
            :disabled="!selected"
            :aria-label="inspectorActionLabel"
            :title="inspectorActionLabel"
            @click="toggleInspector"
          >
            <AtlasIcon name="inspect" />
          </button>
          <button
            class="icon-button graph-icon-button"
            :aria-label="t('Fit selection')"
            :title="t('Fit selection')"
            @click="graphView?.fitSelection(graphSelectionOffset())"
          >
            <AtlasIcon name="focus" />
          </button>
          <button
            class="icon-button graph-icon-button"
            :aria-label="t('Fit graph')"
            :title="t('Fit graph')"
            @click="graphView?.fitGraph()"
          >
            <AtlasIcon name="maximize" />
          </button>
          <button
            class="icon-button graph-icon-button"
            :aria-label="t('Reset graph view')"
            :title="t('Reset graph view')"
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
        <span><i class="scope-dot public" /> {{ t("shared") }}</span>
        <span><i class="scope-dot feature" /> {{ t("feature") }}</span>
        <span><i class="scope-dot private" /> {{ t("internal") }}</span>
        <span class="degree-legend">{{ t("node size = relations") }}</span>
      </div>
    </section>

    <button
      v-if="selected && inspectorOpen"
      class="inspector-backdrop"
      :aria-label="t('Close component details')"
      @click="closeInspector()"
    />
    <aside
      v-if="selected && inspectorOpen"
      ref="inspectorPanel"
      class="detail-panel"
      :aria-label="t('Component details')"
    >
      <div class="detail-panel-bar">
        <span>{{ t("Component details") }}</span>
        <button
          ref="inspectorClose"
          class="icon-button"
          :aria-label="t('Close component details')"
          @click="closeInspector()"
        >
          <AtlasIcon name="x" />
        </button>
      </div>
      <ScrollToTopButton
        :target="componentList"
        :focus-target="componentList"
        placement="panel"
        :threshold="180"
        :min-overflow="280"
      />
      <div class="detail-header">
        <div class="detail-kicker">
          <span :class="['scope-badge', selected.visibility]">
            {{ scopeLabel(selected.visibility) }}
          </span>
          <span>{{ statusLabel(selected.kind ?? "component") }}</span>
          <span v-if="selected.runtime">{{ statusLabel(selected.runtime) }}</span>
          <span v-if="selected.routePath">{{ selected.routePath }}</span>
          <span>{{ t(selected.props.length === 1 ? "{count} prop" : "{count} props", { count: selected.props.length }) }}</span>
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
            {{ t("Use in task") }}
          </button>
          <button class="text-button" @click="copySelectedPath">
            {{ t("Copy path") }}
          </button>
        </div>
      </div>

      <nav class="inspector-goal-nav" role="tablist" :aria-label="t('Component evidence view')">
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
          {{ t(item.label) }}
        </button>
      </nav>
      <p class="inspector-goal-help">
        {{ t(goalOptions.find((item) => item.value === goal)?.help ?? "") }}
      </p>

      <div
        id="component-goal-panel"
        role="tabpanel"
        :aria-labelledby="`component-goal-${goal}`"
        class="inspector-goal-panel"
      >
      <section v-if="goal === 'impact' || goal === 'reuse'" class="detail-section">
        <div class="section-title">
          <h3>{{ t("Public API") }}</h3>
          <span>{{ t(selected.props.length === 1 ? "{count} prop" : "{count} props", { count: selected.props.length }) }}</span>
        </div>
        <div v-if="selected.props.length" class="property-list">
          <div v-for="prop in selected.props" :key="prop.name" class="property">
            <div>
              <strong>{{ prop.name }}</strong>
              <em v-if="prop.required">{{ t("required") }}</em>
            </div>
            <code>{{ prop.type }}</code>
          </div>
        </div>
        <p v-else class="muted">{{ t("No statically declared props.") }}</p>
        <div class="inline-meta">
          <span>{{ t("{count} events", { count: selected.events.length }) }}</span>
          <span>{{ t("{count} slots", { count: selected.slots.length }) }}</span>
          <span>{{ t("{count} models", { count: selected.models.length }) }}</span>
        </div>
      </section>

      <section v-if="goal === 'impact'" class="detail-section">
        <div class="section-title">
          <h3>{{ t("Change impact") }}</h3>
          <span>{{ t("{count} consumers", { count: details?.impact.transitiveConsumers.length ?? 0 }) }}</span>
        </div>
        <button
          v-for="consumer in details?.impact.directConsumers"
          :key="consumer.id"
          class="relation-row"
          @click="selectComponent(consumer)"
        >
          <AtlasIcon name="arrow-right" />
          <strong>{{ consumer.effectiveName }}</strong>
          <small>{{ t("direct") }}</small>
        </button>
        <p v-if="details?.impact.directConsumers.length === 0" class="muted">
          {{
            coverage?.complete
              ? t("No indexed code node consumes it.")
              : t("No consumer was found within the successfully parsed files.")
          }}
        </p>
      </section>

      <section
        v-if="goal === 'reuse' && (selected.kind ?? 'component') === 'component'"
        class="detail-section"
      >
        <div class="section-title">
          <h3>{{ t("Reuse candidates") }}</h3>
          <span>{{ t("explainable") }}</span>
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
          <p>{{ candidate.evidence.reasons.slice(0, 2).map(similarityReason).join(" · ") }}</p>
        </button>
        <p v-if="details?.similar.length === 0" class="muted">
          {{ t("No strong structural match yet.") }}
        </p>
      </section>
      <section
        v-else-if="goal === 'reuse'"
        class="detail-section"
      >
        <p class="muted">
          {{ t("Framework structure is inspectable for impact, but excluded from reusable-component matches.") }}
        </p>
      </section>

      <section v-if="goal === 'tests'" class="detail-section">
        <div class="section-title">
          <h3>{{ t("Test evidence") }}</h3>
          <span>{{ t("{count} linked", { count: selected.testPaths.length }) }}</span>
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
            <small>{{ t("copy path") }}</small>
          </button>
        </div>
        <p v-else class="muted">
          {{ t("No test import or mount relation is indexed. Name similarity alone is not treated as evidence.") }}
        </p>
      </section>
      </div>
    </aside>
  </section>
</template>
