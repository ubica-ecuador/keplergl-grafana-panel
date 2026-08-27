import DefaultTheme from 'vitepress/theme';
import { h } from 'vue';

import Banner from './Banner.vue';
import Showcase from './Showcase.vue';

/**
 * The stock theme, with one addition: a banner under the home page hero.
 *
 * `home-hero-after` rather than the hero's own `image` slot — that one sits
 * beside the name and is where the logo goes, and a wide strip there would
 * fight it. Below the hero and above the features is where a product shot
 * reads as one.
 */
export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-after': () => h(Banner),
    });
  },
  enhanceApp({ app }) {
    // Global, so a markdown page can drop <Showcase /> in without importing.
    app.component('Showcase', Showcase);
  },
};
