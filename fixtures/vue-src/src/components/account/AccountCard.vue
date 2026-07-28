<script setup lang="ts">
import BaseButton from "@/components/ui/BaseButton.vue";

defineProps<{ accountName: string }>();
</script>

<template>
  <article>
    <h2>{{ accountName }}</h2>
    <BaseButton label="Open" />
  </article>
</template>
