<script setup lang="ts">
import type {
  ActionResolution,
  ComponentGraph,
  AgentRunAuditRecord,
  ProjectCapabilityReport,
  TaskEvaluationRecord,
} from "@component-atlas/core/browser";
import type { DesignFileIndex } from "@component-atlas/design";
import type { MemoryItem, MemoryProposal } from "@component-atlas/memory";
import type {
  ProjectAtlasEnvelope,
  ProjectOverviewViewModel,
  ProjectSearchResultViewModel,
  ProjectSearchViewModel,
} from "@component-atlas/runtime";
import type { AgentAdapterStatus } from "@component-atlas/agent";
import type { AtlasIconName } from "~/components/AtlasIcon.vue";
import {
  chooseDesktopProjectFolder,
  desktopFolderPicker,
  projectPathFromDrop,
  type AtlasDesktopFolderPicker,
} from "~/utils/folder-picker";

type AvailableSection =
  | "home"
  | "code"
  | "design"
  | "memory"
  | "task"
  | "decisions"
  | "inbox"
  | "connections"
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

interface FigmaSyncState {
  status:
    | "idle"
    | "confirmed-unsynced"
    | "loading"
    | "available"
    | "error";
  message: string;
}

interface NavigationGroup {
  label: string;
  items: Array<{
    id: AvailableSection;
    icon: AtlasIconName;
    label: string;
    hint: string;
    count?: number;
  }>;
}

interface ProjectsResponse {
  activeRoot?: string;
  projects: Array<{
    rootPath: string;
    name: string;
    lastOpenedAt: string;
    available: boolean;
  }>;
}

interface WorkspaceSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  fingerprint: string;
  graph: ComponentGraph;
  overview: ProjectAtlasEnvelope<ProjectOverviewViewModel>;
  designIndexes: DesignFileIndex[];
  memoryItems: MemoryItem[];
  memoryProposals: MemoryProposal[];
  capabilities: ProjectCapabilityReport;
  agent: AgentAdapterStatus;
  evaluations: TaskEvaluationRecord[];
  agentRuns: AgentRunAuditRecord[];
  actionResolutions: ActionResolution[];
  actionCenterCounts: {
    materialBlockers: number;
    open: number;
    stale: number;
  };
  git: {
    branch?: string;
    head?: string;
    dirty: boolean;
    changedFiles: number;
    stagedFiles: number;
    untrackedFiles: number;
    checkedAt: string;
  };
  currentDecisions: Array<{
    id: string;
    type: MemoryItem["type"] | "component-reuse";
    title: string;
    summary: string;
    status: string;
    provenance: "code-atlas" | "project-memory";
    updatedAt: string;
  }>;
  localHealth: Array<{
    id: string;
    level: "warning";
    title: string;
    detail: string;
    recommendation: string;
  }>;
  risks: ProjectRisk[];
}

const {
  data: workspace,
  error: workspaceError,
  refresh: refreshWorkspace,
} = await useFetch<WorkspaceSnapshot>("/api/workspace");
const {
  data: projects,
  refresh: refreshProjects,
} = await useFetch<ProjectsResponse>("/api/projects");

const overview = computed(() => workspace.value?.overview);
const graph = computed(() => workspace.value?.graph);
const activeRoot = computed(() => overview.value?.data.project.rootPath ?? "");
const otherRecentProjects = computed(
  () =>
    projects.value?.projects
      .filter((project) => project.rootPath !== activeRoot.value)
      .slice(0, 4) ?? [],
);
const activeSection = ref<AvailableSection>("home");
const navCollapsed = ref(false);
const projectMenuOpen = ref(false);
const projectPath = ref("");
const projectSwitchPending = ref(false);
const projectSwitchError = ref("");
const folderPicker = shallowRef<AtlasDesktopFolderPicker>();
const folderPickerPending = ref(false);
const folderDropActive = ref(false);
const launcherBrowse = ref<HTMLButtonElement>();
const popoverBrowse = ref<HTMLButtonElement>();
const selectedComponentId = ref<string>();
const selectedDesignNodeId = ref<string>();
const selectedMemoryItemId = ref<string>();
const pinnedHandles = ref<string[]>([]);
const taskSeed = ref("");
const designSyncState = ref<FigmaSyncState>({
  status: "idle",
  message: "No Figma source confirmed for this task.",
});
const searchQuery = ref("");
const searchResults = ref<ProjectSearchViewModel>();
const searchPending = ref(false);
const searchError = ref("");
const searchOpen = ref(false);
const searchInput = ref<HTMLInputElement>();
const localAction = ref("");
const localActionMessage = ref("");
const localActionError = ref("");
const preferences = ref({
  budgetChars: 3_600,
  topK: 5,
  includeInactive: false,
  localMetrics: false,
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let workspaceRefreshPending = false;
let workspaceRefreshQueued = false;

const navigationGroups = computed<NavigationGroup[]>(() => [
  {
    label: "Project",
    items: [
      {
        id: "home",
        icon: "home",
        label: "Home",
        hint: "Project state and continuation",
      },
    ],
  },
  {
    label: "Explore",
    items: [
      {
        id: "code",
        icon: "code",
        label: "Code",
        hint: `${overview.value?.data.counts.components ?? 0} components`,
      },
      {
        id: "design",
        icon: "design",
        label: "Design",
        hint: `${overview.value?.data.counts.designNodes ?? 0} nodes`,
      },
      {
        id: "memory",
        icon: "memory",
        label: "Memory",
        hint: `${overview.value?.data.counts.memoryItems ?? 0} items`,
      },
    ],
  },
  {
    label: "Work",
    items: [
      {
        id: "task",
        icon: "task",
        label: "Task Workbench",
        hint: "Prepare, run, continue",
      },
    ],
  },
  {
    label: "Review",
    items: [
      {
        id: "decisions",
        icon: "risk",
        label: "Action Center",
        count: workspace.value?.actionCenterCounts.open,
        hint: "Decisions, risks, and warnings",
      },
      {
        id: "inbox",
        icon: "inbox",
        label: "Memory Inbox",
        count: overview.value?.data.counts.pendingMemoryProposals,
        hint: "Review semantic changes",
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        id: "connections",
        icon: "plug",
        label: "Connections",
        hint: "Sources and capabilities",
      },
      {
        id: "settings",
        icon: "settings",
        label: "Settings",
        hint: "Budgets and privacy",
      },
    ],
  },
]);

const resultGroups = computed(() => {
  const results = searchResults.value?.results ?? [];
  return ["code", "design", "memory"].map((source) => ({
    source,
    results: results.filter((result) => result.source === source),
  }));
});

const openRisks = computed(
  () => workspace.value?.risks.filter((item) => item.level !== "resolved") ?? [],
);

const attentionQueue = computed(() => {
  if (!workspace.value || !overview.value) return [];
  const items: Array<{
    id: string;
    tone: "decision" | "warning" | "local";
    title: string;
    detail: string;
    action: string;
    section: AvailableSection;
  }> = [];
  for (const risk of openRisks.value.slice(0, 3)) {
    items.push({
      id: risk.id,
      tone: risk.level === "decision-required" ? "decision" : "warning",
      title: risk.title,
      detail: risk.recommendation,
      action: "Review evidence",
      section: "decisions",
    });
  }
  const pending = workspace.value.memoryProposals.filter(
    (item) => item.status === "pending",
  ).length;
  if (pending > 0) {
    items.push({
      id: "pending-memory",
      tone: "decision",
      title: `${pending} memory proposal${pending === 1 ? "" : "s"} need review`,
      detail: "Nothing becomes durable knowledge without a human decision.",
      action: "Open Memory Inbox",
      section: "inbox",
    });
  }
  if (workspace.value.git.dirty) {
    items.push({
      id: "dirty-checkout",
      tone: "local",
      title: `${workspace.value.git.changedFiles} changed file${workspace.value.git.changedFiles === 1 ? "" : "s"} in this checkout`,
      detail: "Task continuation will preserve and reason about this diff.",
      action: "Continue in Workbench",
      section: "task",
    });
  }
  return items.slice(0, 5);
});

const sourceProblems = computed(
  () =>
    overview.value?.data.sources.filter((source) =>
      ["stale", "error", "permission-required"].includes(source.status),
    ) ?? [],
);

const statusSummary = computed(() => {
  if (sourceProblems.value.length > 0) {
    return {
      label: `${sourceProblems.value.length} source${sourceProblems.value.length === 1 ? "" : "s"} need attention`,
      tone: "warning",
    };
  }
  return { label: "Local evidence ready", tone: "healthy" };
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
  const available: AvailableSection[] = [
    "home",
    "code",
    "design",
    "memory",
    "task",
    "decisions",
    "inbox",
    "connections",
    "settings",
  ];
  if (available.includes(section as AvailableSection)) {
    activeSection.value = section as AvailableSection;
    projectMenuOpen.value = false;
    searchOpen.value = false;
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

function pinSearchResult(result: ProjectSearchResultViewModel): void {
  const handle = `${result.source}:${result.target.id}`;
  if (!pinnedHandles.value.includes(handle)) pinnedHandles.value.push(handle);
  taskSeed.value = searchQuery.value.trim();
  activeSection.value = "task";
  searchOpen.value = false;
}

function useEvidenceInTask(handle: string, intent: string): void {
  if (!pinnedHandles.value.includes(handle)) {
    pinnedHandles.value = [...pinnedHandles.value, handle];
  }
  taskSeed.value = intent;
  activeSection.value = "task";
}

function prepareTask(intent: string): void {
  taskSeed.value = intent;
  activeSection.value = "task";
}

function prepareActionTask(payload: { intent: string; handles: string[] }): void {
  taskSeed.value = payload.intent;
  pinnedHandles.value = [
    ...new Set([...pinnedHandles.value, ...payload.handles]),
  ].slice(0, 8);
  activeSection.value = "task";
}

function openActionEvidence(handle: string): void {
  const [source, ...segments] = handle.split(":");
  if (source === "code") {
    selectedComponentId.value = segments.join(":");
    activeSection.value = "code";
  } else if (source === "design") {
    selectedDesignNodeId.value = segments.at(-1);
    activeSection.value = "design";
  } else if (source === "memory") {
    selectedMemoryItemId.value = segments.join(":");
    activeSection.value = "memory";
  } else if (source === "integration") {
    activeSection.value = "connections";
  } else {
    activeSection.value = "task";
  }
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

function sourceIcon(source: string): AtlasIconName {
  return source === "repository" || source === "code"
    ? "code"
    : source === "figma" || source === "design"
      ? "design"
      : "memory";
}

async function activateProject(rootPath = projectPath.value): Promise<void> {
  const candidate = rootPath.trim();
  if (!candidate || projectSwitchPending.value) return;
  projectSwitchPending.value = true;
  projectSwitchError.value = "";
  try {
    const session = await $fetch<{ token: string }>("/api/agent/session");
    await $fetch("/api/projects/activate", {
      method: "POST",
      headers: { "x-atlas-session": session.token },
      body: { rootPath: candidate },
    });
    projectPath.value = "";
    projectMenuOpen.value = false;
    activeSection.value = "home";
    selectedComponentId.value = undefined;
    selectedDesignNodeId.value = undefined;
    selectedMemoryItemId.value = undefined;
    pinnedHandles.value = [];
    await Promise.all([refreshProjects(), refreshWorkspace()]);
  } catch (caught) {
    projectSwitchError.value =
      caught instanceof Error ? caught.message : "Project Atlas could not open that folder.";
  } finally {
    projectSwitchPending.value = false;
  }
}

async function browseForProject(trigger: HTMLButtonElement | undefined): Promise<void> {
  if (folderPickerPending.value) return;
  folderPickerPending.value = true;
  projectSwitchError.value = "";
  try {
    let selectedPath: string | undefined;
    if (folderPicker.value) {
      selectedPath = await chooseDesktopProjectFolder(folderPicker.value);
    } else {
      const session = await $fetch<{ token: string }>("/api/agent/session");
      const result = await $fetch<{
        status: "selected" | "cancelled";
        absolutePath?: string;
      }>("/api/projects/select-directory", {
        method: "POST",
        headers: { "x-atlas-session": session.token },
      });
      selectedPath =
        result.status === "selected" ? result.absolutePath : undefined;
    }
    if (selectedPath) projectPath.value = selectedPath;
  } catch (caught) {
    projectSwitchError.value =
      caught instanceof Error ? caught.message : "The folder picker failed.";
  } finally {
    folderPickerPending.value = false;
    nextTick(() => trigger?.focus());
  }
}

function handleProjectDragLeave(event: DragEvent): void {
  const current = event.currentTarget as HTMLElement | null;
  if (
    current &&
    event.relatedTarget instanceof Node &&
    current.contains(event.relatedTarget)
  ) {
    return;
  }
  folderDropActive.value = false;
}

function handleProjectDrop(event: DragEvent): void {
  folderDropActive.value = false;
  if (!event.dataTransfer) return;
  const droppedPath = projectPathFromDrop(event.dataTransfer);
  if (droppedPath) {
    projectPath.value = droppedPath;
    projectSwitchError.value = "";
    return;
  }
  projectSwitchError.value =
    "This browser hid the dropped folder path. Use Choose folder instead.";
}

async function refreshSnapshot(): Promise<void> {
  if (workspaceRefreshPending) {
    workspaceRefreshQueued = true;
    return;
  }
  workspaceRefreshPending = true;
  try {
    do {
      workspaceRefreshQueued = false;
      await refreshWorkspace();
    } while (workspaceRefreshQueued);
  } finally {
    workspaceRefreshPending = false;
  }
}

async function clearLocalMetrics(): Promise<void> {
  const session = await $fetch<{ token: string }>("/api/agent/session");
  await $fetch("/api/evaluations", {
    method: "DELETE",
    headers: { "x-atlas-session": session.token },
  });
  await refreshWorkspace();
}

async function runLocalAction(source: "repository" | "memory"): Promise<void> {
  localAction.value = source;
  localActionMessage.value = "";
  localActionError.value = "";
  try {
    const session = await $fetch<{ token: string }>("/api/agent/session");
    await $fetch("/api/refresh", {
      method: "POST",
      headers: { "x-atlas-session": session.token },
      body: { source },
    });
    localActionMessage.value =
      source === "repository"
        ? "Code Atlas rescanned this checkout."
        : "Project Memory reindexed approved Markdown.";
    await refreshWorkspace();
  } catch (caught) {
    localActionError.value =
      caught instanceof Error ? caught.message : "The local action failed.";
  } finally {
    localAction.value = "";
  }
}

async function copyProjectPath(): Promise<void> {
  if (!overview.value) return;
  await navigator.clipboard.writeText(overview.value.data.project.rootPath);
  localActionMessage.value = "Project path copied.";
}

function handleKeyboard(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchOpen.value = true;
    nextTick(() => searchInput.value?.focus());
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "1") {
    event.preventDefault();
    activeSection.value = "home";
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "2") {
    event.preventDefault();
    activeSection.value = "code";
  }
  if ((event.ctrlKey || event.metaKey) && event.key === "3") {
    event.preventDefault();
    activeSection.value = "task";
  }
  if (event.key === "Escape") {
    searchOpen.value = false;
    projectMenuOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyboard);
  folderPicker.value = desktopFolderPicker(window.projectAtlasDesktopHost);
  try {
    const stored = localStorage.getItem("project-atlas:preferences");
    if (stored) preferences.value = { ...preferences.value, ...JSON.parse(stored) };
    navCollapsed.value =
      localStorage.getItem("project-atlas:navigation-collapsed") === "true";
  } catch {
    // Browser-local preferences safely fall back to runtime defaults.
  }
});

watch(
  preferences,
  (value) => localStorage.setItem("project-atlas:preferences", JSON.stringify(value)),
  { deep: true },
);
watch(navCollapsed, (value) =>
  localStorage.setItem("project-atlas:navigation-collapsed", String(value)),
);

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyboard);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>

<template>
  <main :class="['desktop-shell', { 'nav-collapsed': navCollapsed }]">
    <section v-if="workspaceError" class="project-launcher">
      <header class="launcher-brand">
        <AtlasMark />
        <span><strong>Project Atlas</strong><small>Local evidence workspace</small></span>
      </header>
      <div class="launcher-content">
        <span class="eyebrow">Open a project</span>
        <h1>Start from the repository you want to understand.</h1>
        <p>
          Atlas scans locally, keeps project evidence isolated, and prepares
          compact context only when you ask an agent to help.
        </p>
        <form class="open-project-form" @submit.prevent="activateProject()">
          <label for="launcher-project-path">Project folder</label>
          <div
            class="project-folder-dropzone has-folder-picker"
            :class="{ 'is-dragging': folderDropActive }"
            @dragenter.prevent="folderDropActive = true"
            @dragover.prevent="folderDropActive = true"
            @dragleave="handleProjectDragLeave"
            @drop.prevent="handleProjectDrop"
          >
            <AtlasIcon name="folder" />
            <input
              id="launcher-project-path"
              v-model="projectPath"
              type="text"
              autocomplete="off"
              placeholder="C:\work\my-frontend"
            >
            <button
              ref="launcherBrowse"
              type="button"
              class="secondary-button browse-button"
              :disabled="folderPickerPending"
              @click="browseForProject(launcherBrowse)"
            >
              {{ folderPickerPending ? "Choosing…" : "Choose folder…" }}
            </button>
            <button class="primary-button" :disabled="projectSwitchPending">
              {{ projectSwitchPending ? "Opening…" : "Open project" }}
            </button>
          </div>
          <small>
            Choose or drop a repository folder, review its path, then open it.
            Atlas never uploads the project.
          </small>
        </form>
        <p v-if="projectSwitchError" class="inline-error">{{ projectSwitchError }}</p>
        <div v-if="projects?.projects.length" class="recent-projects">
          <header><h2>Recent projects</h2><span>Stored only on this computer</span></header>
          <button
            v-for="project in projects.projects"
            :key="project.rootPath"
            :disabled="!project.available || projectSwitchPending"
            @click="activateProject(project.rootPath)"
          >
            <AtlasIcon name="folder" />
            <span><strong>{{ project.name }}</strong><small>{{ project.rootPath }}</small></span>
            <time>{{ project.available ? formatDate(project.lastOpenedAt) : "Folder missing" }}</time>
            <AtlasIcon name="arrow-right" />
          </button>
        </div>
        <div v-else class="launcher-empty">
          <AtlasIcon name="folder" />
          <span><strong>No recent projects yet</strong><small>Open a local repository to create the first entry.</small></span>
        </div>
        <p class="launcher-diagnostic">{{ workspaceError.message }}</p>
      </div>
    </section>

    <template v-else-if="overview && graph && workspace">
      <nav class="desktop-navigator" aria-label="Project Atlas navigation">
        <div class="navigator-brand">
          <AtlasMark />
          <span><strong>Project Atlas</strong><small>Evidence workspace</small></span>
        </div>

        <div class="project-switcher-wrap">
          <button
            class="project-switcher"
            aria-haspopup="dialog"
            :aria-expanded="projectMenuOpen"
            @click="projectMenuOpen = !projectMenuOpen"
          >
            <span class="project-badge">{{ overview.projectName.slice(0, 2).toUpperCase() }}</span>
            <span>
              <strong>{{ overview.projectName }}</strong>
              <small>{{ workspace.git.branch ?? "detached" }} · {{ workspace.git.dirty ? `${workspace.git.changedFiles} changed` : "clean" }}</small>
            </span>
            <AtlasIcon name="chevron-down" />
          </button>
          <section v-if="projectMenuOpen" class="project-popover" role="dialog" aria-label="Change project">
            <header>
              <div><span class="eyebrow">Active checkout</span><strong>{{ overview.projectName }}</strong></div>
              <button class="icon-button" aria-label="Close project menu" @click="projectMenuOpen = false"><AtlasIcon name="x" /></button>
            </header>
            <code>{{ overview.data.project.rootPath }}</code>
            <div class="checkout-summary">
              <span><AtlasIcon name="branch" />{{ workspace.git.branch ?? "detached" }}</span>
              <span :class="{ warning: workspace.git.dirty }">{{ workspace.git.dirty ? `${workspace.git.changedFiles} changed files` : "Working tree clean" }}</span>
            </div>
            <div class="popover-recents">
              <span class="field-label">Recent projects</span>
              <button
                v-for="project in otherRecentProjects"
                :key="project.rootPath"
                :disabled="!project.available || projectSwitchPending"
                @click="activateProject(project.rootPath)"
              >
                <AtlasIcon name="folder" />
                <span><strong>{{ project.name }}</strong><small>{{ project.rootPath }}</small></span>
              </button>
              <p v-if="!otherRecentProjects.length">No other projects have been opened from Atlas yet.</p>
            </div>
            <form class="popover-open-project" @submit.prevent="activateProject()">
              <label for="project-path">Open another folder</label>
              <div
                class="project-folder-dropzone has-folder-picker"
                :class="{ 'is-dragging': folderDropActive }"
                @dragenter.prevent="folderDropActive = true"
                @dragover.prevent="folderDropActive = true"
                @dragleave="handleProjectDragLeave"
                @drop.prevent="handleProjectDrop"
              >
                <input id="project-path" v-model="projectPath" type="text" autocomplete="off" placeholder="Absolute project path">
                <button
                  ref="popoverBrowse"
                  type="button"
                  class="secondary-button"
                  :disabled="folderPickerPending"
                  @click="browseForProject(popoverBrowse)"
                >
                  {{ folderPickerPending ? "Choosing…" : "Choose folder…" }}
                </button>
                <button class="primary-button" :disabled="projectSwitchPending">Open</button>
              </div>
              <small>Choose or drop a repository folder, review its path, then open it.</small>
            </form>
            <p v-if="projectSwitchError" class="inline-error">{{ projectSwitchError }}</p>
            <button class="text-button" @click="copyProjectPath">Copy active path</button>
          </section>
        </div>

        <div class="navigator-scroll">
          <section v-for="group in navigationGroups" :key="group.label" class="nav-group">
            <span>{{ group.label }}</span>
            <button
              v-for="item in group.items"
              :key="item.id"
              :class="{ active: activeSection === item.id }"
              :title="item.hint"
              @click="selectSection(item.id)"
            >
              <AtlasIcon :name="item.icon" />
              <strong>{{ item.label }}</strong>
              <b v-if="item.count">{{ item.count }}</b>
            </button>
          </section>
        </div>
        <div class="navigator-foot">
          <div><span class="connection-light" /><span><strong>Local workspace</strong><small>Browsing uses 0 tokens</small></span></div>
          <button class="icon-button nav-toggle" :aria-label="navCollapsed ? 'Expand navigation' : 'Collapse navigation'" @click="navCollapsed = !navCollapsed">
            <AtlasIcon name="menu" />
          </button>
        </div>
      </nav>

      <header class="project-bar">
        <button class="global-search-trigger" aria-label="Search code, design, memory, and tasks" @click="searchOpen = true; nextTick(() => searchInput?.focus())">
          <AtlasIcon name="search" />
          <span>Search components, designs, decisions…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div class="project-context">
          <span><AtlasIcon name="branch" />{{ workspace.git.branch ?? "detached" }}</span>
          <span>{{ workspace.git.head ?? "no HEAD" }}</span>
          <span :class="['working-state', { dirty: workspace.git.dirty }]">{{ workspace.git.dirty ? `${workspace.git.changedFiles} changed` : "Clean" }}</span>
        </div>
        <button class="status-summary" @click="activeSection = 'connections'">
          <span :class="['state-light', statusSummary.tone]" />
          <span>{{ statusSummary.label }}</span>
        </button>
      </header>

      <section class="desktop-workspace">
        <section v-if="activeSection === 'home'" class="home-workspace">
          <header class="workspace-heading">
            <div>
              <span class="eyebrow">{{ overview.projectName }} / {{ workspace.git.branch ?? "detached" }}</span>
              <h1>{{ workspace.git.dirty ? "Pick up where you left off." : "Your project, oriented." }}</h1>
              <p>{{ workspace.git.dirty ? "Atlas keeps the current diff visible and prepares only the evidence affected by your next move." : "Start a task, explore what already exists, or review changes since the last scan." }}</p>
            </div>
            <button class="primary-button large" @click="activeSection = 'task'">
              <AtlasIcon name="task" />{{ workspace.git.dirty ? "Continue work" : "Prepare a task" }}
            </button>
          </header>

          <section class="continuation-band">
            <div class="continuation-copy">
              <AtlasIcon :name="workspace.git.dirty ? 'activity' : 'check'" />
              <div>
                <span class="eyebrow">Current checkout</span>
                <h2>{{ workspace.git.dirty ? `${workspace.git.changedFiles} files changed` : "Ready for the next task" }}</h2>
                <p v-if="workspace.git.dirty">{{ workspace.git.stagedFiles }} staged · {{ workspace.git.untrackedFiles }} untracked. Continue or correct without restarting the brief.</p>
                <p v-else>{{ graph.project.scan?.mode ?? "full" }} scan · {{ graph.components.length }} components · {{ graph.edges.length }} relations.</p>
              </div>
            </div>
            <button class="secondary-button" :disabled="Boolean(localAction)" @click="runLocalAction('repository')">
              <AtlasIcon name="refresh" />{{ localAction === "repository" ? "Scanning…" : "Rescan code" }}
            </button>
          </section>

          <div class="home-columns">
            <section class="home-ledger attention-ledger">
              <header><div><span class="eyebrow">Review</span><h2>Needs your attention</h2></div><span>{{ attentionQueue.length }}</span></header>
              <div v-if="attentionQueue.length" class="queue-list">
                <button v-for="item in attentionQueue" :key="item.id" @click="activeSection = item.section">
                  <AtlasIcon :name="item.tone === 'local' ? 'activity' : 'risk'" />
                  <span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
                  <AtlasIcon name="arrow-right" />
                </button>
              </div>
              <div v-else class="inline-empty">
                <AtlasIcon name="check" />
                <div><strong>Nothing is blocking the next task</strong><p>There are no unresolved decisions or recovery actions.</p></div>
              </div>
            </section>

            <section class="home-ledger changes-ledger">
              <header><div><span class="eyebrow">Recent activity</span><h2>What changed</h2></div><span>{{ formatDate(workspace.generatedAt) }}</span></header>
              <div class="change-rows">
                <article>
                  <AtlasIcon name="code" />
                  <div><strong>Code index</strong><p>{{ graph.project.scan?.mode ?? "full" }} scan · {{ graph.project.scan?.changedFiles ?? graph.project.sourceFiles }} files reconsidered</p></div>
                  <time>{{ formatDate(graph.project.scannedAt) }}</time>
                </article>
                <button @click="activeSection = 'design'">
                  <AtlasIcon name="design" />
                  <span><strong>Design map</strong><small>{{ workspace.designIndexes.length ? `${overview.data.counts.designNodes} indexed nodes` : "No design source yet" }}</small></span>
                  <AtlasIcon name="arrow-right" />
                </button>
                <button @click="activeSection = 'memory'">
                  <AtlasIcon name="memory" />
                  <span><strong>Project memory</strong><small>{{ workspace.memoryItems.length ? `${workspace.memoryItems.length} knowledge items` : "Cold start · no approved memory" }}</small></span>
                  <AtlasIcon name="arrow-right" />
                </button>
              </div>
            </section>
          </div>

          <section class="source-ribbon">
            <header><div><span class="eyebrow">Evidence health</span><h2>Sources and freshness</h2></div><button class="text-button" @click="activeSection = 'connections'">Manage connections</button></header>
            <div>
              <article v-for="source in overview.data.sources" :key="source.id">
                <AtlasIcon :name="sourceIcon(source.source)" />
                <span><strong>{{ source.label }}</strong><small>{{ source.detail }}</small></span>
                <em :class="source.status">{{ source.status }}</em>
                <time>{{ formatDate(source.lastIndexedAt) }}</time>
              </article>
            </div>
          </section>
          <p v-if="localActionMessage" class="inline-success">{{ localActionMessage }}</p>
          <p v-if="localActionError" class="inline-error">{{ localActionError }}</p>
        </section>

        <section v-else-if="activeSection === 'code'" class="section-workspace code-section">
          <header class="workspace-heading compact"><div><span class="eyebrow">Explore / Code</span><h1>What can I reuse, change, or test?</h1><p>Navigate exact consumers separately from explainable similarity.</p></div><button class="secondary-button" :disabled="Boolean(localAction)" @click="runLocalAction('repository')"><AtlasIcon name="refresh" />Rescan code</button></header>
          <LazyCodeAtlasView :graph="graph" :initial-component-id="selectedComponentId" @use-in-task="useEvidenceInTask" />
        </section>

        <section v-else-if="activeSection === 'design'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">Explore / Design</span><h1>Where does this flow live?</h1><p>Orient by file, flow, state, and variant before loading deep design context.</p></div><span class="heading-count">{{ overview.data.counts.designNodes }} indexed nodes</span></header>
          <LazyDesignAtlasView :indexes="workspace.designIndexes" :initial-node-id="selectedDesignNodeId" :sync-state="designSyncState" @use-in-task="useEvidenceInTask" @prepare-task="prepareTask" />
        </section>

        <section v-else-if="activeSection === 'memory'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">Explore / Memory</span><h1>What has this project learned?</h1><p>Trace decisions, conventions, outcomes, authority, and freshness.</p></div><button class="secondary-button" :disabled="Boolean(localAction)" @click="runLocalAction('memory')"><AtlasIcon name="refresh" />Reindex memory</button></header>
          <LazyProjectMemoryView :items="workspace.memoryItems" :initial-item-id="selectedMemoryItemId" :include-inactive="preferences.includeInactive" @use-in-task="useEvidenceInTask" @prepare-task="prepareTask" />
        </section>

        <section v-else-if="activeSection === 'task'" class="section-workspace task-section">
          <header class="workspace-heading compact"><div><span class="eyebrow">Work / Task Workbench</span><h1>Prepare the next move.</h1><p>Describe the outcome first. Sources and context controls appear only when useful.</p></div><span :class="['heading-count', { warning: workspace.git.dirty }]">{{ workspace.git.dirty ? `${workspace.git.changedFiles} changed` : "Clean checkout" }}</span></header>
          <LazyTaskWorkbenchView :design-indexes="workspace.designIndexes" :capabilities="workspace.capabilities" :workspace-fingerprint="workspace.fingerprint" :project-name="overview.projectName" :project-root="overview.data.project.rootPath" :identity="graph.project.identity" :default-budget="preferences.budgetChars" :default-top-k="preferences.topK" :initial-task="taskSeed" :pinned-handles="pinnedHandles" :local-metrics-enabled="preferences.localMetrics" :recent-runs="workspace.agentRuns" :recent-actions="workspace.actionResolutions" @update-task="taskSeed = $event" @workspace-changed="refreshSnapshot" @figma-sync-state="designSyncState = $event" />
        </section>

        <section v-else-if="activeSection === 'decisions'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">Review / Action Center</span><h1>What needs action, and why?</h1><p>Resolve decisions, contradictions, risks, warnings, and missing evidence without losing provenance.</p></div><span class="heading-count">{{ workspace.actionCenterCounts.open }} open</span></header>
          <LazyRisksView @prepare-task="prepareActionTask" @open-evidence="openActionEvidence" @changed="refreshSnapshot" />
        </section>

        <section v-else-if="activeSection === 'inbox'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">Review / Memory Inbox</span><h1>What should the project remember?</h1><p>Approve compact knowledge proposals, never raw transcripts.</p></div><span class="heading-count">{{ workspace.memoryProposals.filter((item) => item.status === "pending").length }} pending</span></header>
          <LazyMemoryInboxView :proposals="workspace.memoryProposals" @changed="refreshSnapshot" />
        </section>

        <section v-else-if="activeSection === 'connections'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">System / Connections</span><h1>What evidence can Atlas actually reach?</h1><p>Connector state, optional capabilities, permissions, and cached evidence remain distinct.</p></div><span class="heading-count">Local-first</span></header>
          <LazyHealthView :sources="overview.data.sources" :capabilities="workspace.capabilities" :agent="workspace.agent" :root-path="overview.data.project.rootPath" :local-health="workspace.localHealth" @refreshed="refreshSnapshot" />
        </section>

        <section v-else class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">System / Settings</span><h1>How much context may leave Atlas?</h1><p>Browsing stays complete locally; agent packages remain hard-capped and reviewable.</p></div><span class="heading-count">Local preferences</span></header>
          <LazySettingsView v-model="preferences" :evaluation-count="workspace.evaluations.length + workspace.agentRuns.length" @clear-metrics="clearLocalMetrics" />
        </section>
      </section>

      <div v-if="searchOpen" class="search-backdrop" role="presentation" @click.self="searchOpen = false">
        <section class="search-palette command-palette" role="dialog" aria-modal="true" aria-label="Search Project Atlas">
          <label class="palette-input">
            <AtlasIcon name="search" />
            <input ref="searchInput" v-model="searchQuery" type="search" autocomplete="off" placeholder="Component, consumer, test, frame, decision, or task" aria-label="Search Project Atlas">
            <kbd>Esc</kbd>
          </label>
          <div class="palette-body">
            <div v-if="searchPending" class="palette-state"><span class="mini-loader" />Searching local evidence…</div>
            <div v-else-if="searchError" class="palette-state error">{{ searchError }}</div>
            <div v-else-if="!searchQuery.trim()" class="palette-empty">
              <AtlasIcon name="search" />
              <span>Search the whole project</span>
              <p>Open indexed evidence or pin it directly to a task. Local search uses no agent tokens.</p>
              <div><span>Ctrl 1 · Home</span><span>Ctrl 2 · Code</span><span>Ctrl 3 · Workbench</span></div>
            </div>
            <template v-else-if="searchResults?.results.length">
              <div v-for="group in resultGroups" :key="group.source" class="result-group">
                <header v-if="group.results.length"><span>{{ group.source }}</span><small>{{ group.results.length }}</small></header>
                <article v-for="result in group.results" :key="`${result.source}:${result.id}`" class="search-result-row">
                  <button class="search-result" @click="selectSearchResult(result)">
                    <AtlasIcon :name="sourceIcon(result.source)" />
                    <span class="result-copy"><strong>{{ result.title }}</strong><small>{{ result.subtitle }}</small><em>{{ result.reasons.slice(0, 2).join(" · ") }}</em></span>
                    <span class="result-status">{{ result.status ?? result.kind }}</span>
                  </button>
                  <button class="pin-result" :aria-label="`Use ${result.title} in Task Workbench`" @click="pinSearchResult(result)">Use in task</button>
                </article>
              </div>
            </template>
            <div v-else class="palette-state">No indexed evidence matches “{{ searchQuery }}”.</div>
          </div>
          <footer class="palette-foot"><span>{{ searchResults?.totalMatches ?? 0 }} local results</span><span>Open evidence or use it in a task</span></footer>
        </section>
      </div>
    </template>

    <div v-else class="loading-state"><div class="loader" /><p>Opening the local evidence workspace…</p></div>
  </main>
</template>
