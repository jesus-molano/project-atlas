<script setup lang="ts">
type ModalSize = 'sm' | 'md' | 'lg'

interface Props {
  title: string
  open?: boolean
  size?: ModalSize
}

withDefaults(defineProps<Props>(), {
  open: false,
  size: 'md',
})

defineEmits<{
  close: []
  confirm: [value: boolean]
}>()

defineSlots<{
  default(): unknown
  footer(): unknown
}>()
</script>

<template>
  <section v-if="open" class="rounded-xl border surface-panel">
    <header class="flex items-center justify-between">
      <h2>{{ title }}</h2>
      <button @click="$emit('close')">Close</button>
    </header>
    <slot />
    <slot name="footer" />
  </section>
</template>
