<script setup lang="ts">
const { locale, setLocale, t } = useAtlasI18n();
</script>

<template>
  <div class="language-selector" role="group" :aria-label="t('Language')">
    <span>{{ t("Language") }}</span>
    <button
      type="button"
      :class="{ active: locale === 'en' }"
      :aria-pressed="locale === 'en'"
      :title="t('English')"
      @click="setLocale('en')"
    >
      EN
    </button>
    <button
      type="button"
      :class="{ active: locale === 'es' }"
      :aria-pressed="locale === 'es'"
      :title="t('Spanish')"
      @click="setLocale('es')"
    >
      ES
    </button>
  </div>
</template>
