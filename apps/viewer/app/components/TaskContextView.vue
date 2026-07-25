<script setup lang="ts">
import type { DesignFileIndex } from "@component-atlas/design";

interface CompactContext {
  task: string;
  project?: { name: string; framework: string; scannedAt: string };
  memory?: Array<Record<string, unknown>>;
  code?: Array<Record<string, unknown>>;
  design?: {
    available: boolean;
    selectionRequired?: boolean;
    files?: Array<{ key: string; name?: string }>;
    candidates?: Array<Record<string, unknown>>;
  };
  findings?: Array<Record<string, unknown>>;
  gate?: Record<string, unknown>;
  nextSteps?: string[];
  metrics: {
    budgetChars: number;
    usedChars: number;
    estimatedTokens: number;
    truncated: boolean;
    totalMatches: number;
    expandableIds: string[];
  };
}

const props = defineProps<{
  designIndexes: DesignFileIndex[];
  defaultBudget: number;
  defaultTopK: number;
}>();
const task = ref("");
const budgetChars = ref(props.defaultBudget);
const figmaFile = ref("");
const topK = ref(props.defaultTopK);
const result = ref<CompactContext>();
const pending = ref(false);
const error = ref("");
const copied = ref(false);

async function generate(): Promise<void> {
  error.value = "";
  copied.value = false;
  pending.value = true;
  try {
    result.value = await $fetch<CompactContext>("/api/task-context", {
      method: "POST",
      body: {
        task: task.value,
        budgetChars: budgetChars.value,
        ...(figmaFile.value ? { figmaFile: figmaFile.value } : {}),
        topK: topK.value,
      },
    });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    pending.value = false;
  }
}

async function copyPackage(): Promise<void> {
  if (!result.value) return;
  await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2));
  copied.value = true;
}
</script>

<template>
  <div class="task-context-layout">
    <section class="task-composer">
      <header>
        <span class="eyebrow">Compact context builder</span>
        <h2>Prepare implementation evidence</h2>
        <p>
          Describe the task. Atlas retrieves a few explainable candidates from
          code, design, and memory under one hard budget.
        </p>
      </header>
      <label class="field-label">
        Task
        <textarea
          v-model="task"
          rows="6"
          placeholder="Example: add a study filter to search and keep it in the URL"
        />
      </label>
      <div class="composer-row">
        <label class="field-label">
          Design source
          <select v-model="figmaFile">
            <option value="">Automatic / none</option>
            <option
              v-for="index in designIndexes"
              :key="index.file.key"
              :value="index.file.key"
            >
              {{ index.file.name ?? index.file.key }}
            </option>
          </select>
        </label>
        <label class="field-label">
          Hard cap
          <select v-model.number="budgetChars">
            <option :value="2400">2,400 chars · ~600 tokens</option>
            <option :value="3600">3,600 chars · ~900 tokens</option>
            <option :value="4200">4,200 chars · ~1,050 tokens</option>
            <option :value="6000">6,000 chars · ~1,500 tokens</option>
          </select>
        </label>
        <label class="field-label">
          Candidates
          <select v-model.number="topK">
            <option :value="3">Top 3</option>
            <option :value="5">Top 5</option>
            <option :value="8">Top 8</option>
          </select>
        </label>
      </div>
      <button class="primary-button" :disabled="pending || !task.trim()" @click="generate">
        {{ pending ? "Retrieving local evidence…" : "Generate compact package" }}
      </button>
      <p v-if="error" class="inline-error">{{ error }}</p>
    </section>

    <section class="context-results">
      <div v-if="!result" class="section-empty compact">
        <span class="empty-code">TC / READY</span>
        <h2>No package generated</h2>
        <p>Navigation is token-free. Only this explicit action composes agent context.</p>
      </div>
      <template v-else>
        <header class="workspace-toolbar">
          <div>
            <span class="eyebrow">Evidence package</span>
            <h2>{{ result.task }}</h2>
          </div>
          <button class="secondary-button" @click="copyPackage">
            {{ copied ? "Copied" : "Copy package" }}
          </button>
        </header>
        <div class="candidate-columns">
          <section>
            <header><span class="source-dot memory" />Memory <small>{{ result.memory?.length ?? 0 }}</small></header>
            <article v-for="item in result.memory" :key="String(item.id)">
              <strong>{{ item.title }}</strong><p>{{ item.summary }}</p>
              <small>{{ item.authority }} · {{ Math.round(Number(item.confidence) * 100) }}%</small>
            </article>
          </section>
          <section>
            <header><span class="source-dot code" />Code <small>{{ result.code?.length ?? 0 }}</small></header>
            <article v-for="item in result.code" :key="String(item.id)">
              <strong>{{ item.name }}</strong><p>{{ item.path }}</p>
              <small>{{ item.scope }} · {{ item.directConsumers }} direct consumers</small>
            </article>
          </section>
          <section>
            <header><span class="source-dot design" />Design <small>{{ result.design?.candidates?.length ?? 0 }}</small></header>
            <article v-for="item in result.design?.candidates" :key="String(item.id)">
              <strong>{{ item.name }}</strong><p>{{ item.status }}</p>
              <small>{{ item.confidence }} confidence</small>
            </article>
            <p v-if="result.design?.selectionRequired" class="inline-warning">
              Multiple design indexes exist. Select one explicitly.
            </p>
          </section>
        </div>
        <section v-if="result.findings?.length" class="package-findings">
          <h3>Decision gate</h3>
          <article v-for="finding in result.findings" :key="String(finding.id)">
            <strong>{{ finding.title }}</strong>
            <p>{{ finding.recommendation }}</p>
          </article>
        </section>
      </template>
    </section>

    <aside class="context-inspector">
      <span class="eyebrow">Context inspector</span>
      <h2>{{ result ? `${result.metrics.estimatedTokens} tokens` : "Budget inactive" }}</h2>
      <div class="budget-meter">
        <span
          :style="{
            width: result
              ? `${Math.min(100, (result.metrics.usedChars / result.metrics.budgetChars) * 100)}%`
              : '0%',
          }"
        />
      </div>
      <dl class="stacked-facts">
        <div><dt>Hard cap</dt><dd>{{ result?.metrics.budgetChars ?? budgetChars }} chars</dd></div>
        <div><dt>Used</dt><dd>{{ result?.metrics.usedChars ?? 0 }} chars</dd></div>
        <div><dt>Matches</dt><dd>{{ result?.metrics.totalMatches ?? 0 }}</dd></div>
        <div><dt>Truncated</dt><dd>{{ result?.metrics.truncated ? "Yes" : "No" }}</dd></div>
      </dl>
      <section v-if="result?.metrics.expandableIds.length">
        <h3>Expandable handles</h3>
        <code v-for="id in result.metrics.expandableIds" :key="id">{{ id }}</code>
      </section>
      <p>
        The human interface can browse every local index. Only this bounded
        package is intended for an agent.
      </p>
    </aside>
  </div>
</template>
