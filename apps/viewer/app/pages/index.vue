<script setup lang="ts">
import {
  componentImpact,
  inferPreviewControls,
  initialPreviewProps,
  searchComponents,
  similarComponents,
  type ComponentGraph,
  type ComponentNode,
  type DesignToken,
  type PreviewControl,
  type PreviewDependencyEnvironment,
  type PreviewScenario,
  type PreviewStyleEnvironment,
  type PreviewViewport,
} from "@component-atlas/core/browser";

const { data: graph, error, refresh } = await useFetch<ComponentGraph>("/api/graph");
const { data: runtime } = await useFetch<{
  previewOrigin: string;
  styling: PreviewStyleEnvironment;
  dependencies: PreviewDependencyEnvironment;
}>("/api/runtime");

const mode = ref<"map" | "lab">("lab");
const query = ref("");
const scope = ref<"all" | ComponentNode["visibility"]>("all");
const selectedId = ref<string>();
const showSimilar = ref(true);
const showComposition = ref(true);
const inspectorTab = ref<"props" | "tokens" | "contract">("props");
const previewValues = ref<Record<string, unknown>>({});
const tokenOverrides = ref<Record<string, string>>({});
const viewport = ref<PreviewViewport>({ width: 768, height: 560 });
const background = ref("#11161d");
const previewStatus = ref<"booting" | "ready" | "error">("booting");
const previewMessage = ref("");
const lastAction = ref("");
const scenarios = ref<PreviewScenario[]>([]);
const activeScenarioId = ref<string>();
const scenarioName = ref("Default");
const saveState = ref<"idle" | "saving" | "saved" | "error">("idle");
const saveMessage = ref("");
const jsonErrors = ref<Record<string, boolean>>({});
const copyState = ref<"idle" | "copied">("idle");
const previewHistory = ref<Record<string, "ready" | "error">>({});

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

const controls = computed<PreviewControl[]>(() => {
  if (!selected.value) return [];
  const inferred = inferPreviewControls(selected.value);
  if (selected.value.slots.includes("default")) {
    inferred.push({
      name: "$slot",
      label: "Default Slot",
      kind: "text",
      type: "slot",
      required: false,
      options: [],
      defaultValue: "Preview content",
    });
  }
  return inferred;
});

const actionNames = computed(() =>
  controls.value
    .filter((control) => control.kind === "action")
    .map((control) => control.name),
);

const componentTokens = computed<DesignToken[]>(() => {
  if (!graph.value || !selected.value) return [];
  const referenced = new Set(
    selected.value.classTokens
      .flatMap((className) => [...className.matchAll(/var\(--([^)]+)\)/g)])
      .map((match) => match[1])
      .filter((name): name is string => Boolean(name)),
  );
  const exact = graph.value.tokens.filter((token) => referenced.has(token.name));
  const semantic = graph.value.tokens.filter((token) =>
    ["color", "radius", "shadow"].includes(token.kind),
  );
  return [
    ...new Map([...exact, ...semantic].map((token) => [token.name, token])).values(),
  ].slice(0, 24);
});

const renderable = computed(
  () => selected.value?.framework === "vue" || Boolean(selected.value?.exported),
);

const counts = computed(() => {
  const components = graph.value?.components ?? [];
  return {
    public: components.filter((item) => item.visibility === "public").length,
    feature: components.filter((item) => item.visibility === "feature").length,
    private: components.filter((item) => item.visibility === "private").length,
  };
});

const agentContract = computed(() =>
  JSON.stringify(
    {
      component: selected.value?.id,
      scenario: scenarioName.value,
      props: previewValues.value,
      tokens: tokenOverrides.value,
      viewport: viewport.value,
      background: background.value,
      styling: runtime.value?.styling,
      dependencies: runtime.value?.dependencies,
    },
    null,
    2,
  ),
);

const stylePipelineLabel = computed(() => {
  const pipeline = runtime.value?.styling.pipeline;
  if (pipeline === "tailwind-v4") return "Tailwind 4 · project styles";
  if (pipeline === "tailwind-v3") return "Tailwind 3 · project config";
  if (pipeline === "project-css") return "Project CSS";
  if (pipeline === "none") return "No global CSS";
  return "CSS · checking";
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

function resetPreview(): void {
  previewValues.value = initialPreviewProps(controls.value);
  tokenOverrides.value = {};
  viewport.value = { width: 768, height: 560 };
  background.value = "#11161d";
  activeScenarioId.value = undefined;
  scenarioName.value = `${selected.value?.effectiveName ?? "Component"} state`;
  previewMessage.value = "";
  lastAction.value = "";
  saveState.value = "idle";
  saveMessage.value = "";
  jsonErrors.value = {};
}

async function loadScenarios(componentId: string): Promise<void> {
  scenarios.value = await $fetch<PreviewScenario[]>("/api/scenarios", {
    query: { component: componentId },
  });
}

watch(
  () => selected.value?.id,
  async (componentId) => {
    if (!componentId) return;
    resetPreview();
    await loadScenarios(componentId);
  },
  { immediate: true },
);

function applyScenario(scenario: PreviewScenario): void {
  activeScenarioId.value = scenario.id;
  scenarioName.value = scenario.name;
  previewValues.value = JSON.parse(
    JSON.stringify(scenario.props),
  ) as Record<string, unknown>;
  tokenOverrides.value = { ...scenario.tokens };
  viewport.value = { ...scenario.viewport };
  background.value = scenario.background;
}

function chooseScenario(event: Event): void {
  const id = (event.target as HTMLSelectElement).value;
  if (!id) {
    resetPreview();
    return;
  }
  const scenario = scenarios.value.find((item) => item.id === id);
  if (scenario) applyScenario(scenario);
}

async function saveScenario(): Promise<void> {
  if (!selected.value) return;
  saveState.value = "saving";
  saveMessage.value = "";
  try {
    const scenario = await $fetch<PreviewScenario>("/api/scenarios", {
      method: "POST",
      body: {
        id: activeScenarioId.value,
        componentId: selected.value.id,
        componentName: selected.value.effectiveName,
        name: scenarioName.value,
        props: previewValues.value,
        tokens: tokenOverrides.value,
        viewport: viewport.value,
        background: background.value,
      },
    });
    activeScenarioId.value = scenario.id;
    await loadScenarios(selected.value.id);
    saveState.value = "saved";
    window.setTimeout(() => (saveState.value = "idle"), 1600);
  } catch (error) {
    saveState.value = "error";
    saveMessage.value =
      error instanceof Error ? error.message : "Scenario could not be saved.";
  }
}

async function copyContract(): Promise<void> {
  await navigator.clipboard.writeText(agentContract.value);
  copyState.value = "copied";
  window.setTimeout(() => (copyState.value = "idle"), 1200);
}

function updateText(name: string, event: Event): void {
  previewValues.value[name] = (event.target as HTMLInputElement).value;
}

function selectValue(control: PreviewControl, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === "true") previewValues.value[control.name] = true;
  else if (value === "false") previewValues.value[control.name] = false;
  else if (value === "null") previewValues.value[control.name] = null;
  else if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    previewValues.value[control.name] = Number(value);
  } else {
    previewValues.value[control.name] = value;
  }
}

function presetIndex(control: PreviewControl): number {
  const serialized = JSON.stringify(previewValues.value[control.name] ?? null);
  return (
    control.presets?.findIndex(
      (preset) => JSON.stringify(preset.value) === serialized,
    ) ?? -1
  );
}

function applyPreset(control: PreviewControl, event: Event): void {
  const index = Number((event.target as HTMLSelectElement).value);
  const preset = control.presets?.[index];
  if (!preset) return;
  previewValues.value[control.name] = JSON.parse(
    JSON.stringify(preset.value),
  ) as unknown;
  jsonErrors.value[control.name] = false;
}

function updateBoolean(name: string, event: Event): void {
  previewValues.value[name] = (event.target as HTMLInputElement).checked;
}

function updateNumber(name: string, event: Event): void {
  previewValues.value[name] = Number((event.target as HTMLInputElement).value);
}

function jsonValue(name: string): string {
  return JSON.stringify(previewValues.value[name] ?? null, null, 2);
}

function updateJson(name: string, event: Event): void {
  try {
    previewValues.value[name] = JSON.parse(
      (event.target as HTMLTextAreaElement).value,
    ) as unknown;
    jsonErrors.value[name] = false;
  } catch {
    jsonErrors.value[name] = true;
  }
}

function tokenValue(token: DesignToken): string {
  return tokenOverrides.value[token.name] ?? token.value;
}

function updateToken(token: DesignToken, value: string): void {
  tokenOverrides.value[token.name] = value;
}

function updateTokenFromEvent(token: DesignToken, event: Event): void {
  updateToken(token, (event.target as HTMLInputElement).value);
}

function setViewport(width: number, height: number): void {
  viewport.value = { width, height };
}

function setPreviewStatus(
  status: "booting" | "ready" | "error",
  message?: string,
): void {
  previewStatus.value = status;
  previewMessage.value =
    status === "error" && runtime.value?.dependencies.status === "missing"
      ? `Project dependencies are missing. Run \`${runtime.value.dependencies.installCommand}\` in the target repository.`
      : (message ?? "");
  if (selected.value && status !== "booting") {
    previewHistory.value[selected.value.id] = status;
  }
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
            <p>Atlas</p>
            <span>{{ graph.project.name }} · reuse workbench</span>
          </div>
        </div>

        <nav class="mode-switch" aria-label="Atlas mode">
          <button
            :class="{ active: mode === 'map' }"
            :aria-pressed="mode === 'map'"
            @click="mode = 'map'"
          >
            <i class="mode-glyph map-glyph" />
            Map
          </button>
          <button
            :class="{ active: mode === 'lab' }"
            :aria-pressed="mode === 'lab'"
            @click="mode = 'lab'"
          >
            <i class="mode-glyph lab-glyph" />
            Lab
          </button>
        </nav>

        <div class="scan-meta">
          <span class="framework-pill">{{ graph.project.framework }}</span>
          <span>{{ graph.components.length }} components</span>
          <span>{{ graph.tokens.length }} tokens</span>
        </div>
      </header>

      <section class="workspace">
        <aside class="catalog-panel">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">Reuse index</span>
              <h1>Components</h1>
            </div>
            <span class="result-count">{{ filteredComponents.length }}</span>
          </div>

          <label class="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              v-model="query"
              type="search"
              aria-label="Search components"
              placeholder="Find by name, prop, or intent"
            >
            <kbd>⌘K</kbd>
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

          <p class="scope-help">
            Shared is the first place to look before creating anything new.
          </p>

          <div class="component-list">
            <button
              v-for="component in filteredComponents"
              :key="component.id"
              class="component-row"
              :class="{ selected: selected?.id === component.id }"
              @click="selectComponent(component)"
            >
              <span
                :class="[
                  'scope-dot',
                  component.visibility,
                  previewHistory[component.id]
                    ? `preview-${previewHistory[component.id]}`
                    : '',
                ]"
              />
              <span class="component-copy">
                <strong>{{ component.effectiveName }}</strong>
                <small>{{ component.relativePath }}</small>
              </span>
              <span class="api-count">
                {{ component.props.length }} {{ component.props.length === 1 ? "prop" : "props" }}
              </span>
            </button>
            <div v-if="filteredComponents.length === 0" class="empty-results">
              No specimen matches this search.
            </div>
          </div>
        </aside>

        <section v-if="mode === 'map'" class="map-panel">
          <div class="map-toolbar">
            <div>
              <span class="eyebrow">Relationship field / 02</span>
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
            <span><i class="scope-dot public" /> shared</span>
            <span><i class="scope-dot feature" /> feature</span>
            <span><i class="scope-dot private" /> internal</span>
          </div>
        </section>

        <section v-else-if="selected" class="lab-panel">
          <header class="lab-header">
            <div>
              <span class="eyebrow">
                Live preview · {{ scopeLabel(selected.visibility) }}
              </span>
              <h2>{{ selected.effectiveName }}</h2>
            </div>
            <div class="lab-actions">
              <button @click="resetPreview">Reset</button>
              <button @click="copyContract">
                {{ copyState === "copied" ? "Copied" : "Copy state" }}
              </button>
              <span :class="['render-status', previewStatus]">
                <i />
                {{ previewStatus }}
              </span>
              <span
                class="style-status"
                :title="runtime?.styling.entryPoints.join(', ')"
              >
                {{ stylePipelineLabel }}
              </span>
              <span
                v-if="runtime?.dependencies.status === 'missing'"
                class="dependency-status"
                :title="`Run ${runtime.dependencies.installCommand} in the target repository`"
              >
                Dependencies missing
              </span>
            </div>
          </header>

          <div class="lab-commandbar">
            <div class="scenario-rail">
              <label for="scenario-select">Scenario</label>
              <select
                id="scenario-select"
                :value="activeScenarioId ?? ''"
                @change="chooseScenario"
              >
                <option value="">Live defaults</option>
                <option
                  v-for="scenario in scenarios"
                  :key="scenario.id"
                  :value="scenario.id"
                >
                  {{ scenario.name }}
                </option>
              </select>
            </div>
            <div class="viewport-rail" aria-label="Preview viewport">
              <button
                :class="{ active: viewport.width === 390 }"
                :aria-pressed="viewport.width === 390"
                title="Mobile 390×720"
                @click="setViewport(390, 720)"
              >
                M
              </button>
              <button
                :class="{ active: viewport.width === 768 }"
                :aria-pressed="viewport.width === 768"
                title="Tablet 768×560"
                @click="setViewport(768, 560)"
              >
                T
              </button>
              <button
                :class="{ active: viewport.width === 960 }"
                :aria-pressed="viewport.width === 960"
                title="Desktop 960×640"
                @click="setViewport(960, 640)"
              >
                D
              </button>
              <code>{{ viewport.width }}×{{ viewport.height }}</code>
            </div>
          </div>

          <div class="specimen-field">
            <span class="field-coordinate top-left">0 / 0</span>
            <span class="field-coordinate bottom-right">
              {{ viewport.width }} / {{ viewport.height }}
            </span>
            <div v-if="!renderable" class="render-boundary">
              <span class="boundary-symbol">↗</span>
              <strong>Internal component</strong>
              <p>
                This component is file-local. Export it before isolated
                rendering; its contract and relationships remain available to agents.
              </p>
            </div>
            <PreviewCanvas
              v-else
              :component="selected"
              :preview-origin="runtime?.previewOrigin ?? ''"
              :values="previewValues"
              :tokens="tokenOverrides"
              :viewport="viewport"
              :background="background"
              :action-names="actionNames"
              @status="setPreviewStatus"
              @action="lastAction = $event"
            />
            <div v-if="previewStatus === 'error'" class="preview-diagnostic">
              <strong>Preview needs project context</strong>
              <p>{{ previewMessage }}</p>
              <span>The component contract is still available to you and to agents.</span>
            </div>
          </div>

          <footer class="lab-footer">
            <span>
              <i :class="['scope-dot', selected.visibility]" />
              {{ scopeLabel(selected.visibility) }} / {{ selected.framework }}
            </span>
            <span>{{ controls.length }} controls</span>
            <span>{{ componentTokens.length }} semantic tokens</span>
            <span v-if="lastAction" class="action-signal">
              event · {{ lastAction }}
            </span>
            <span v-if="previewMessage" class="error-signal">
              {{ previewMessage }}
            </span>
          </footer>
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
          </div>

          <template v-if="mode === 'map'">
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
          </template>

          <template v-else>
            <div class="inspector-tabs" role="tablist" aria-label="Lab inspector">
              <button
                v-for="tab in ['props', 'tokens', 'contract'] as const"
                :key="tab"
                :class="{ active: inspectorTab === tab }"
                role="tab"
                :aria-selected="inspectorTab === tab"
                @click="inspectorTab = tab"
              >
                {{ tab }}
              </button>
            </div>

            <section v-if="inspectorTab === 'props'" class="control-stack">
              <div class="inspector-intro">
                <span class="eyebrow">Live controls</span>
                <p>Choose common values first. Raw JSON stays under Advanced.</p>
              </div>

              <div v-for="control in controls" :key="control.name" class="control-row">
                <div class="control-label">
                  <label :for="`control-${control.name}`">{{ control.label }}</label>
                  <code>{{ control.type }}</code>
                </div>

                <div v-if="control.kind === 'action'" class="action-control">
                  <span>Captured as event</span>
                  <i />
                </div>

                <label v-else-if="control.kind === 'boolean'" class="toggle-control">
                  <input
                    :id="`control-${control.name}`"
                    type="checkbox"
                    :checked="Boolean(previewValues[control.name])"
                    @change="updateBoolean(control.name, $event)"
                  >
                  <span />
                  <em>{{ previewValues[control.name] ? "on" : "off" }}</em>
                </label>

                <select
                  v-else-if="control.kind === 'select'"
                  :id="`control-${control.name}`"
                  :value="String(previewValues[control.name] ?? '')"
                  @change="selectValue(control, $event)"
                >
                  <option
                    v-for="option in control.options"
                    :key="option"
                    :value="option"
                  >
                    {{ option }}
                  </option>
                </select>

                <input
                  v-else-if="control.kind === 'number'"
                  :id="`control-${control.name}`"
                  type="number"
                  :value="Number(previewValues[control.name] ?? 0)"
                  @input="updateNumber(control.name, $event)"
                >

                <input
                  v-else-if="control.kind === 'date'"
                  :id="`control-${control.name}`"
                  type="date"
                  :value="String(previewValues[control.name] ?? '')"
                  @input="updateText(control.name, $event)"
                >

                <div v-else-if="control.kind === 'color'" class="color-control">
                  <input
                    :id="`control-${control.name}`"
                    type="color"
                    :value="String(previewValues[control.name] ?? '#7b9cff')"
                    @input="updateText(control.name, $event)"
                  >
                  <code>{{ previewValues[control.name] }}</code>
                </div>

                <div v-else-if="control.kind === 'json'" class="object-control">
                  <select
                    v-if="control.presets?.length"
                    :aria-label="`${control.label} preset`"
                    :value="presetIndex(control)"
                    @change="applyPreset(control, $event)"
                  >
                    <option
                      v-for="(preset, index) in control.presets"
                      :key="`${control.name}-${preset.label}`"
                      :value="index"
                    >
                      {{ preset.label }}
                    </option>
                    <option v-if="presetIndex(control) === -1" :value="-1">
                      Custom value
                    </option>
                  </select>
                  <details>
                    <summary>Advanced JSON</summary>
                    <textarea
                      :id="`control-${control.name}`"
                      :class="{ invalid: jsonErrors[control.name] }"
                      :value="jsonValue(control.name)"
                      rows="4"
                      @change="updateJson(control.name, $event)"
                    />
                  </details>
                </div>

                <input
                  v-else
                  :id="`control-${control.name}`"
                  type="text"
                  :value="String(previewValues[control.name] ?? '')"
                  @input="updateText(control.name, $event)"
                >
              </div>
              <p v-if="controls.length === 0" class="muted control-empty">
                This component has no inferred inputs. Its visual state is still
                rendered in isolation.
              </p>
            </section>

            <section v-else-if="inspectorTab === 'tokens'" class="control-stack">
              <div class="inspector-intro">
                <span class="eyebrow">Project tokens / {{ componentTokens.length }}</span>
                <p>Try the real design tokens without editing source files.</p>
              </div>

              <div
                v-for="token in componentTokens"
                :key="token.name"
                class="token-row"
              >
                <div class="token-swatch" :style="{ background: tokenValue(token) }" />
                <div>
                  <strong>--{{ token.name }}</strong>
                  <small>{{ token.kind }} · {{ token.sourcePath }}</small>
                </div>
                <input
                  v-if="token.kind === 'color' && tokenValue(token).startsWith('#')"
                  type="color"
                  :value="tokenValue(token)"
                  @input="updateTokenFromEvent(token, $event)"
                >
                <input
                  v-else
                  type="text"
                  :value="tokenValue(token)"
                  @input="updateTokenFromEvent(token, $event)"
                >
              </div>
              <div class="background-control">
                <div>
                  <strong>Canvas background</strong>
                  <small>Environment only; not saved as a component token.</small>
                </div>
                <input v-model="background" type="color">
              </div>
            </section>

            <section v-else class="contract-panel">
              <div class="inspector-intro">
                <span class="eyebrow">Agent contract / JSON</span>
                <p>The same state is exposed through CLI and MCP.</p>
              </div>
              <pre>{{ agentContract }}</pre>
              <button class="copy-contract" @click="copyContract">
                {{ copyState === "copied" ? "Copied to clipboard" : "Copy contract" }}
              </button>
            </section>

            <section class="scenario-save">
              <label for="scenario-name">Scenario name</label>
              <div>
                <input id="scenario-name" v-model="scenarioName" type="text">
                <button :disabled="saveState === 'saving'" @click="saveScenario">
                  {{
                    saveState === "saving"
                      ? "Saving…"
                      : saveState === "saved"
                        ? "Saved"
                        : saveState === "error"
                          ? "Retry"
                          : "Save state"
                  }}
                </button>
              </div>
              <small :class="{ error: saveState === 'error' }">
                {{
                  saveState === "error"
                    ? saveMessage
                    : "Human preview and agent contract stay in sync."
                }}
              </small>
            </section>
          </template>

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
      <p>Surveying the component terrain…</p>
    </div>
  </main>
</template>
