<script setup lang="ts">
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
}

interface ProjectDestination {
  rootPath: string;
  name: string;
  available: true;
  git: ProjectGitState;
  repository?: {
    branches: unknown[];
    worktrees: unknown[];
  };
}

const props = defineProps<{
  destination: ProjectDestination;
  activeRoot?: string;
  pending?: boolean;
}>();
const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
const { statusLabel, t } = useAtlasI18n();

const isCurrent = computed(
  () =>
    Boolean(props.activeRoot) &&
    props.activeRoot!.toLowerCase() === props.destination.rootPath.toLowerCase(),
);
const worktreeLabel = computed(
  () =>
    props.destination.git.worktreeName ??
    props.destination.git.worktreePath?.split(/[\\/]/).filter(Boolean).at(-1) ??
    props.destination.name,
);
const logicalProjectLabel = computed(
  () => props.destination.git.logicalProjectName ?? props.destination.name,
);
</script>

<template>
  <section
    class="project-destination-preview"
    aria-live="polite"
    aria-labelledby="project-destination-title"
  >
    <header>
      <div>
        <span class="eyebrow">
          {{ t(isCurrent ? "Current destination" : "Destination preview") }}
        </span>
        <h3 id="project-destination-title" :title="logicalProjectLabel">
          {{ logicalProjectLabel }}
        </h3>
      </div>
      <span class="availability-chip">
        {{ t("Available locally") }}
      </span>
    </header>

    <dl class="project-identity-grid">
      <div>
        <dt>{{ t("Logical project") }}</dt>
        <dd :title="destination.git.logicalProjectPath ?? logicalProjectLabel">
          {{ logicalProjectLabel }}
        </dd>
      </div>
      <div>
        <dt>{{ t("Worktree") }}</dt>
        <dd :title="destination.git.worktreePath ?? destination.rootPath">
          {{ worktreeLabel }}
          <small>
            {{
              t(
                destination.git.isLinkedWorktree
                  ? "Linked worktree"
                  : "Primary checkout",
              )
            }}
          </small>
        </dd>
      </div>
      <div>
        <dt>{{ t("Branch") }}</dt>
        <dd :title="destination.git.branch ?? t('detached')">
          {{ destination.git.branch ?? t("detached") }}
          <small>{{ destination.git.head ?? t("No commits yet") }}</small>
        </dd>
      </div>
      <div>
        <dt>{{ t("Working tree") }}</dt>
        <dd :class="{ warning: destination.git.dirty }">
          {{
            destination.git.dirty
              ? t(
                  destination.git.changedFiles === 1
                    ? "{count} changed file"
                    : "{count} changed files",
                  { count: destination.git.changedFiles },
                )
              : t("Working tree clean")
          }}
          <small>{{ statusLabel(destination.git.dirty ? "warning" : "healthy") }}</small>
        </dd>
      </div>
    </dl>

    <code :title="destination.rootPath">{{ destination.rootPath }}</code>
    <p v-if="destination.repository" class="destination-repository-summary">
      {{
        t(
          destination.repository.branches.length === 1
            ? "{branches} local branch"
            : "{branches} local branches",
          { branches: destination.repository.branches.length },
        )
      }}
      ·
      {{
        t(
          destination.repository.worktrees.length === 1
            ? "{worktrees} worktree"
            : "{worktrees} worktrees",
          { worktrees: destination.repository.worktrees.length },
        )
      }}
    </p>
    <p>
      {{
        t(
          isCurrent
            ? "The current workspace remains active until the destination scan succeeds."
            : "Confirm destination before Atlas scans and opens it.",
        )
      }}
    </p>

    <footer>
      <button
        type="button"
        class="text-button"
        :disabled="pending"
        @click="emit('cancel')"
      >
        {{ t("Cancel preview") }}
      </button>
      <button
        type="button"
        class="primary-button"
        :disabled="pending || isCurrent"
        @click="emit('confirm')"
      >
        {{
          pending
            ? t("Scanning and opening…")
            : t(activeRoot ? "Switch project" : "Open project")
        }}
      </button>
    </footer>
  </section>
</template>
