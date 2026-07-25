<script setup lang="ts">
defineProps<{ message: string }>()
</script>

<template>
  <p class="text-sm muted-copy">{{ message }}</p>
</template>
