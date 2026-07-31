<script setup lang="ts">
const {
  projects,
  workspace,
  workspaceError,
  refreshWorkspace,
  formatDate,
  locale,
  runtimeMessage,
  statusLabel,
  t,
  BRANCH_PREFIXES,
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
  worktreePreview,
  worktreePreviewPendingBranch,
  newBranchFormOpen,
  newBranchType,
  newBranchName,
  newBranchBase,
  newBranchPreviewPending,
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
  attentionQueue,
  statusSummary,
  selectedNewBranchBase,
  proposedNewBranchName,
  unavailableRecentProjectActionLabel,
  selectSection,
  selectSearchResult,
  openActionEvidence,
  sourceIcon,
  localizeSearchReason,
  reviewProject,
  unlinkRecentProject,
  requestUnavailableRecentCleanup,
  cleanUnavailableRecentProjects,
  cancelProjectPreview,
  cancelWorktreePreview,
  toggleNewBranchForm,
  activateProject,
  reviewNewWorktree,
  reviewNewBranchWorktree,
  createAndOpenWorktree,
  browseForProject,
  handleProjectDragLeave,
  handleProjectDrop,
  refreshSnapshot,
  clearLocalMetrics,
  runLocalAction,
  copyProjectPath,
} = await useAtlasWorkspacePage();
</script>

<template>
  <main
    :class="[
      'desktop-shell',
      {
        'nav-collapsed': navCollapsed,
        'project-menu-open': projectMenuOpen,
      },
    ]"
    :data-section="activeSection"
  >
    <section
      v-if="!projects?.activeRoot || workspaceError"
      ref="launcherScroller"
      class="project-launcher"
      tabindex="-1"
      :aria-label="t('Project launcher')"
    >
      <header class="launcher-brand">
        <AtlasMark />
        <span><strong>Project Atlas</strong><small>{{ t("Local evidence workspace") }}</small></span>
      </header>
      <div class="launcher-content">
        <span class="eyebrow">{{ t("Open a project") }}</span>
        <h1 ref="launcherHeading" tabindex="-1">{{ t("Start from the repository you want to understand.") }}</h1>
        <p>
          {{
            t(
              "Atlas scans locally, keeps project evidence isolated, and prepares compact context only when you ask an agent to help.",
            )
          }}
        </p>
        <form class="open-project-form" @submit.prevent="reviewProject()">
          <label for="launcher-project-path">{{ t("Project folder") }}</label>
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
              {{ folderPickerPending ? t("Choosing…") : t("Choose folder…") }}
            </button>
            <button
              class="primary-button"
              :disabled="projectInspectPending || projectSwitchPending || !projectPath.trim()"
            >
              {{
                projectInspectPending
                  ? t("Inspecting…")
                  : t("Review destination")
              }}
            </button>
          </div>
          <small>
            {{
              t(
                "Choose or drop a repository folder to inspect it before opening.",
              )
            }}
            {{ t("Atlas never uploads the project.") }}
          </small>
        </form>
        <p v-if="folderPickerPending" class="inline-info" role="status">
          {{
            t(
              "The system folder picker is open. If it appears behind Atlas, use Alt+Tab. You can also paste an absolute path.",
            )
          }}
        </p>
        <p v-if="projectPickerMessage" class="inline-info" role="status">
          {{ t(projectPickerMessage) }}
        </p>
        <ProjectDestinationPreview
          v-if="projectPreview"
          :destination="projectPreview"
          :pending="projectSwitchPending"
          @cancel="cancelProjectPreview"
          @confirm="activateProject()"
        />
        <p v-if="projectSwitchError" class="inline-error">{{ runtimeMessage(projectSwitchError) }}</p>
        <section
          v-if="workspaceError && projects?.activeRoot"
          class="launcher-recovery"
          role="alert"
        >
          <AtlasIcon name="risk" />
          <div>
            <strong>{{ t("Workspace could not be loaded") }}</strong>
            <p>{{ runtimeMessage(workspaceError, "Project Atlas could not load the active project.") }}</p>
          </div>
          <button class="secondary-button" @click="refreshWorkspace()">
            {{ t("Retry workspace") }}
          </button>
        </section>
        <div v-if="projects?.projects.length" class="recent-projects">
          <header>
            <div>
              <h2>{{ t("Recent projects") }}</h2>
              <span>{{ t("Stored only on this computer") }}</span>
            </div>
            <button
              v-if="unavailableRecentProjects.length"
              class="recent-cleanup-button"
              :disabled="Boolean(recentProjectActionPending)"
              @click="requestUnavailableRecentCleanup()"
            >
              {{ unavailableRecentProjectActionLabel() }}
            </button>
          </header>
          <div
            v-if="recentCleanupConfirmationOpen"
            class="recent-cleanup-confirmation"
            role="alert"
          >
            <p>
              {{
                t(
                  "This only removes unavailable links from recent-projects.json. Repositories and Project Atlas data are not deleted.",
                )
              }}
            </p>
            <div>
              <button
                class="secondary-button"
                :disabled="Boolean(recentProjectActionPending)"
                @click="recentCleanupConfirmationOpen = false"
              >
                {{ t("Cancel") }}
              </button>
              <button
                class="primary-button"
                :disabled="Boolean(recentProjectActionPending)"
                @click="cleanUnavailableRecentProjects()"
              >
                {{ unavailableRecentProjectActionLabel() }}
              </button>
            </div>
          </div>
          <div
            v-for="project in projects.projects"
            :key="project.rootPath"
            class="recent-project-row"
            :class="{ 'is-unavailable': !project.available }"
          >
          <button
            v-if="project.available"
            class="recent-project-open"
            :disabled="projectSwitchPending || projectInspectPending"
            @click="reviewProject(project.rootPath)"
          >
            <AtlasIcon name="folder" />
            <span>
              <strong :title="project.git?.logicalProjectPath ?? project.name">
                {{ project.git?.logicalProjectName ?? project.name }}
              </strong>
              <small :title="project.rootPath">{{ project.rootPath }}</small>
              <em v-if="project.git">
                {{ project.git.worktreeName ?? t("Worktree") }}
                · {{ project.git.branch ?? t("detached") }}
                ·
                {{
                  project.git.dirty
                    ? t(
                        project.git.changedFiles === 1
                          ? "{count} changed file"
                          : "{count} changed files",
                        { count: project.git.changedFiles },
                      )
                    : t("clean")
                }}
              </em>
            </span>
            <time>{{ formatDate(project.lastOpenedAt) }}</time>
            <AtlasIcon name="arrow-right" />
          </button>
            <template v-else>
              <AtlasIcon name="folder" />
              <span>
                <strong :title="project.name">{{ project.name }}</strong>
                <small :title="project.rootPath">{{ project.rootPath }}</small>
                <em>
                  {{
                    t(
                      "Removing this link keeps the repository and Project Atlas data untouched.",
                    )
                  }}
                </em>
              </span>
              <time>{{ t("Folder missing") }}</time>
              <button
                class="recent-project-unlink"
                :aria-label="
                  t('Remove {name} from recent projects', {
                    name: project.name,
                  })
                "
                :disabled="Boolean(recentProjectActionPending)"
                @click="unlinkRecentProject(project.rootPath)"
              >
                {{ t("Remove link") }}
              </button>
            </template>
          </div>
          <p v-if="recentProjectActionError" class="inline-error" role="alert">
            {{ runtimeMessage(recentProjectActionError) }}
          </p>
        </div>
        <div v-else class="launcher-empty">
          <AtlasIcon name="folder" />
          <span><strong>{{ t("No recent projects yet") }}</strong><small>{{ t("Open a local repository to create the first entry.") }}</small></span>
        </div>
      </div>
      <ScrollToTopButton
        :target="launcherScroller"
        :focus-target="launcherHeading"
        :min-overflow="520"
      />
    </section>

    <template v-else-if="overview && graph && workspace">
      <nav class="desktop-navigator" :aria-label="t('Project Atlas navigation')">
        <div class="navigator-brand">
          <AtlasMark />
          <span><strong>Project Atlas</strong><small>{{ t("Evidence workspace") }}</small></span>
        </div>

        <div class="project-switcher-wrap">
          <button
            class="project-switcher"
            aria-haspopup="dialog"
            :aria-expanded="projectMenuOpen"
            @click="projectMenuOpen = !projectMenuOpen"
          >
            <span class="project-badge">{{ (workspace.git.logicalProjectName ?? overview.projectName).slice(0, 2).toUpperCase() }}</span>
            <span>
              <strong :title="workspace.git.logicalProjectPath ?? overview.projectName">{{ workspace.git.logicalProjectName ?? overview.projectName }}</strong>
              <small
                :title="`${workspace.git.worktreePath ?? overview.data.project.rootPath} · ${workspace.git.branch ?? t('detached')}`"
              >
                {{ workspace.git.worktreeName ?? t("Worktree") }}
                · {{ workspace.git.branch ?? t("detached") }}
              </small>
              <em :class="{ warning: workspace.git.dirty }">
                {{
                  workspace.git.dirty
                    ? t(
                        workspace.git.changedFiles === 1
                          ? "{count} changed file"
                          : "{count} changed files",
                        { count: workspace.git.changedFiles },
                      )
                    : t("clean")
                }}
              </em>
            </span>
            <AtlasIcon name="chevron-down" />
          </button>
          <section v-if="projectMenuOpen" class="project-popover" role="dialog" :aria-label="t('Change project')">
            <header>
              <div><span class="eyebrow">{{ t("Active checkout") }}</span><strong :title="workspace.git.logicalProjectPath ?? overview.projectName">{{ workspace.git.logicalProjectName ?? overview.projectName }}</strong></div>
              <button class="icon-button" :aria-label="t('Close project menu')" @click="projectMenuOpen = false"><AtlasIcon name="x" /></button>
            </header>
            <dl class="active-project-identity">
              <div><dt>{{ t("Logical project") }}</dt><dd :title="workspace.git.logicalProjectPath ?? overview.projectName">{{ workspace.git.logicalProjectName ?? overview.projectName }}</dd></div>
              <div>
                <dt>{{ t("Worktree") }}</dt>
                <dd :title="workspace.git.worktreePath ?? overview.data.project.rootPath">
                  {{ workspace.git.worktreeName ?? overview.projectName }}
                  <small>{{ t(workspace.git.isLinkedWorktree ? "Linked worktree" : "Primary checkout") }}</small>
                </dd>
              </div>
              <div>
                <dt>{{ t("Branch") }}</dt>
                <dd :title="workspace.git.branch ?? t('detached')">
                  {{ workspace.git.branch ?? t("detached") }}
                  <small>{{ workspace.git.head ?? t("No commits yet") }}</small>
                </dd>
              </div>
              <div>
                <dt>{{ t("Working tree") }}</dt>
                <dd :class="{ warning: workspace.git.dirty }">
                  {{
                    workspace.git.dirty
                      ? t(
                          workspace.git.changedFiles === 1
                            ? "{count} changed file"
                            : "{count} changed files",
                          { count: workspace.git.changedFiles },
                        )
                      : t("Working tree clean")
                  }}
                </dd>
              </div>
            </dl>
            <code :title="overview.data.project.rootPath">{{ overview.data.project.rootPath }}</code>
            <section
              v-if="projects.repository"
              class="repository-checkouts"
              :aria-label="t('Local branches and worktrees')"
            >
              <header>
                <div>
                  <span class="field-label">{{ t("Local branches and worktrees") }}</span>
                  <small>
                    {{
                      t(
                        projects.repository.branches.length === 1
                          ? "{count} local branch"
                          : "{count} local branches",
                        { count: projects.repository.branches.length },
                      )
                    }}
                    ·
                    {{
                      t(
                        projects.repository.worktrees.length === 1
                          ? "{count} worktree"
                          : "{count} worktrees",
                        { count: projects.repository.worktrees.length },
                      )
                    }}
                  </small>
                </div>
                <button
                  type="button"
                  class="text-button new-branch-toggle"
                  aria-controls="new-branch-worktree-form"
                  :aria-expanded="newBranchFormOpen"
                  @click="toggleNewBranchForm"
                >
                  {{
                    t(
                      newBranchFormOpen
                        ? "Cancel new branch"
                        : "New branch + worktree",
                    )
                  }}
                </button>
              </header>
              <form
                v-if="newBranchFormOpen"
                id="new-branch-worktree-form"
                class="new-branch-form"
                @submit.prevent="reviewNewBranchWorktree"
              >
                <div class="new-branch-base-field">
                  <label for="new-branch-base">{{ t("Base branch") }}</label>
                  <select
                    id="new-branch-base"
                    v-model="newBranchBase"
                    aria-describedby="new-branch-base-summary"
                    :title="
                      selectedNewBranchBase
                        ? `${selectedNewBranchBase.name} · ${selectedNewBranchBase.head}`
                        : undefined
                    "
                    :disabled="newBranchPreviewPending || projectSwitchPending"
                  >
                    <option disabled value="">
                      {{ t("Choose a local branch") }}
                    </option>
                    <option
                      v-for="branch in projects.repository.branches"
                      :key="branch.name"
                      :value="branch.name"
                      :disabled="!branch.hasProjectManifest"
                    >
                      {{
                        branch.hasProjectManifest
                          ? `${branch.name} · ${branch.shortHead}`
                          : `${branch.name} · ${t("Unavailable: no package.json")}`
                      }}
                    </option>
                  </select>
                  <small
                    id="new-branch-base-summary"
                    class="new-branch-base-summary"
                  >
                    <template v-if="selectedNewBranchBase">
                      <span>{{ t("Selected base") }}</span>
                      <strong :title="selectedNewBranchBase.name">
                        {{ selectedNewBranchBase.name }}
                      </strong>
                      <code :title="selectedNewBranchBase.head">
                        {{ selectedNewBranchBase.shortHead }}
                      </code>
                    </template>
                    <template v-else>
                      {{ t("Select the local branch that will provide the starting HEAD.") }}
                    </template>
                  </small>
                </div>
                <div>
                  <label for="new-branch-type">{{ t("Branch type") }}</label>
                  <select
                    id="new-branch-type"
                    v-model="newBranchType"
                    :disabled="newBranchPreviewPending || projectSwitchPending"
                  >
                    <option
                      v-for="prefix in BRANCH_PREFIXES"
                      :key="prefix"
                      :value="prefix"
                    >
                      {{ prefix }}
                    </option>
                  </select>
                </div>
                <div class="new-branch-name-field">
                  <label for="new-branch-name">{{ t("Branch name") }}</label>
                  <input
                    id="new-branch-name"
                    v-model="newBranchName"
                    type="text"
                    maxlength="120"
                    autocomplete="off"
                    :placeholder="t('short-descriptive-name')"
                    :disabled="newBranchPreviewPending || projectSwitchPending"
                  >
                </div>
                <code :title="proposedNewBranchName">
                  {{ proposedNewBranchName }}
                </code>
                <button
                  type="submit"
                  class="secondary-button"
                  :disabled="
                    !newBranchName.trim()
                    || !selectedNewBranchBase?.hasProjectManifest
                    || newBranchPreviewPending
                    || projectSwitchPending
                  "
                >
                  {{
                    newBranchPreviewPending
                      ? t("Preparing...")
                      : t("Review branch")
                  }}
                </button>
                <small>
                  {{
                    t(
                      "The new branch starts at the selected local branch HEAD and opens in a separate worktree.",
                    )
                  }}
                </small>
              </form>
              <ul class="repository-branch-list">
                <li
                  v-for="branch in projects.repository.branches"
                  :key="branch.name"
                  :class="{ active: branch.isCurrent }"
                >
                  <AtlasIcon name="branch" />
                  <span>
                    <strong :title="branch.name">{{ branch.name }}</strong>
                    <small
                      :title="branch.worktree?.path"
                    >
                      {{
                        branch.worktree
                          ? branch.worktree.name
                          : t("No worktree yet")
                      }}
                      · {{ branch.shortHead }}
                    </small>
                    <em
                      v-if="branch.worktree?.git?.dirty"
                      class="warning"
                    >
                      {{
                        t(
                          branch.worktree.git.changedFiles === 1
                            ? "{count} changed file"
                            : "{count} changed files",
                          { count: branch.worktree.git.changedFiles },
                        )
                      }}
                    </em>
                    <em v-else-if="!branch.hasProjectManifest" class="warning">
                      {{ t("No package.json on this branch") }}
                    </em>
                  </span>
                  <button
                    type="button"
                    class="branch-action"
                    :disabled="
                      branchAction(branch) === 'current'
                      || branchAction(branch) === 'unsupported'
                      || projectSwitchPending
                      || projectInspectPending
                      || Boolean(worktreePreviewPendingBranch)
                    "
                    :aria-label="
                      t(
                        branchAction(branch) === 'current'
                          ? 'Current checkout: {branch}'
                          : branchAction(branch) === 'open-worktree'
                            ? 'Review worktree for {branch}'
                            : 'Create worktree for {branch}',
                        { branch: branch.name },
                      )
                    "
                    :title="
                      branchAction(branch) === 'unsupported'
                        ? t('This branch cannot be opened because it has no package.json.')
                        : undefined
                    "
                    @click="
                      branch.worktree
                        ? reviewProject(branch.worktree.path)
                        : reviewNewWorktree(branch.name)
                    "
                  >
                    {{
                      worktreePreviewPendingBranch === branch.name
                        ? t("Preparing...")
                        : t(
                            branchAction(branch) === "current"
                              ? "Current"
                              : branchAction(branch) === "open-worktree"
                                ? "Review"
                                : branchAction(branch) === "unsupported"
                                  ? "Unavailable"
                                  : "Create...",
                          )
                    }}
                  </button>
                </li>
              </ul>
              <div
                v-if="detachedWorktrees.length"
                class="detached-worktrees"
              >
                <span class="field-label">{{ t("Detached worktrees") }}</span>
                <button
                  v-for="worktree in detachedWorktrees"
                  :key="worktree.path"
                  type="button"
                  :disabled="
                    worktree.isCurrent
                    || !worktree.available
                    || projectSwitchPending
                    || projectInspectPending
                  "
                  @click="reviewProject(worktree.path)"
                >
                  <span>
                    <strong :title="worktree.path">{{ worktree.name }}</strong>
                    <small>{{ worktree.head.slice(0, 10) }}</small>
                  </span>
                  <span>{{ t(worktree.isCurrent ? "Current" : "Review") }}</span>
                </button>
              </div>
              <ProjectDestinationPreview
                v-if="projectPreview && isRepositoryCheckoutPreview"
                :destination="projectPreview"
                :active-root="activeRoot"
                :pending="projectSwitchPending"
                @cancel="cancelProjectPreview"
                @confirm="activateProject()"
              />
              <WorktreeCreationPreview
                v-if="worktreePreview"
                :preview="worktreePreview"
                :pending="projectSwitchPending"
                @cancel="cancelWorktreePreview"
                @confirm="createAndOpenWorktree"
              />
            </section>
            <div class="popover-recents">
              <span class="field-label">{{ t("Recent projects") }}</span>
              <button
                v-for="project in otherRecentProjects"
                :key="project.rootPath"
                :disabled="!project.available || projectSwitchPending || projectInspectPending"
                @click="reviewProject(project.rootPath)"
              >
                <AtlasIcon name="folder" />
                <span>
                  <strong :title="project.git?.logicalProjectPath ?? project.name">
                    {{ project.git?.logicalProjectName ?? project.name }}
                  </strong>
                  <small :title="project.rootPath">{{ project.rootPath }}</small>
                  <em v-if="project.git">
                    {{ project.git.worktreeName ?? t("Worktree") }}
                    · {{ project.git.branch ?? t("detached") }}
                    · {{ project.git.dirty ? t("warning") : t("clean") }}
                  </em>
                </span>
              </button>
              <p v-if="!otherRecentProjects.length">{{ t("No other projects have been opened from Atlas yet.") }}</p>
            </div>
            <form class="popover-open-project" @submit.prevent="reviewProject()">
              <label for="project-path">{{ t("Open another folder") }}</label>
              <div
                class="project-folder-dropzone has-folder-picker"
                :class="{ 'is-dragging': folderDropActive }"
                @dragenter.prevent="folderDropActive = true"
                @dragover.prevent="folderDropActive = true"
                @dragleave="handleProjectDragLeave"
                @drop.prevent="handleProjectDrop"
              >
                <input id="project-path" v-model="projectPath" type="text" autocomplete="off" :placeholder="t('Absolute project path')">
                <button
                  ref="popoverBrowse"
                  type="button"
                  class="secondary-button"
                  :disabled="folderPickerPending"
                  @click="browseForProject(popoverBrowse)"
                >
                  {{ folderPickerPending ? t("Choosing…") : t("Choose folder…") }}
                </button>
                <button class="primary-button" :disabled="projectSwitchPending || projectInspectPending || !projectPath.trim()">
                  {{ projectInspectPending ? t("Inspecting…") : t("Review destination") }}
                </button>
              </div>
              <small>{{ t("Choose or drop a repository folder to inspect it before opening.") }}</small>
            </form>
            <p v-if="folderPickerPending" class="inline-info" role="status">
              {{
                t(
                  "The system folder picker is open. If it appears behind Atlas, use Alt+Tab. You can also paste an absolute path.",
                )
              }}
            </p>
            <p v-if="projectPickerMessage" class="inline-info" role="status">
              {{ t(projectPickerMessage) }}
            </p>
            <ProjectDestinationPreview
              v-if="projectPreview && !isRepositoryCheckoutPreview"
              :destination="projectPreview"
              :active-root="activeRoot"
              :pending="projectSwitchPending"
              @cancel="cancelProjectPreview"
              @confirm="activateProject()"
            />
            <p v-if="projectSwitchError" class="inline-error">{{ runtimeMessage(projectSwitchError) }}</p>
            <button class="text-button" @click="copyProjectPath">{{ t("Copy active path") }}</button>
          </section>
        </div>

        <div class="navigator-scroll">
          <section v-for="group in navigationGroups" :key="group.label" class="nav-group">
            <span>{{ group.label }}</span>
            <button
              v-for="item in group.items"
              :key="item.id"
              :class="{ active: activeSection === item.id }"
              :aria-label="item.label"
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
          <div><span class="connection-light" /><span><strong>{{ t("Local workspace") }}</strong><small>{{ t("Browsing uses 0 tokens") }}</small></span></div>
          <button class="icon-button nav-toggle" :aria-label="t(navCollapsed ? 'Expand navigation' : 'Collapse navigation')" @click="navCollapsed = !navCollapsed">
            <AtlasIcon name="menu" />
          </button>
        </div>
      </nav>

      <header class="project-bar">
        <button class="global-search-trigger" :aria-label="t('Search code, design, and memory')" @click="searchOpen = true; nextTick(() => searchInput?.focus())">
          <AtlasIcon name="search" />
          <span>{{ t("Search components, designs, decisions…") }}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div class="project-context">
          <span :title="workspace.git.worktreePath ?? overview.data.project.rootPath">{{ workspace.git.worktreeName ?? overview.projectName }}</span>
          <span :title="workspace.git.branch ?? t('detached')"><AtlasIcon name="branch" />{{ workspace.git.branch ?? t("detached") }}</span>
          <span>{{ workspace.git.head ?? t("No commits yet") }}</span>
          <span :class="['working-state', { dirty: workspace.git.dirty }]">
            {{
              workspace.git.dirty
                ? t("{count} changed", { count: workspace.git.changedFiles })
                : t("Clean")
            }}
          </span>
        </div>
        <button class="status-summary" @click="selectSection('connections')">
          <span :class="['state-light', statusSummary.tone]" />
          <span>{{ statusSummary.label }}</span>
        </button>
        <LanguageSelector />
      </header>

      <section
        ref="workspaceScroller"
        class="desktop-workspace"
        tabindex="-1"
        :aria-label="t('Project workspace')"
      >
        <section v-if="activeSection === 'home'" class="home-workspace">
          <header class="workspace-heading">
            <div>
              <span class="eyebrow">{{ workspace.git.logicalProjectName ?? overview.projectName }} / {{ workspace.git.branch ?? t("detached") }}</span>
              <h1>{{ t(workspace.git.dirty ? "Pick up where you left off." : "Your project, oriented.") }}</h1>
              <p>{{ t(workspace.git.dirty ? "Atlas keeps the current diff visible for review." : "Explore what already exists or review changes since the last scan.") }}</p>
            </div>
            <button class="primary-button large" @click="selectSection('code')">
              <AtlasIcon name="code" />{{ t(workspace.git.dirty ? "Review current diff" : "Explore code") }}
            </button>
          </header>

          <section class="continuation-band">
            <div class="continuation-copy">
              <AtlasIcon :name="workspace.git.dirty ? 'activity' : 'check'" />
              <div>
                <span class="eyebrow">{{ t("Current checkout") }}</span>
                <h2>{{ workspace.git.dirty ? t(workspace.git.changedFiles === 1 ? "{count} changed file" : "{count} changed files", { count: workspace.git.changedFiles }) : t("Ready for the next task") }}</h2>
                <p v-if="workspace.git.dirty">{{ t("{staged} staged · {untracked} untracked. Continue or correct without restarting the brief.", { staged: workspace.git.stagedFiles, untracked: workspace.git.untrackedFiles }) }}</p>
                <p v-else>{{ t("{mode} scan · {components} components · {nodes} code nodes · {relations} relations.", { mode: graph.project.scan?.mode ?? "full", components: componentNodeCount, nodes: graph.components.length, relations: graph.edges.length }) }}</p>
              </div>
            </div>
            <button class="secondary-button" :disabled="Boolean(localAction)" @click="runLocalAction('repository')">
              <AtlasIcon name="refresh" />{{ t(localAction === "repository" ? "Scanning…" : "Rescan code") }}
            </button>
          </section>

          <div class="home-columns">
            <section class="home-ledger attention-ledger">
              <header><div><span class="eyebrow">{{ t("Review") }}</span><h2>{{ t("Needs your attention") }}</h2></div><span>{{ attentionQueue.length }}</span></header>
              <div v-if="attentionQueue.length" class="queue-list">
                <button v-for="item in attentionQueue" :key="item.id" @click="selectSection(item.section)">
                  <AtlasIcon :name="item.tone === 'local' ? 'activity' : 'risk'" />
                  <span><strong>{{ item.title }}</strong><small>{{ item.detail }}</small></span>
                  <AtlasIcon name="arrow-right" />
                </button>
              </div>
              <div v-else class="inline-empty">
                <AtlasIcon name="check" />
                <div><strong>{{ t("Nothing is blocking the next task") }}</strong><p>{{ t("There are no unresolved decisions or recovery actions.") }}</p></div>
              </div>
            </section>

            <section class="home-ledger changes-ledger">
              <header><div><span class="eyebrow">{{ t("Recent activity") }}</span><h2>{{ t("What changed") }}</h2></div><span>{{ formatDate(workspace.generatedAt) }}</span></header>
              <div class="change-rows">
                <article>
                  <AtlasIcon name="code" />
                  <div><strong>{{ t("Code index") }}</strong><p>{{ t("{mode} scan · {count} files reconsidered", { mode: graph.project.scan?.mode ?? "full", count: graph.project.scan?.changedFiles ?? graph.project.sourceFiles }) }}</p></div>
                  <time>{{ formatDate(graph.project.scannedAt) }}</time>
                </article>
                <button @click="selectSection('design')">
                  <AtlasIcon name="design" />
                  <span><strong>{{ t("Design map") }}</strong><small>{{ workspace.designIndexes.length ? t("{count} indexed nodes", { count: overview.data.counts.designNodes }) : t("No design source yet") }}</small></span>
                  <AtlasIcon name="arrow-right" />
                </button>
                <button @click="selectSection('memory')">
                  <AtlasIcon name="memory" />
                  <span><strong>{{ t("Project memory") }}</strong><small>{{ workspace.memoryItems.length ? t("{count} knowledge items", { count: workspace.memoryItems.length }) : t("Cold start · no approved memory") }}</small></span>
                  <AtlasIcon name="arrow-right" />
                </button>
              </div>
            </section>
          </div>

          <section class="source-ribbon">
            <header><div><span class="eyebrow">{{ t("Evidence health") }}</span><h2>{{ t("Sources and freshness") }}</h2></div><button class="text-button" @click="selectSection('connections')">{{ t("Manage connections") }}</button></header>
            <div>
              <article v-for="source in overview.data.sources" :key="source.id">
                <AtlasIcon :name="sourceIcon(source.source)" />
                <span><strong>{{ localizeSourceHealth(source, locale).label }}</strong><small>{{ localizeSourceHealth(source, locale).detail }}</small></span>
                <em :class="source.status">{{ statusLabel(source.status) }}</em>
                <time>{{ formatDate(source.lastIndexedAt) }}</time>
              </article>
            </div>
          </section>
          <p v-if="localActionMessage" class="inline-success">{{ t(localActionMessage) }}</p>
          <p v-if="localActionError" class="inline-error">{{ runtimeMessage(localActionError) }}</p>
        </section>

        <section v-else-if="activeSection === 'code'" class="section-workspace code-section">
          <header class="workspace-heading compact"><div><span class="eyebrow">{{ t("Explore / Code") }}</span><h1>{{ t("What can I reuse, change, or test?") }}</h1><p>{{ t("Navigate exact consumers separately from explainable similarity.") }}</p></div><button class="secondary-button" :disabled="Boolean(localAction)" @click="runLocalAction('repository')"><AtlasIcon name="refresh" />{{ t("Rescan code") }}</button></header>
          <LazyCodeAtlasView :graph="graph" :diff-findings="workspace.diffValidation.findings" :initial-component-id="selectedComponentId" />
        </section>

        <section v-else-if="activeSection === 'design'" class="section-workspace design-section">
          <header class="workspace-heading compact"><div><span class="eyebrow">{{ t("Explore / Design") }}</span><h1>{{ t("Where does this flow live?") }}</h1><p>{{ t("Orient by file, flow, state, and variant before loading deep design context.") }}</p></div><span class="heading-count">{{ t("{count} indexed nodes", { count: overview.data.counts.designNodes }) }}</span></header>
          <LazyDesignAtlasView :indexes="workspace.designIndexes" :capabilities="workspace.capabilities" :initial-node-id="selectedDesignNodeId" />
        </section>

        <section v-else-if="activeSection === 'memory'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">{{ t("Explore / Memory") }}</span><h1>{{ t("What has this project learned?") }}</h1><p>{{ t("Trace decisions, conventions, outcomes, authority, and freshness.") }}</p></div><button class="secondary-button" :disabled="Boolean(localAction)" @click="runLocalAction('memory')"><AtlasIcon name="refresh" />{{ t("Reindex memory") }}</button></header>
          <LazyProjectMemoryView :items="workspace.memoryItems" :initial-item-id="selectedMemoryItemId" :include-inactive="preferences.includeInactive" />
        </section>

        <section v-else-if="activeSection === 'decisions'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">{{ t("Review / Action Center") }}</span><h1>{{ t("What needs action, and why?") }}</h1><p>{{ t("Resolve decisions, contradictions, risks, warnings, and missing evidence without losing provenance.") }}</p></div><span class="heading-count">{{ t("{count} open", { count: workspace.actionCenterCounts.open }) }}</span></header>
          <LazyRisksView @open-evidence="openActionEvidence" @changed="refreshSnapshot" />
        </section>

        <section v-else-if="activeSection === 'inbox'" class="section-workspace">
          <header ref="inboxHeading" class="workspace-heading compact" tabindex="-1"><div><span class="eyebrow">{{ t("Review / Memory Inbox") }}</span><h1>{{ t("What should the project remember?") }}</h1><p>{{ t("Approve compact knowledge proposals, never raw transcripts.") }}</p></div><span class="heading-count">{{ t("{count} pending", { count: workspace.memoryProposals.filter((item) => item.status === "pending").length }) }}</span></header>
          <LazyMemoryInboxView
            :proposals="workspace.memoryProposals"
            :memory-items="workspace.memoryItems"
            @changed="refreshSnapshot"
          />
        </section>

        <section v-else-if="activeSection === 'connections'" class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">{{ t("System / Connections") }}</span><h1>{{ t("What evidence can Atlas actually reach?") }}</h1><p>{{ t("Connector state, optional capabilities, permissions, and cached evidence remain distinct.") }}</p></div><span class="heading-count">{{ t("Local-first") }}</span></header>
          <LazyHealthView :sources="overview.data.sources" :capabilities="workspace.capabilities" :usage-traces="workspace.usageTraces" :context-cost="workspace.contextCost" :root-path="overview.data.project.rootPath" @refreshed="refreshSnapshot" />
        </section>

        <section v-else class="section-workspace">
          <header class="workspace-heading compact"><div><span class="eyebrow">{{ t("System / Settings") }}</span><h1>{{ t("How much context may leave Atlas?") }}</h1><p>{{ t("Browsing stays complete locally; model context remains bounded and reviewable.") }}</p></div><span class="heading-count">{{ t("Local preferences") }}</span></header>
          <LazySettingsView v-model="preferences" :evaluation-count="workspace.evaluations.length + workspace.usageTraces.length + (workspace.contextCost.groups[0]?.runs ?? 0)" :context-cost="workspace.contextCost" @clear-metrics="clearLocalMetrics" />
        </section>
      </section>

      <ScrollToTopButton
        :target="workspaceScroller"
        :focus-target="activeSection === 'inbox' ? inboxHeading : workspaceScroller"
      />

      <div v-if="searchOpen" class="search-backdrop" role="presentation" @click.self="searchOpen = false">
        <section class="search-palette command-palette" role="dialog" aria-modal="true" :aria-label="t('Search Project Atlas')">
          <label class="palette-input">
            <AtlasIcon name="search" />
            <input ref="searchInput" v-model="searchQuery" type="search" autocomplete="off" :placeholder="t('Component, consumer, test, frame, decision, or task')" :aria-label="t('Search Project Atlas')">
            <kbd>Esc</kbd>
          </label>
          <div class="palette-body">
            <div v-if="searchPending" class="palette-state"><span class="mini-loader" />{{ t("Searching local evidence…") }}</div>
            <div v-else-if="searchError" class="palette-state error">{{ runtimeMessage(searchError) }}</div>
            <div v-else-if="!searchQuery.trim()" class="palette-empty">
              <AtlasIcon name="search" />
              <span>{{ t("Search the whole project") }}</span>
              <p>{{ t("Open indexed evidence directly. Local search uses no model tokens.") }}</p>
              <div><span>Ctrl 1 · {{ t("Home") }}</span><span>Ctrl 2 · {{ t("Code") }}</span><span>Ctrl 3 · {{ t("Design") }}</span></div>
            </div>
            <template v-else-if="searchResults?.results.length">
              <div v-for="group in resultGroups" :key="group.source" class="result-group">
                <header v-if="group.results.length"><span>{{ statusLabel(group.source) }}</span><small>{{ group.results.length }}</small></header>
                <article v-for="result in group.results" :key="`${result.source}:${result.id}`" class="search-result-row">
                  <button class="search-result" @click="selectSearchResult(result)">
                    <AtlasIcon :name="sourceIcon(result.source)" />
                    <span class="result-copy"><strong>{{ result.title }}</strong><small>{{ result.subtitle }}</small><em>{{ result.reasons.slice(0, 2).map(localizeSearchReason).join(" · ") }}</em></span>
                    <span class="result-status">{{ statusLabel(result.status ?? result.kind) }}</span>
                  </button>
                </article>
              </div>
            </template>
            <div v-else class="palette-state">{{ t("No indexed evidence matches “{query}”.", { query: searchQuery }) }}</div>
          </div>
          <footer class="palette-foot"><span>{{ t("{count} local results", { count: searchResults?.totalMatches ?? 0 }) }}</span><span>{{ t("Open indexed evidence") }}</span></footer>
        </section>
      </div>
    </template>

    <div v-else class="loading-state"><div class="loader" /><p>{{ t("Opening the local evidence workspace…") }}</p></div>
  </main>
</template>
