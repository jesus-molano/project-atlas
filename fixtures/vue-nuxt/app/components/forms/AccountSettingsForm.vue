<script setup lang="ts">
import type {
  SettingsFormEvents,
  SettingsFormProps,
} from "~/app/types/settings-form";

const {
  accountId,
  density = "comfortable",
  label = "Account settings",
  locked,
} = defineProps<SettingsFormProps>();

const emit = defineEmits<SettingsFormEvents>();

function submit() {
  emit("save", { changed: true });
}
</script>

<template>
  <form :data-account="accountId" :data-density="density" @submit.prevent="submit">
    <h2>{{ label }}</h2>
    <button type="submit" :disabled="locked">Save</button>
  </form>
</template>
