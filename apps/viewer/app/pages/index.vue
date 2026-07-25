<script setup lang="ts">
import type { ComponentGraph } from "@component-atlas/core/browser";
import type { DesignFileIndex } from "@component-atlas/design";
import type { MemoryItem, MemoryProposal } from "@component-atlas/memory";
import type {
  ProjectAtlasEnvelope,
  ProjectOverviewViewModel,
  ProjectSearchResultViewModel,
  ProjectSearchViewModel,
} from "@component-atlas/runtime";

type AvailableSection =
  | "overview"
  | "code"
  | "design"
  | "memory"
  | "risks"
  | "task"
  | "inbox"
  | "health"
  | "settings";

interface ProjectRisk {
  id: string;
  level: "decision-required" | "warning" | "resolved";
  kind: string;
  title: string;
  evidence: string[];
  recommendation: string;
  memoryIds: string[];
}

interface WorkspaceSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  designIndexes: DesignFileIndex[];
  memoryItems: MemoryItem[];
  memoryProposals: MemoryProposal[];
  risks: ProjectRisk[];
}

const {
  data: overview,
  error: overviewError,
  refresh: refreshOverview,
} = await useFetch<ProjectAtlasEnvelope<ProjectOverviewViewModel>>(
  "/api/overview",
);
const {
  data: graph,
  error: graphError,
  refresh: refreshGraph,
} = await useFetch<ComponentGraph>("/api/graph");
const {
  data: workspace,
  error: workspaceError,
  refresh: refreshWorkspace,
} = await useFetch<WorkspaceSnapshot>("/api/workspace");

const activeSection = ref<AvailableSection>("overview");
const selectedComponentId = ref<string>();
const selectedDesignNodeId = ref<string>();
const selectedMemoryItemId = ref<string>();
const searchQuery = ref("");
const searchResults = ref<ProjectSearchViewModel>();
const searchPending = ref(false);
const searchError = ref("");
const searchOpen = ref(false);
const searchInput = ref<HTMLInputElement>();
const preferences = ref({
  budgetChars: 3_600,
  topK: 5,
  includeInactive: false,
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const navigation = computed(() => [
  {
    id: "overview",
    code: "OV",
    label: "Overview",
    count: overview.value?.data.counts.warnings ?? 0,
    available: true,
  },
  {
    id: "code",
    code: "CO",
    label: "Code Atlas",
    count: overview.value?.data.counts.components ?? 0,
    available: true,
  },
  {
    id: "design",
    code: "DE",
    label: "Design Atlas",
    count: overview.value?.data.counts.designNodes ?? 0,
    available: true,
  },
  {
    id: "memory",
    code: "ME",
    label: "Project Memory",
    count: overview.value?.data.counts.memoryItems ?? 0,
    available: true,
  },
  {
    id: "risks",
    code: "DR",
    label: "Decisions & risks",
    count: overview.value?.data.counts.warnings ?? 0,
    available: true,
  },
  {
    id: "task",
    code: "TC",
    label: "Task Context",
    available: true,
  },
  {
    id: "inbox",
    code: "MI",
    label: "Memory Inbox",
    count: overview.value?.data.counts.pendingMemoryProposals ?? 0,
    available: true,
  },
  {
    id: "health",
    code: "IH",
    label: "Integrations & health",
    available: true,
  },
  {
    id: "settings",
    code: "ST",
    label: "Settings",
    available: true,
  },
]);

const fatalError = computed(
  () => overviewError.value ?? graphError.value ?? workspaceError.value,
);

const statusSummary = computed(() => {
  const sources = overview.value?.data.sources ?? [];
  const problems = sources.filter((source) =>
    ["stale", "error", "permission-required"].includes(source.status),
  );
  if (problems.length > 0) {
    return { label: `${problems.length} sources need review`, tone: "warning" };
  }
  return { label: "Local indexes operational", tone: "healthy" };
});

const resultGroups = computed(() => {
  const results = searchResults.value?.results ?? [];
  return ["code", "design", "memory"].map((source) => ({
    source,
    results: results.filter((result) => result.source === source),
  }));
});

watch(searchQuery, (query) => {
  if (searchTimer) clearTimeout(searchTimer);
  const trimmed = query.trim();
  if (!trimmed) {
    searchResults.value = undefined;
    searchPending.value = false;
    searchError.value = "";
    return;
  }
  searchPending.value = true;
  searchError.value = "";
  searchTimer = setTimeout(async () => {
    try {
      searchResults.value = await $fetch<ProjectSearchViewModel>(
        `/api/search?q=${encodeURIComponent(trimmed)}`,
      );
    } catch (caught) {
      searchResults.value = undefined;
      searchError.value =
        caught instanceof Error ? caught.message : "Local search failed.";
    } finally {
      searchPending.value = false;
    }
  }, 180);
});

function selectSection(section: string): void {
  if (
    [
      "overview",
      "code",
      "design",
      "memory",
      "risks",
      "task",
      "inbox",
      "health",
      "settings",
    ].includes(section)
  ) {
    activeSection.value = section as AvailableSection;
  }
}

function selectSearchResult(result: ProjectSearchResultViewModel): void {
  if (result.target.section === "code") {
    activeSection.value = "code";
    selectedComponentId.value = result.target.id;
  } else if (result.target.section === "design") {
    activeSection.value = "design";
    selectedDesignNodeId.value = result.target.id;
  } else {
    activeSection.value = "memory";
    selectedMemoryItemId.value = result.target.id;
  }
  searchOpen.value = false;
}

function formatDate(value: string | undefined): string {
  if (!value) return "not indexed";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sourceCode(source: string): string {
  return source === "repository" ? "CO" : source === "figma" ? "DE" : "ME";
}

function sourceLabel(source: string): string {
  return source === "repository"
    ? "Code"
    : source === "figma"
      ? "Design"
      : "Memory";
}

async function refreshSnapshot(): Promise<void> {
  await Promise.all([refreshOverview(), refreshGraph(), refreshWorkspace()]);
}

function handleKeyboard(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchOpen.value = true;
    nextTick(() => searchInput.value?.focus());
  }
  if (event.key === "Escape") {
    searchOpen.value = false;
    searchQuery.value = "";
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyboard);
  try {
    const stored = localStorage.getItem("project-atlas:preferences");
    if (stored) preferences.value = { ...preferences.value, ...JSON.parse(stored) };
  } catch {
    // Invalid browser-local preferences safely fall back to runtime defaults.
  }
});
watch(
  preferences,
  (value) => localStorage.setItem("project-atlas:preferences", JSON.stringify(value)),
  { deep: true },
);
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyboard);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <main class="project-shell">
    <div v-if="fatalError" class="fatal-state">
      <span class="eyebrow">Local index unavailable</span>
      <h1>Project Atlas cannot open this workspace.</h1>
      <p>{{ fatalError.message }}</p>
      <button class="primary-button" @click="refreshSnapshot()">Try again</button>
    </div>

    <template v-else-if="overview && graph && workspace">
      <aside class="atlas-rail">
        <div class="atlas-brand">
          <div class="atlas-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div class="brand-copy">
            <strong>Project Atlas</strong>
            <span>local evidence plane</span>
          </div>
        </div>

        <div class="project-identity">
          <span class="project-monogram">
            {{ overview.projectName.slice(0, 2).toUpperCase() }}
          </span>
          <div>
            <strong>{{ overview.projectName }}</strong>
            <span>{{ overview.data.project.framework }}</span>
          </div>
        </div>

        <nav class="atlas-navigation" aria-label="Project Atlas sections">
          <button
            v-for="item in navigation"
            :key="item.id"
            :class="{
              active: activeSection === item.id,
            }"
            :aria-label="`${item.label}${item.count !== undefined ? ` · ${item.count}` : ''}`"
            :title="item.label"
            @click="selectSection(item.id)"
          >
            <span class="nav-code">{{ item.code }}</span>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.count !== undefined" class="nav-count">
              {{ item.count }}
            </span>
          </button>
        </nav>

        <div class="rail-foot">
          <span class="connection-light" />
          <div>
            <strong>local only</strong>
            <span>0 agent tokens</span>
          </div>
        </div>
      </aside>

      <section class="atlas-main">
        <header class="atlas-topbar">
          <button
            class="global-search-trigger"
            aria-label="Search code, design, and memory"
            @click="searchOpen = true; nextTick(() => searchInput?.focus())"
          >
            <span aria-hidden="true">⌕</span>
            <span>Search code, design, memory…</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div class="topbar-state">
            <span :class="['state-light', statusSummary.tone]" />
            <span>{{ statusSummary.label }}</span>
          </div>

          <button
            class="icon-action"
            title="Refresh local snapshot"
            aria-label="Refresh local snapshot"
            @click="refreshSnapshot()"
          >
            ↻
          </button>
        </header>

        <section v-if="activeSection === 'overview'" class="overview-view">
          <header class="view-heading">
            <div>
              <span class="eyebrow">Project state / local snapshot</span>
              <h1>Evidence before implementation</h1>
              <p>
                Code, design, and memory stay browsable here without entering an
                agent context.
              </p>
            </div>
            <button class="secondary-button" @click="activeSection = 'code'">
              Open Code Atlas <span>→</span>
            </button>
          </header>

          <section class="metric-strip" aria-label="Project Atlas counts">
            <div>
              <span>CO</span>
              <strong>{{ overview.data.counts.components }}</strong>
              <small>components</small>
            </div>
            <div>
              <span>DE</span>
              <strong>{{ overview.data.counts.designNodes }}</strong>
              <small>design nodes</small>
            </div>
            <div>
              <span>ME</span>
              <strong>{{ overview.data.counts.memoryItems }}</strong>
              <small>memory items</small>
            </div>
            <div :class="{ alert: overview.data.counts.warnings > 0 }">
              <span>DR</span>
              <strong>{{ overview.data.counts.warnings }}</strong>
              <small>risks to review</small>
            </div>
            <div>
              <span>MI</span>
              <strong>{{ overview.data.counts.pendingMemoryProposals }}</strong>
              <small>pending proposals</small>
            </div>
          </section>

          <div class="overview-grid">
            <section class="evidence-board layer-board">
              <header class="board-heading">
                <div>
                  <span class="eyebrow">Source plane</span>
                  <h2>Atlas layers</h2>
                </div>
                <span>{{ overview.data.sources.length }} sources</span>
              </header>

              <div class="layer-table">
                <div
                  v-for="source in overview.data.sources"
                  :key="source.id"
                  class="layer-row"
                >
                  <span class="layer-code">{{ sourceCode(source.source) }}</span>
                  <div class="layer-name">
                    <strong>{{ source.label }}</strong>
                    <span>{{ source.detail }}</span>
                  </div>
                  <div class="freshness">
                    <span :class="['state-light', source.status]" />
                    <strong>{{ source.status }}</strong>
                    <span>{{ formatDate(source.lastIndexedAt) }}</span>
                  </div>
                </div>
              </div>
            </section>

            <section class="evidence-board attention-board">
              <header class="board-heading">
                <div>
                  <span class="eyebrow">Decision gate</span>
                  <h2>Attention queue</h2>
                </div>
                <span>{{ overview.data.attention.length }} findings</span>
              </header>

              <div v-if="overview.data.attention.length" class="attention-list">
                <article
                  v-for="item in overview.data.attention"
                  :key="item.id"
                  :class="['attention-item', item.severity]"
                >
                  <span class="finding-mark" />
                  <div>
                    <span>{{ item.source }} · {{ item.severity }}</span>
                    <strong>{{ item.title }}</strong>
                    <p>{{ item.detail }}</p>
                    <small>{{ item.recommendation }}</small>
                  </div>
                </article>
              </div>
              <div v-else class="clear-state">
                <span class="clear-glyph">✓</span>
                <div>
                  <strong>No indexed conflicts require attention</strong>
                  <p>
                    The gate will surface contradictions, stale knowledge, and
                    failed attempts when evidence exists.
                  </p>
                </div>
              </div>
            </section>

            <section class="evidence-board activity-board">
              <header class="board-heading">
                <div>
                  <span class="eyebrow">Provenance timeline</span>
                  <h2>Recent evidence</h2>
                </div>
                <span>freshness visible</span>
              </header>

              <div class="activity-list">
                <div
                  v-for="change in overview.data.recentChanges"
                  :key="change.id"
                  class="activity-row"
                >
                  <span class="activity-code">
                    {{ sourceCode(change.source) }}
                  </span>
                  <span class="activity-line" />
                  <div>
                    <strong>{{ change.label }}</strong>
                    <span>
                      {{ sourceLabel(change.source) }} ·
                      {{ formatDate(change.occurredAt) }}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section class="context-contract">
              <div>
                <span class="eyebrow">Context contract</span>
                <h2>Browse broadly. Send narrowly.</h2>
                <p>
                  This interface reads local indexes only. Agent packages remain
                  hard-capped and require an explicit review step.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Human browsing</dt>
                  <dd>0 tokens</dd>
                </div>
                <div>
                  <dt>Default agent cap</dt>
                  <dd>~900 tokens</dd>
                </div>
                <div>
                  <dt>Automatic writes</dt>
                  <dd>derived facts only</dd>
                </div>
                <div>
                  <dt>Durable memory</dt>
                  <dd>explicit approval</dd>
                </div>
              </dl>
            </section>
          </div>

          <footer class="provenance-foot">
            <span>Snapshot {{ formatDate(overview.generatedAt) }}</span>
            <code>{{ overview.data.project.rootPath }}</code>
          </footer>
        </section>

        <section v-else-if="activeSection === 'code'" class="code-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Code Atlas / repository evidence</span>
              <h1>Structure, reuse, and impact</h1>
            </div>
            <div class="compact-meta">
              <span>{{ graph.components.length }} components</span>
              <span>{{ graph.edges.length }} relations</span>
              <span>{{ overview.data.project.framework }}</span>
            </div>
          </header>
          <LazyCodeAtlasView
            :graph="graph"
            :initial-component-id="selectedComponentId"
          />
        </section>

        <section v-else-if="activeSection === 'design'" class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Design Atlas / sparse Figma evidence</span>
              <h1>Structure, status, tokens, and code links</h1>
            </div>
            <div class="compact-meta">
              <span>{{ workspace.designIndexes.length }} files</span>
              <span>{{ overview.data.counts.designNodes }} nodes</span>
              <span>Ready for dev is a signal</span>
            </div>
          </header>
          <LazyDesignAtlasView
            :indexes="workspace.designIndexes"
            :initial-node-id="selectedDesignNodeId"
          />
        </section>

        <section v-else-if="activeSection === 'memory'" class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Project Memory / declared knowledge</span>
              <h1>Decisions, conventions, attempts, and outcomes</h1>
            </div>
            <div class="compact-meta">
              <span>{{ workspace.memoryItems.length }} items</span>
              <span>Markdown + SQLite</span>
              <span>scoped to this project</span>
            </div>
          </header>
          <LazyProjectMemoryView
            :items="workspace.memoryItems"
            :initial-item-id="selectedMemoryItemId"
            :include-inactive="preferences.includeInactive"
          />
        </section>

        <section v-else-if="activeSection === 'risks'" class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Decisions & risks / uncertainty gate</span>
              <h1>Contradictions and fragile evidence</h1>
            </div>
            <div class="compact-meta">
              <span>{{ workspace.risks.filter((item) => item.level !== "resolved").length }} open</span>
              <span>{{ workspace.risks.filter((item) => item.level === "resolved").length }} resolved</span>
            </div>
          </header>
          <LazyRisksView :risks="workspace.risks" />
        </section>

        <section v-else-if="activeSection === 'task'" class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Task Context / bounded retrieval</span>
              <h1>One task, only the evidence it needs</h1>
            </div>
            <div class="compact-meta">
              <span>hard cap {{ preferences.budgetChars.toLocaleString() }} chars</span>
              <span>explicit generation</span>
            </div>
          </header>
          <LazyTaskContextView
            :design-indexes="workspace.designIndexes"
            :default-budget="preferences.budgetChars"
            :default-top-k="preferences.topK"
          />
        </section>

        <section v-else-if="activeSection === 'inbox'" class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Memory Inbox / semantic write control</span>
              <h1>Review what agents learned</h1>
            </div>
            <div class="compact-meta">
              <span>{{ workspace.memoryProposals.filter((item) => item.status === "pending").length }} pending</span>
              <span>explicit approval</span>
            </div>
          </header>
          <LazyMemoryInboxView
            :proposals="workspace.memoryProposals"
            @changed="refreshSnapshot"
          />
        </section>

        <section v-else-if="activeSection === 'health'" class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Integrations & health / source control</span>
              <h1>Know what Atlas can trust</h1>
            </div>
            <div class="compact-meta">
              <span>local-first</span>
              <span>optional connectors</span>
            </div>
          </header>
          <LazyHealthView
            :sources="overview.data.sources"
            :root-path="overview.data.project.rootPath"
            @refreshed="refreshSnapshot"
          />
        </section>

        <section v-else class="section-view">
          <header class="compact-heading">
            <div>
              <span class="eyebrow">Settings / retrieval policy</span>
              <h1>Budgets, scope, and privacy</h1>
            </div>
            <div class="compact-meta">
              <span>browser-local preferences</span>
              <span>runtime-enforced safety</span>
            </div>
          </header>
          <LazySettingsView v-model="preferences" />
        </section>
      </section>

      <div
        v-if="searchOpen"
        class="search-backdrop"
        role="presentation"
        @click.self="searchOpen = false"
      >
        <section
          class="search-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Search Project Atlas"
        >
          <label class="palette-input">
            <span aria-hidden="true">⌕</span>
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="search"
              autocomplete="off"
              placeholder="Search an area, component, decision, or frame"
              aria-label="Search Project Atlas"
            >
            <kbd>Esc</kbd>
          </label>

          <div class="palette-body">
            <div v-if="searchPending" class="palette-state">
              <span class="mini-loader" />
              Searching local indexes…
            </div>
            <div v-else-if="searchError" class="palette-state error">
              {{ searchError }}
            </div>
            <div v-else-if="!searchQuery.trim()" class="palette-empty">
              <span>Project-wide retrieval</span>
              <p>
                Search component APIs, design nodes, decisions, conventions, and
                prior outcomes. Nothing is sent to an agent.
              </p>
              <div>
                <span>CO code</span>
                <span>DE design</span>
                <span>ME memory</span>
              </div>
            </div>
            <template v-else-if="searchResults?.results.length">
              <div
                v-for="group in resultGroups"
                :key="group.source"
                class="result-group"
              >
                <header v-if="group.results.length">
                  <span>{{ group.source }}</span>
                  <small>{{ group.results.length }}</small>
                </header>
                <button
                  v-for="result in group.results"
                  :key="`${result.source}:${result.id}`"
                  class="search-result"
                  @click="selectSearchResult(result)"
                >
                  <span class="result-source">
                    {{ result.source.slice(0, 2).toUpperCase() }}
                  </span>
                  <span class="result-copy">
                    <strong>{{ result.title }}</strong>
                    <small>{{ result.subtitle }}</small>
                    <em>{{ result.reasons.slice(0, 2).join(" · ") }}</em>
                  </span>
                  <span class="result-status">
                    {{ result.status ?? result.kind }}
                  </span>
                </button>
              </div>
            </template>
            <div v-else class="palette-state">
              No indexed evidence matches “{{ searchQuery }}”.
            </div>
          </div>

          <footer class="palette-foot">
            <span>{{ searchResults?.totalMatches ?? 0 }} local results</span>
            <span>Open any result in its evidence section</span>
          </footer>
        </section>
      </div>
    </template>

    <div v-else class="loading-state">
      <div class="loader" />
      <p>Loading the local evidence plane…</p>
    </div>
  </main>
</template>
