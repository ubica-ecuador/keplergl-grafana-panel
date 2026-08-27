<script setup lang="ts">
import { withBase } from 'vitepress';
import { computed, ref } from 'vue';

interface Shot {
  src: string;
  title: string;
  blurb: string;
  alt: string;
}

const shots: Shot[] = [
  {
    src: '/img/showcase/zarr-stats.jpg',
    title: 'Zarr, drawn and measured',
    blurb:
      'A Zarr store rendered live, and the rectangle drawn on the map measured in the same month the layer is showing — mean, minimum and maximum, from one request.',
    alt: 'Global monthly temperature from a Zarr store, with a rectangle drawn over the Mediterranean and the mean, minimum and maximum beside it',
  },
  {
    src: '/img/showcase/chirps-rain.jpg',
    title: 'Daily rainfall, and its clock',
    blurb:
      'CHIRPS as one cloud-optimised GeoTIFF per day. Dragging the time bar changes the picture without re-running the query or moving the frame.',
    alt: 'Daily CHIRPS rainfall over South America beside a time series of intensity and rain-covered area',
  },
  {
    src: '/img/showcase/earthquakes.jpg',
    title: 'Seismicity in three dimensions',
    blurb:
      "Magnitude as height and colour, kepler's own layer panel open, and a click on the map publishing its coordinate to the panels below.",
    alt: 'Global earthquakes as 3D columns coloured by magnitude, with the kepler layer panel open',
  },
  {
    src: '/img/showcase/fires.jpg',
    title: 'Active fires, ranked as you pan',
    blurb:
      'Hotspots on a 0.1° grid, with the table beside it ranking whatever is in view — trend, magnitude and anomaly per region.',
    alt: 'Active fire hotspots over South America and Africa beside a ranked table of regions with sparklines',
  },
  {
    src: '/img/showcase/water-risk.jpg',
    title: 'Polygons straight from the database',
    blurb:
      'WRI Aqueduct basins as GeoJSON, coloured by score over a satellite basemap, with the per-country average alongside.',
    alt: 'Water-risk basins across South America coloured red to blue over a satellite basemap',
  },
  {
    src: '/img/showcase/severe-weather.jpg',
    title: 'Reports, filtered both ways',
    blurb:
      'NOAA storm reports by type over a light basemap. The dashboard variables filter the map, and the map filters the counts.',
    alt: 'Severe weather reports across the United States coloured by event type, with counts by category',
  },
];

const index = ref(0);
const current = computed(() => shots[index.value]);

/**
 * The site is served under a base path, and only *static* `src` attributes get
 * it prepended at build time — the compiler can see those. A bound `:src` is
 * opaque to it, so the base has to be applied by hand or every picture 404s
 * while the banner beside it, written statically, works fine.
 */
const src = computed(() => withBase(current.value.src));

function go(step: number) {
  index.value = (index.value + step + shots.length) % shots.length;
}
</script>

<template>
  <section class="showcase" aria-roledescription="carousel" aria-label="Dashboards built with the panel">
    <div class="frame">
      <img
        :src="src"
        :alt="current.alt"
        width="1600"
        height="824"
        decoding="async"
        :loading="index === 0 ? 'eager' : 'lazy'"
      />

      <button class="arrow left" type="button" aria-label="Previous dashboard" @click="go(-1)">‹</button>
      <button class="arrow right" type="button" aria-label="Next dashboard" @click="go(1)">›</button>
    </div>

    <!-- aria-live so the caption is announced when the picture changes; the
         image alt alone is not, because the element is only swapped. -->
    <div class="caption" aria-live="polite">
      <h3>{{ current.title }}</h3>
      <p>{{ current.blurb }}</p>
    </div>

    <div class="dots" role="tablist">
      <button
        v-for="(shot, i) in shots"
        :key="shot.src"
        type="button"
        role="tab"
        class="dot"
        :class="{ on: i === index }"
        :aria-selected="i === index"
        :aria-label="shot.title"
        @click="index = i"
      />
    </div>
  </section>
</template>

<style scoped>
.showcase {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}

.frame {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.frame img {
  display: block;
  width: 100%;
  height: auto;
}

.arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.85;
  transition: opacity 0.2s, border-color 0.2s;
}
.arrow:hover {
  opacity: 1;
  border-color: var(--vp-c-brand-1);
}
.left { left: 12px; }
.right { right: 12px; }

.caption {
  margin-top: 16px;
  min-height: 84px;
}
.caption h3 {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
}
.caption p {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 15px;
  line-height: 1.6;
}

.dots {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}
.dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--vp-c-divider);
  cursor: pointer;
  transition: background 0.2s;
}
.dot.on { background: var(--vp-c-brand-1); }

@media (max-width: 640px) {
  .showcase { padding: 0 16px; }
  .arrow { width: 32px; height: 32px; font-size: 18px; }
  .caption { min-height: 110px; }
}
</style>
