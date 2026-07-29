<script setup lang="ts">
defineProps<{ message: string }>();
defineSlots<{
  action(props: { dismiss: () => void }): unknown;
}>();
</script>

<template>
  <aside>{{ message }}<slot name="action" :dismiss="() => undefined" /></aside>
</template>
