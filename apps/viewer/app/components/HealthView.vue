<script setup lang="ts">
import type { SourceHealthViewModel } from "@component-atlas/runtime";
import type { ProjectCapabilityReport } from "@component-atlas/core/browser";

defineProps<{
  sources: SourceHealthViewModel[];
  capabilities: ProjectCapabilityReport;
  rootPath: string;
  localHealth: Array<{
    id: string;
    level: "warning";
    title: string;
    detail: string;
    recommendation: string;
  }>;
}>();
const emit = defineEmits<{ refreshed: [] }>();
const pending = ref("");
const message = ref("");
const error = ref("");
const labels: Record<string, string> = {
  figma: "Figma",
  "atlassian-rovo": "Atlassian Rovo",
  github: "GitHub",
  "ready-for-dev": "Ready for Dev",
  "figma-variables": "Figma Variables",
  "code-connect": "Code Connect",
  "figma-libraries": "Figma libraries",
};

async function refresh(source: "repository" | "memory"): Promise<void> {
  pending.value = source;
  error.value = "";
  try {
    await $fetch("/api/refresh", { method: "POST", body: { source } });
    message.value = `${source} index refreshed.`;
    emit("refreshed");
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    pending.value = "";
  }
}
</script>

<template>
  <div class="single-workspace health-grid">
    <section>
      <header class="workspace-toolbar"><div><span class="eyebrow">Local source plane</span><h2>Indexes and freshness</h2></div></header>
      <article v-for="source in sources" :key="source.id" class="health-record">
        <span :class="['health-orb', source.status]" />
        <div><strong>{{ source.label }}</strong><p>{{ source.detail }}</p><small>{{ source.lastIndexedAt ?? "Never indexed" }}</small></div>
        <button
          v-if="source.source === 'repository' || source.source === 'memory'"
          class="secondary-button"
          :disabled="Boolean(pending)"
          @click="refresh(source.source)"
        >
          {{ pending === source.source ? "Refreshing…" : "Refresh" }}
        </button>
        <span v-else class="status-chip">{{ source.status }}</span>
      </article>
      <p v-if="message" class="inline-success">{{ message }}</p>
      <p v-if="error" class="inline-error">{{ error }}</p>
      <article
        v-for="finding in localHealth"
        :key="finding.id"
        class="health-record optional"
      >
        <span class="health-orb stale" />
        <div>
          <strong>{{ finding.title }}</strong>
          <p>{{ finding.detail }}</p>
          <code>{{ finding.recommendation }}</code>
        </div>
        <span class="status-chip">setup</span>
      </article>
    </section>
    <section>
      <header class="workspace-toolbar"><div><span class="eyebrow">Observed capabilities</span><h2>Connectors</h2></div></header>
      <article v-for="source in capabilities.observations.filter((item) => item.kind === 'connector')" :key="source.id" class="health-record optional">
        <span :class="['health-orb', source.state]" /><div><strong>{{ labels[source.id] ?? source.id }}</strong><p>{{ source.detail }}</p><small>{{ source.provenance }} · {{ source.checkedAt }}</small></div><span class="status-chip">{{ source.state }}</span>
      </article>
      <header class="workspace-toolbar"><div><span class="eyebrow">Optional evidence</span><h2>Enrichments</h2></div></header>
      <article v-for="source in capabilities.observations.filter((item) => item.kind === 'enrichment')" :key="source.id" class="health-record optional">
        <span :class="['health-orb', source.state]" /><div><strong>{{ labels[source.id] ?? source.id }}</strong><p>{{ source.detail }}</p><small>{{ source.provenance }} · {{ source.checkedAt }}</small></div><span class="status-chip">{{ source.state }}</span>
      </article>
    </section>
    <aside class="health-policy">
      <span class="eyebrow">Workspace isolation</span>
      <h2>{{ rootPath }}</h2>
      <p>SQLite memory and design evidence use the logical repository identity. Code snapshots remain separate per checkout/worktree.</p>
      <dl class="stacked-facts">
        <div><dt>Network on browse</dt><dd>None</dd></div>
        <div><dt>Credentials stored</dt><dd>None</dd></div>
        <div><dt>Semantic writes</dt><dd>Approval required</dd></div>
        <div><dt>Derived refresh</dt><dd>Local actions above</dd></div>
      </dl>
    </aside>
  </div>
</template>
