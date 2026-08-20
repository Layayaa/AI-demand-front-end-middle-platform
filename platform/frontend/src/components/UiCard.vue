<script setup lang="ts">
withDefaults(
  defineProps<{
    shape?: 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
  }>(),
  { shape: 'a' },
)
</script>

<template>
  <section class="card" :class="`card-${shape}`">
    <slot />
  </section>
</template>
