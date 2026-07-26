<script setup lang="ts">
export type AtlasIconName =
  | "activity"
  | "arrow-right"
  | "branch"
  | "check"
  | "chevron-down"
  | "code"
  | "design"
  | "folder"
  | "home"
  | "inbox"
  | "memory"
  | "menu"
  | "plug"
  | "refresh"
  | "risk"
  | "search"
  | "settings"
  | "task"
  | "x";

defineProps<{
  name: AtlasIconName;
}>();
</script>

<template>
  <svg
    class="atlas-icon"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <g v-if="name === 'home'">
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9.5v10h13v-10M9.5 19.5v-6h5v6" />
    </g>
    <g v-else-if="name === 'folder'">
      <path d="M3.5 6.5h6l2 2h9v10h-17z" />
      <path d="M3.5 9h17" />
    </g>
    <g v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </g>
    <g v-else-if="name === 'code'">
      <path d="m9 6-5 6 5 6M15 6l5 6-5 6M13.5 4 10.5 20" />
    </g>
    <g v-else-if="name === 'design'">
      <path d="m12 3 8 4.5-8 4.5-8-4.5z" />
      <path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
    </g>
    <g v-else-if="name === 'memory'">
      <path d="M8 4.5a3.5 3.5 0 0 0-3.5 3.5c0 .8.3 1.6.8 2.2A4 4 0 0 0 7 17.7V20h4V4.5z" />
      <path d="M16 4.5A3.5 3.5 0 0 1 19.5 8c0 .8-.3 1.6-.8 2.2a4 4 0 0 1-1.7 7.5V20h-4V4.5zM8 9h3M13 9h3M7.5 14H11M13 14h3.5" />
    </g>
    <g v-else-if="name === 'task'">
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
      <path d="m15.5 16.5 1.5 1.5 3-3" />
    </g>
    <g v-else-if="name === 'risk'">
      <path d="M12 3.5 21 20H3z" />
      <path d="M12 9v5M12 17.5h.01" />
    </g>
    <g v-else-if="name === 'inbox'">
      <path d="M4 4.5h16v15H4zM4 14h4l2 2h4l2-2h4" />
    </g>
    <g v-else-if="name === 'plug'">
      <path d="M9 3.5v5M15 3.5v5M7 8.5h10v2a5 5 0 0 1-5 5v5" />
    </g>
    <g v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
    </g>
    <g v-else-if="name === 'branch'">
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10M8 9c5 0 4-2 8-2" />
    </g>
    <g v-else-if="name === 'activity'">
      <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
    </g>
    <g v-else-if="name === 'refresh'">
      <path d="M19.5 8A8 8 0 1 0 20 15" />
      <path d="M19.5 3.5V8h-4.5" />
    </g>
    <g v-else-if="name === 'check'">
      <path d="m4.5 12.5 4.5 4.5 10.5-11" />
    </g>
    <g v-else-if="name === 'x'">
      <path d="m6 6 12 12M18 6 6 18" />
    </g>
    <g v-else-if="name === 'chevron-down'">
      <path d="m6 9 6 6 6-6" />
    </g>
    <g v-else-if="name === 'arrow-right'">
      <path d="M4 12h16M14 6l6 6-6 6" />
    </g>
    <g v-else>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </g>
  </svg>
</template>
