<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string
    meta?: string
    shape?: 'a' | 'b' | 'c' | 'd'
    tone?: string
  }>(),
  { shape: 'a', meta: '', tone: '' },
)
</script>

<template>
  <article class="stone" :class="`stone-${shape}`">
    <div class="stone-label">{{ label }}</div>
    <div class="stone-value" :class="tone">{{ value }}</div>
    <div v-if="meta" class="stone-meta">{{ meta }}</div>
  </article>
</template>
