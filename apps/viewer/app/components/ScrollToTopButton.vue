<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    target?: HTMLElement;
    focusTarget?: HTMLElement;
    enabled?: boolean;
    placement?: "workspace" | "panel";
    threshold?: number;
    minOverflow?: number;
  }>(),
  {
    enabled: true,
    placement: "workspace",
    threshold: 420,
    minOverflow: 720,
  },
);

const { t } = useAtlasI18n();
const visible = ref(false);
let observedTarget: HTMLElement | undefined;
let resizeObserver: ResizeObserver | undefined;

function updateVisibility(): void {
  if (!props.enabled || !observedTarget) {
    visible.value = false;
    return;
  }
  const overflow = observedTarget.scrollHeight - observedTarget.clientHeight;
  visible.value =
    overflow > props.minOverflow && observedTarget.scrollTop > props.threshold;
}

function observeTarget(target?: HTMLElement): void {
  observedTarget?.removeEventListener("scroll", updateVisibility);
  resizeObserver?.disconnect();
  observedTarget = target;
  if (!target) {
    visible.value = false;
    return;
  }
  target.addEventListener("scroll", updateVisibility, { passive: true });
  resizeObserver = new ResizeObserver(updateVisibility);
  resizeObserver.observe(target);
  updateVisibility();
}

function returnToTop(): void {
  if (!observedTarget) return;
  observedTarget.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  (props.focusTarget ?? observedTarget).focus({ preventScroll: true });
}

watch(
  () => [props.target, props.enabled] as const,
  ([target]) => observeTarget(target),
  { flush: "post" },
);

onMounted(() => observeTarget(props.target));
onBeforeUnmount(() => observeTarget());
</script>

<template>
  <button
    v-if="visible"
    :class="['scroll-to-top-button', placement]"
    type="button"
    :aria-label="t('Back to top')"
    :title="t('Back to top')"
    @click="returnToTop"
  >
    <span aria-hidden="true">↑</span>
  </button>
</template>
