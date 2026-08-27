<script setup lang="ts">
defineProps<{
  tone?: 'ok' | 'warn' | 'off' | 'muted'
  label: string
}>()
</script>

<template>
  <span class="badge" :class="tone || 'muted'">{{ label }}</span>
</template>
