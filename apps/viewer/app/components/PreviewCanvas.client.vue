<script setup lang="ts">
import type {
  ComponentNode,
  PreviewViewport,
} from "@component-atlas/core/types";

const props = defineProps<{
  component: ComponentNode;
  previewOrigin: string;
  values: Record<string, unknown>;
  tokens: Record<string, string>;
  viewport: PreviewViewport;
  background: string;
  actionNames: string[];
}>();

const emit = defineEmits<{
  status: [status: "booting" | "ready" | "error", message?: string];
  action: [name: string];
}>();

const host = ref<HTMLElement>();
const frame = ref<HTMLIFrameElement>();
const scale = ref(1);
let observer: ResizeObserver | undefined;

const source = computed(() => {
  if (!props.previewOrigin) return "";
  const query = new URLSearchParams({
    component: props.component.sourcePath.replaceAll("\\", "/"),
    export: props.component.framework === "react" ? props.component.name : "default",
  });
  return `${props.previewOrigin}/preview?${query.toString()}`;
});

const scaledHeight = computed(() => Math.max(180, props.viewport.height * scale.value));
const scaledWidth = computed(() => props.viewport.width * scale.value);

function resize(): void {
  if (!host.value) return;
  const availableWidth = Math.max(240, host.value.clientWidth - 56);
  const availableHeight = Math.max(180, host.value.clientHeight - 56);
  scale.value = Math.min(
    1,
    availableWidth / props.viewport.width,
    availableHeight / props.viewport.height,
  );
}

function pushState(): void {
  try {
    const state = JSON.parse(
      JSON.stringify({
        props: props.values,
        tokens: props.tokens,
        background: props.background,
        actionNames: props.actionNames,
      }),
    ) as {
      props: Record<string, unknown>;
      tokens: Record<string, string>;
      background: string;
      actionNames: string[];
    };
    frame.value?.contentWindow?.postMessage(
      {
        source: "component-atlas-host",
        state,
      },
      props.previewOrigin || "*",
    );
  } catch (error) {
    emit(
      "status",
      "error",
      error instanceof Error
        ? error.message
        : "Preview state is not serializable.",
    );
  }
}

function receive(event: MessageEvent): void {
  if (
    !props.previewOrigin ||
    event.origin !== props.previewOrigin ||
    event.data?.source !== "component-atlas-preview"
  ) {
    return;
  }
  if (event.data.type === "ready") {
    emit("status", "ready");
    pushState();
  } else if (event.data.type === "rendered") {
    emit("status", "ready");
  } else if (event.data.type === "error") {
    emit("status", "error", String(event.data.message ?? "Unknown render error"));
  } else if (event.data.type === "action") {
    emit("action", String(event.data.name ?? "event"));
  }
}

watch(
  () => [props.values, props.tokens, props.background, props.actionNames],
  pushState,
  { deep: true },
);
watch(() => props.viewport, resize, { deep: true });
watch(source, () => emit("status", "booting"));

onMounted(() => {
  observer = new ResizeObserver(resize);
  if (host.value) observer.observe(host.value);
  window.addEventListener("message", receive);
  resize();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("message", receive);
});
</script>

<template>
  <div ref="host" class="preview-host">
    <div v-if="!previewOrigin" class="preview-offline">
      <span class="offline-orbit" />
      <strong>Preview engine is offline</strong>
      <p>Launch Atlas with the CLI <code>open</code> command to render components.</p>
    </div>
    <div
      v-else
      class="preview-scale-stage"
      :style="{
        width: `${scaledWidth}px`,
        height: `${scaledHeight}px`,
      }"
    >
      <div
        class="preview-device"
        :style="{
          width: `${viewport.width}px`,
          height: `${viewport.height}px`,
          transform: `scale(${scale})`,
          background,
        }"
      >
        <iframe
          ref="frame"
          :key="source"
          :src="source"
          :title="`${component.effectiveName} live preview`"
          @load="pushState"
        />
      </div>
    </div>
  </div>
</template>
