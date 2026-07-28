<script setup lang="ts">
import type { WorktreeCreationPreview } from "~/utils/project-worktrees";

defineProps<{
  preview: WorktreeCreationPreview;
  pending?: boolean;
}>();
const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
const { t } = useAtlasI18n();
</script>

<template>
  <section
    class="project-destination-preview worktree-creation-preview"
    aria-live="polite"
    aria-labelledby="worktree-destination-title"
  >
    <header>
      <div>
        <span class="eyebrow">
          {{
            t(
              preview.creationMode === "new-branch"
                ? "New branch and worktree preview"
                : "New worktree preview",
            )
          }}
        </span>
        <h3 id="worktree-destination-title" :title="preview.branch">
          {{ preview.branch }}
        </h3>
      </div>
      <span class="availability-chip">{{ t("Ready to create") }}</span>
    </header>

    <dl class="project-identity-grid">
      <div>
        <dt>{{ t("Logical project") }}</dt>
        <dd :title="preview.logicalProjectPath">
          {{ preview.logicalProjectName }}
        </dd>
      </div>
      <div>
        <dt>
          {{
            t(
              preview.creationMode === "new-branch"
                ? "New local branch"
                : "Local branch",
            )
          }}
        </dt>
        <dd :title="preview.branch">
          {{ preview.branch }}
          <small>{{ preview.shortHead }}</small>
        </dd>
      </div>
      <div>
        <dt>{{ t("New worktree") }}</dt>
        <dd :title="preview.worktreePath">
          {{ preview.worktreeName }}
          <small>{{ t("Sibling folder") }}</small>
        </dd>
      </div>
      <div>
        <dt>
          {{
            t(
              preview.creationMode === "new-branch"
                ? "Starting checkout"
                : "Current checkout",
            )
          }}
        </dt>
        <dd :title="preview.sourceWorktreePath">
          {{
            preview.creationMode === "new-branch"
              ? (preview.baseBranch ?? t("detached"))
              : preview.sourceWorktreePath
          }}
          <small>{{ t("Remains unchanged") }}</small>
        </dd>
      </div>
    </dl>

    <code :title="preview.worktreePath">{{ preview.worktreePath }}</code>
    <p>
      {{
        t(
          preview.creationMode === "new-branch"
            ? "Confirm to create this local branch from the starting HEAD in a separate worktree, scan it, and open it. Atlas will not switch the starting checkout."
            : "Confirm to create this separate Git worktree, scan it, and open it. Atlas will not switch the branch of your current checkout.",
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
        :disabled="pending"
        @click="emit('confirm')"
      >
        {{
          pending
            ? t("Creating and opening...")
            : t(
                preview.creationMode === "new-branch"
                  ? "Create branch and open worktree"
                  : "Create and open worktree",
              )
        }}
      </button>
    </footer>
  </section>
</template>
