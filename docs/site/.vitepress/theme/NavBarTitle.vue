<script setup lang="ts">
/**
 * The stock nav bar title, swapped in for VitePress's own `VPNavBarTitle.vue`
 * by an alias in `config.ts`, with one change: under `/plus/` it shows the
 * Plus edition's logo and name, and links to the Plus overview.
 *
 * The site's `logo` and `title` stay the free panel's, so every other page and
 * the search index are unchanged.
 */
import { computed } from 'vue';
import { useData, withBase } from 'vitepress';
import { useSidebar } from 'vitepress/theme';

import { isPlusPage, PLUS_LOGO, PLUS_TITLE } from '../plus';

const { site, theme, page } = useData();
const { hasSidebar } = useSidebar();

const plus = computed(() => isPlusPage(page.value.relativePath));
const logo = computed(() => (plus.value ? PLUS_LOGO : theme.value.logo));
const title = computed(() => (plus.value ? PLUS_TITLE : site.value.title));
const link = computed(() => withBase(plus.value ? '/plus/' : '/'));
</script>

<template>
  <div class="VPNavBarTitle" :class="{ 'has-sidebar': hasSidebar }">
    <a class="title" :href="link">
      <slot name="nav-bar-title-before" />
      <img v-if="logo" class="logo" :src="withBase(logo)" alt="" />
      <span>{{ title }}</span>
      <slot name="nav-bar-title-after" />
    </a>
  </div>
</template>

<style scoped>
.title {
  display: flex;
  align-items: center;
  border-bottom: 1px solid transparent;
  width: 100%;
  height: var(--vp-nav-height);
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  transition: opacity 0.25s;
}

@media (min-width: 960px) {
  .title {
    flex-shrink: 0;
  }

  .VPNavBarTitle.has-sidebar .title {
    border-bottom-color: var(--vp-c-divider);
  }
}

.logo {
  margin-right: 8px;
  height: var(--vp-nav-logo-height);
}
</style>
