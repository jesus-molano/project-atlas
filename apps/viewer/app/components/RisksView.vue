<script setup lang="ts">
interface Risk {
  id: string;
  level: "decision-required" | "warning" | "resolved";
  kind: string;
  title: string;
  evidence: string[];
  recommendation: string;
  memoryIds: string[];
}
interface CurrentDecision {
  id: string;
  type: string;
  title: string;
  summary: string;
  status: string;
  provenance: "code-atlas" | "project-memory";
  updatedAt: string;
}
defineProps<{ risks: Risk[]; decisions: CurrentDecision[] }>();
const filter = ref<"open" | "all" | "resolved">("open");
</script>

<template>
  <div class="single-workspace">
    <header class="workspace-toolbar">
      <div>
        <span class="eyebrow">Preventive gate</span>
        <h2>Evidence-backed decisions and risks</h2>
      </div>
      <div class="segmented">
        <button :class="{ active: filter === 'open' }" @click="filter = 'open'">Open</button>
        <button :class="{ active: filter === 'resolved' }" @click="filter = 'resolved'">Resolved</button>
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">All</button>
      </div>
    </header>
    <section v-if="decisions.length" class="risk-ledger" aria-label="Current decisions">
      <article v-for="decision in decisions" :key="decision.id" class="risk-record resolved">
        <div class="risk-axis">
          <span />
          <small>{{ decision.status }}</small>
        </div>
        <div class="risk-copy">
          <span class="eyebrow">{{ decision.provenance }} · {{ decision.type }}</span>
          <h3>{{ decision.title }}</h3>
          <p>{{ decision.summary }}</p>
        </div>
        <div class="risk-links">
          <span>{{ decision.id }}</span>
        </div>
      </article>
    </section>
    <div
      v-if="!risks.some((risk) => filter === 'all' || (filter === 'open' ? risk.level !== 'resolved' : risk.level === 'resolved'))"
      class="section-empty compact"
    >
      <AtlasIcon name="check" />
      <h2>No findings in this view</h2>
      <p>The gate will surface contradictions, stale decisions, fragile areas, and failed attempts as evidence appears.</p>
    </div>
    <div v-else class="risk-ledger">
      <article
        v-for="risk in risks.filter((item) => filter === 'all' || (filter === 'open' ? item.level !== 'resolved' : item.level === 'resolved'))"
        :key="risk.id"
        :class="['risk-record', risk.level]"
      >
        <div class="risk-axis">
          <span />
          <small>{{ risk.level }}</small>
        </div>
        <div class="risk-copy">
          <span class="eyebrow">{{ risk.kind }}</span>
          <h3>{{ risk.title }}</h3>
          <ul><li v-for="line in risk.evidence" :key="line">{{ line }}</li></ul>
          <p><strong>Recommendation</strong>{{ risk.recommendation }}</p>
        </div>
        <div class="risk-links">
          <span v-for="id in risk.memoryIds" :key="id">{{ id }}</span>
        </div>
      </article>
    </div>
  </div>
</template>
