<script setup lang="ts">
interface Props {
  title: string
  message: string
}

defineProps<Props>()
defineEmits<{ confirm: []; close: [] }>()
</script>

<template>
  <UiBaseModal :title="title" open class="rounded-xl surface-panel">
    <p>{{ message }}</p>
    <template #footer>
      <button @click="$emit('close')">Cancel</button>
      <button @click="$emit('confirm')">Confirm</button>
    </template>
  </UiBaseModal>
</template>
