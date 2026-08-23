import type {
  ActionResolution,
  ComponentGraph,
  ContextCostReport,
  ProjectCapabilityReport,
  TaskEvaluationRecord,
  UsageTraceV2,
} from "@component-atlas/core/browser";
import type { DesignFileIndex } from "@component-atlas/design";
import type { MemoryItem, MemoryProposal } from "@component-atlas/memory";
import type {
  ProjectAtlasEnvelope,
  ProjectOverviewViewModel,
  ProjectSearchResultViewModel,
  ProjectSearchViewModel,
} from "@component-atlas/runtime";
import type { AtlasIconName } from "~/components/AtlasIcon.vue";
import {
  localizeSourceHealth,
  localizeWorkspaceRisk,
} from "~/i18n/generated";
import {
  chooseDesktopProjectFolder,
  desktopFolderPicker,
  projectPathFromDrop,
  type AtlasDesktopFolderPicker,
} from "~/utils/folder-picker";
import {
  branchAction,
  detachedRepositoryWorktrees,
  type ProjectRepositoryState,
} from "~/utils/project-worktrees";

export async function useAtlasWorkspacePage() {
  type AvailableSection =
    | "home"
    | "code"
    | "design"
    | "memory"
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

  interface ProjectGitState {
    branch?: string;
    head?: string;
    worktreePath?: string;
    worktreeName?: string;
    logicalProjectPath?: string;
    logicalProjectName?: string;
    isLinkedWorktree: boolean;
    dirty: boolean;
    changedFiles: number;
    stagedFiles: number;
    untrackedFiles: number;
    checkedAt: string;
  }

  interface ProjectDestinationPreview {
    rootPath: string;
    name: string;
    available: true;
    git: ProjectGitState;
    repository?: ProjectRepositoryState;
  }

  interface ProjectsResponse {
    activeRoot?: string;
    repository?: ProjectRepositoryState;
    projects: Array<{
      rootPath: string;
      name: string;
      lastOpenedAt: string;
      available: boolean;
      git?: ProjectGitState;
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
    evaluations: TaskEvaluationRecord[];
    contextCost: ContextCostReport;
    usageTraces: UsageTraceV2[];
    diffValidation: {
      files: number;
      additions: number;
      findings: Array<{
        code: string;
        severity: "warning";
        file?: string;
        line?: number;
        message: string;
        evidence: string[];
        recommendation: string;
      }>;
    };
    actionResolutions: ActionResolution[];
    actionCenterCounts: {
      materialBlockers: number;
      open: number;
      stale: number;
    };
    git: ProjectGitState;
    currentDecisions: Array<{
      id: string;
      type: MemoryItem["type"] | "component-reuse";
      title: string;
      summary: string;
      status: string;
      provenance: "code-atlas" | "project-memory";
      updatedAt: string;
    }>;
    risks: ProjectRisk[];
  }

  const nuxtApp = useNuxtApp();
  const { formatDate, locale, runtimeMessage, statusLabel, t } = useAtlasI18n();
  const {
    data: projects,
    refresh: refreshProjects,
  } = await useFetch<ProjectsResponse>("/api/projects");
  const {
    data: workspace,
    error: workspaceError,
    refresh: refreshWorkspace,
  } = await nuxtApp.runWithContext(() =>
    useFetch<WorkspaceSnapshot>("/api/workspace", {
      // An absent project is the launcher state, not a failed workspace request.
      immediate: Boolean(projects.value?.activeRoot),
      watch: false,
    }),
  );

  const overview = computed(() => workspace.value?.overview);
  const graph = computed(() => workspace.value?.graph);
  const componentNodeCount = computed(
    () =>
      graph.value?.components.filter(
        (component) => (component.kind ?? "component") === "component",
      ).length ?? 0,
  );
  const activeRoot = computed(() => overview.value?.data.project.rootPath ?? "");
  const otherRecentProjects = computed(
    () =>
      projects.value?.projects
        .filter((project) => project.rootPath !== activeRoot.value)
        .slice(0, 4) ?? [],
  );
  const unavailableRecentProjects = computed(
    () => projects.value?.projects.filter((project) => !project.available) ?? [],
  );

  function unavailableRecentProjectActionLabel(): string {
    const count = unavailableRecentProjects.value.length;
    return t(
      count === 1
        ? "Remove {count} unavailable project"
        : "Remove {count} unavailable projects",
      { count },
    );
  }
  const detachedWorktrees = computed(() =>
    detachedRepositoryWorktrees(projects.value?.repository),
  );
  const isRepositoryCheckoutPreview = computed(() => {
    const previewProjectPath =
      projectPreview.value?.repository?.logicalProjectPath ??
      projectPreview.value?.git.logicalProjectPath;
    const activeProjectPath = projects.value?.repository?.logicalProjectPath;
    return Boolean(
      previewProjectPath &&
        activeProjectPath &&
        previewProjectPath.toLowerCase() === activeProjectPath.toLowerCase(),
    );
  });
  const activeSection = ref<AvailableSection>("home");
  const navCollapsed = ref(false);
  const projectMenuOpen = ref(false);
  const projectPath = ref("");
  const projectSwitchPending = ref(false);
  const projectInspectPending = ref(false);
  const projectSwitchError = ref("");
  const recentProjectActionError = ref("");
  const recentProjectActionPending = ref("");
  const recentCleanupConfirmationOpen = ref(false);
  const projectPickerMessage = ref("");
  const projectPreview = ref<ProjectDestinationPreview>();
  const folderPicker = shallowRef<AtlasDesktopFolderPicker>();
  const folderPickerPending = ref(false);
  const folderDropActive = ref(false);
  const launcherBrowse = ref<HTMLButtonElement>();
  const popoverBrowse = ref<HTMLButtonElement>();
  const launcherScroller = ref<HTMLElement>();
  const launcherHeading = ref<HTMLElement>();
  const workspaceScroller = ref<HTMLElement>();
  const inboxHeading = ref<HTMLElement>();
  const selectedComponentId = ref<string>();
  const selectedDesignNodeId = ref<string>();
  const selectedMemoryItemId = ref<string>();
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
      label: t("Project"),
      items: [
        {
          id: "home",
          icon: "home",
          label: t("Home"),
          hint: t("Project state and continuation"),
        },
      ],
    },
    {
      label: t("Explore"),
      items: [
        {
          id: "code",
          icon: "code",
          label: t("Code"),
          hint: t(
            (overview.value?.data.counts.components ?? 0) === 1
              ? "{count} component"
              : "{count} components",
            { count: overview.value?.data.counts.components ?? 0 },
          ),
        },
        {
          id: "design",
          icon: "design",
          label: t("Design"),
          hint: t(
            (overview.value?.data.counts.designNodes ?? 0) === 1
              ? "{count} node"
              : "{count} nodes",
            { count: overview.value?.data.counts.designNodes ?? 0 },
          ),
        },
        {
          id: "memory",
          icon: "memory",
          label: t("Memory"),
          hint: t(
            (overview.value?.data.counts.memoryItems ?? 0) === 1
              ? "{count} item"
              : "{count} items",
            { count: overview.value?.data.counts.memoryItems ?? 0 },
          ),
        },
      ],
    },
    {
      label: t("Review"),
      items: [
        {
          id: "decisions",
          icon: "risk",
          label: t("Action Center"),
          count: workspace.value?.actionCenterCounts.open,
          hint: t("Decisions, risks, and warnings"),
        },
        {
          id: "inbox",
          icon: "inbox",
          label: t("Memory Inbox"),
          count: overview.value?.data.counts.pendingMemoryProposals,
          hint: t("Review semantic changes"),
        },
      ],
    },
    {
      label: t("System"),
      items: [
        {
          id: "connections",
          icon: "plug",
          label: t("Connections"),
          hint: t("Sources and capabilities"),
        },
        {
          id: "settings",
          icon: "settings",
          label: t("Settings"),
          hint: t("Budgets and privacy"),
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
      const localized = localizeWorkspaceRisk(risk, locale.value);
      items.push({
        id: risk.id,
        tone: risk.level === "decision-required" ? "decision" : "warning",
        title: localized.title,
        detail: localized.recommendation,
        action: t("Review evidence"),
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
        title: t(
          pending === 1
            ? "{count} memory proposal needs review"
            : "{count} memory proposals need review",
          { count: pending },
        ),
        detail: t(
          "Nothing becomes durable knowledge without a human decision.",
        ),
        action: t("Open Memory Inbox"),
        section: "inbox",
      });
    }
    if (workspace.value.git.dirty) {
      items.push({
        id: "dirty-checkout",
        tone: "local",
        title: t(
          workspace.value.git.changedFiles === 1
            ? "{count} changed file in this checkout"
            : "{count} changed files in this checkout",
          { count: workspace.value.git.changedFiles },
        ),
        detail: t(
          "Task continuation will preserve and reason about this diff.",
        ),
        action: t("Review current diff"),
        section: "code",
      });
    }
    return items.slice(0, 5);
  });

  const sourceProblems = computed(
    () =>
      overview.value?.data.sources.filter((source) =>
        ["stale", "degraded", "error", "permission-required"].includes(source.status),
      ) ?? [],
  );

  const statusSummary = computed(() => {
    if (sourceProblems.value.length > 0) {
      return {
        label: t(
          sourceProblems.value.length === 1
            ? "{count} source needs attention"
            : "{count} sources need attention",
          { count: sourceProblems.value.length },
        ),
        tone: "warning",
      };
    }
    return { label: t("Local evidence ready"), tone: "healthy" };
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
        searchError.value = atlasErrorSource(caught, "Local search failed.");
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

  watch(activeSection, () => {
    nextTick(() => {
      workspaceScroller.value?.scrollTo({ top: 0, behavior: "auto" });
    });
  });

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
      activeSection.value = "decisions";
    }
  }

  function sourceIcon(source: string): AtlasIconName {
    return source === "repository" || source === "code"
      ? "code"
      : source === "figma" || source === "design"
        ? "design"
        : "memory";
  }

  function localizeSearchReason(reason: string): string {
    const separator = reason.indexOf(": ");
    if (separator > 0) {
      return `${t(reason.slice(0, separator))}: ${reason.slice(separator + 2)}`;
    }
    return t(reason);
  }

  function uiErrorMessage(caught: unknown, fallback: string): string {
    return atlasErrorSource(caught, fallback);
  }

  watch(projectPath, (value) => {
    if (
      projectPreview.value &&
      projectPreview.value.rootPath.toLowerCase() !== value.trim().toLowerCase()
    ) {
      projectPreview.value = undefined;
    }
  });

  function resetSwitchedWorkspace(): void {
    projectPath.value = "";
    projectPreview.value = undefined;
    projectMenuOpen.value = false;
    activeSection.value = "home";
    selectedComponentId.value = undefined;
    selectedDesignNodeId.value = undefined;
    selectedMemoryItemId.value = undefined;
  }

  async function reviewProject(rootPath = projectPath.value): Promise<void> {
    const candidate = rootPath.trim();
    if (!candidate || projectInspectPending.value || projectSwitchPending.value) {
      return;
    }
    projectInspectPending.value = true;
    projectSwitchError.value = "";
    try {
      const session = await $fetch<{ token: string }>("/api/session");
      projectPreview.value = await $fetch<ProjectDestinationPreview>(
        "/api/projects/inspect",
        {
          method: "POST",
          headers: { "x-atlas-session": session.token },
          body: { rootPath: candidate },
        },
      );
      projectPath.value = projectPreview.value.rootPath;
    } catch (caught) {
      projectPreview.value = undefined;
      projectSwitchError.value = uiErrorMessage(
        caught,
        "Project Atlas could not inspect that folder.",
      );
    } finally {
      projectInspectPending.value = false;
    }
  }

  async function unlinkRecentProject(rootPath: string): Promise<void> {
    if (recentProjectActionPending.value) return;
    recentProjectActionPending.value = rootPath;
    recentProjectActionError.value = "";
    try {
      const session = await $fetch<{ token: string }>("/api/session");
      await $fetch("/api/projects/recent/unlink", {
        method: "POST",
        headers: { "x-atlas-session": session.token },
        body: { rootPath },
      });
      await refreshProjects();
    } catch (caught) {
      recentProjectActionError.value = uiErrorMessage(
        caught,
        "Project Atlas could not remove that recent-project relation.",
      );
    } finally {
      recentProjectActionPending.value = "";
    }
  }

  async function requestUnavailableRecentCleanup(): Promise<void> {
    if (unavailableRecentProjects.value.length > 1) {
      recentCleanupConfirmationOpen.value = true;
      return;
    }
    await cleanUnavailableRecentProjects();
  }

  async function cleanUnavailableRecentProjects(): Promise<void> {
    if (recentProjectActionPending.value) return;
    recentProjectActionPending.value = "all-unavailable";
    recentProjectActionError.value = "";
    try {
      const session = await $fetch<{ token: string }>("/api/session");
      await $fetch("/api/projects/recent/prune", {
        method: "POST",
        headers: { "x-atlas-session": session.token },
        body: { confirmed: true },
      });
      recentCleanupConfirmationOpen.value = false;
      await refreshProjects();
    } catch (caught) {
      recentProjectActionError.value = uiErrorMessage(
        caught,
        "Project Atlas could not clean unavailable recent-project relations.",
      );
    } finally {
      recentProjectActionPending.value = "";
    }
  }

  function cancelProjectPreview(): void {
    projectPreview.value = undefined;
  }

  async function activateProject(
    rootPath = projectPreview.value?.rootPath ?? "",
  ): Promise<void> {
    const candidate = rootPath.trim();
    if (!candidate || projectSwitchPending.value) return;
    projectSwitchPending.value = true;
    projectSwitchError.value = "";
    try {
      const session = await $fetch<{ token: string }>("/api/session");
      await $fetch("/api/projects/activate", {
        method: "POST",
        headers: { "x-atlas-session": session.token },
        body: { rootPath: candidate },
      });
      resetSwitchedWorkspace();
      await Promise.all([refreshProjects(), refreshWorkspace()]);
    } catch (caught) {
      projectSwitchError.value = uiErrorMessage(
        caught,
        "Project Atlas could not open that folder.",
      );
    } finally {
      projectSwitchPending.value = false;
    }
  }

  async function browseForProject(trigger: HTMLButtonElement | undefined): Promise<void> {
    if (folderPickerPending.value) return;
    folderPickerPending.value = true;
    projectSwitchError.value = "";
    projectPickerMessage.value = "";
    try {
      let selectedPath: string | undefined;
      if (folderPicker.value) {
        selectedPath = await chooseDesktopProjectFolder(folderPicker.value);
      } else {
        const session = await $fetch<{ token: string }>("/api/session");
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
      if (selectedPath) {
        projectPath.value = selectedPath;
        projectPickerMessage.value =
          "Folder selected. Review the destination before opening it.";
      } else {
        projectPickerMessage.value =
          "No folder was selected. Paste an absolute path or try the picker again.";
      }
    } catch (caught) {
      projectSwitchError.value = `${uiErrorMessage(
        caught,
        "The folder picker failed.",
      )} Paste an absolute path in the field to continue.`;
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
      projectPreview.value = undefined;
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
    const session = await $fetch<{ token: string }>("/api/session");
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
      const session = await $fetch<{ token: string }>("/api/session");
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
      localActionError.value = uiErrorMessage(
        caught,
        "The local action failed.",
      );
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
      activeSection.value = "design";
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

  return {
    projects,
    refreshProjects,
    workspace,
    workspaceError,
    refreshWorkspace,
    formatDate,
    locale,
    runtimeMessage,
    statusLabel,
    t,
    branchAction,
    localizeSourceHealth,
    overview,
    graph,
    componentNodeCount,
    activeRoot,
    otherRecentProjects,
    unavailableRecentProjects,
    detachedWorktrees,
    isRepositoryCheckoutPreview,
    activeSection,
    navCollapsed,
    projectMenuOpen,
    projectPath,
    projectSwitchPending,
    projectInspectPending,
    projectSwitchError,
    recentProjectActionError,
    recentProjectActionPending,
    recentCleanupConfirmationOpen,
    projectPickerMessage,
    projectPreview,
    folderPicker,
    folderPickerPending,
    folderDropActive,
    launcherBrowse,
    popoverBrowse,
    launcherScroller,
    launcherHeading,
    workspaceScroller,
    inboxHeading,
    selectedComponentId,
    selectedDesignNodeId,
    selectedMemoryItemId,
    searchQuery,
    searchResults,
    searchPending,
    searchError,
    searchOpen,
    searchInput,
    localAction,
    localActionMessage,
    localActionError,
    preferences,
    navigationGroups,
    resultGroups,
    openRisks,
    attentionQueue,
    sourceProblems,
    statusSummary,
    unavailableRecentProjectActionLabel,
    selectSection,
    selectSearchResult,
    openActionEvidence,
    sourceIcon,
    localizeSearchReason,
    uiErrorMessage,
    resetSwitchedWorkspace,
    reviewProject,
    unlinkRecentProject,
    requestUnavailableRecentCleanup,
    cleanUnavailableRecentProjects,
    cancelProjectPreview,
    activateProject,
    browseForProject,
    handleProjectDragLeave,
    handleProjectDrop,
    refreshSnapshot,
    clearLocalMetrics,
    runLocalAction,
    copyProjectPath,
    handleKeyboard,
  };
}
