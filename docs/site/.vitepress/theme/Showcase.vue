<script setup lang="ts">
import { withBase } from 'vitepress';
import { computed, ref } from 'vue';

interface Shot {
  src: string;
  title: string;
  blurb: string;
  alt: string;
}

/**
 * Which pictures: `free` for the home page's dashboards, `plus` for the Plus overview. The Plus set is shown in a
 * frame of one shape, the pictures fitted inside it, so a slide of another shape does not move the page.
 */
const props = withDefaults(defineProps<{ set?: 'free' | 'plus' }>(), { set: 'free' });

const freeShots: Shot[] = [
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

const plusShots: Shot[] = [
  {
    src: '/img/plus/surface-under-buildings.jpg',
    title: 'Smart city sensors',
    blurb:
      "Melbourne's street sensors: a Surface between them laid under the base map's 3D buildings, a card with each sensor's series, the pedestrian counters and the parking bays on the same map.",
    alt: "Melbourne's centre tilted on a dark base map, the sensors' readings in coloured bands on the streets under the 3D buildings, with four sensor cards",
  },
  {
    src: '/img/plus/buildings.jpg',
    title: 'Every building, coloured by its sensors',
    blurb:
      "East Harlem in a heat wave: OpenStreetMap's buildings, each coloured by the temperature estimated from the street sensors around it, with no dataset of buildings.",
    alt: 'East Harlem tilted, every building coloured by the air temperature estimated from street sensors, the sensors as dots',
  },
  {
    src: '/img/plus/city-model.jpg',
    title: "An official city model, at a city's scale",
    blurb:
      "PLATEAU's model of Edogawa, Tokyo: some 77,000 buildings read in the browser, each coloured by the depth of the river flood expected at it.",
    alt: "Edogawa's 3D city model tilted over the Arakawa river, every building coloured by expected flood depth",
  },
  {
    src: '/img/plus/gaussian-splats.jpg',
    title: 'A factory as Gaussian splats',
    blurb:
      "A steelworks in Vietnam captured as a 5.3 GB scan of splats, streamed by view, with the air at each yard on a callout standing on the scan's roofs.",
    alt: 'An industrial port as a photographic Gaussian splat scan, with five air quality callouts over its sheds and yards',
  },
  {
    src: '/img/plus/indoor-audimax.jpg',
    title: 'Indoors, from the evacuation plans',
    blurb:
      "Universität Hamburg's Audimax: its floors and rooms drawn from the building's evacuation plans laid on the map, each room in the colour of its CO₂ (simulated readings), the floor picker giving each floor's worst.",
    alt: 'The Audimax ground floor tilted, its rooms green and the lecture hall orange over the evacuation plan, with five room cards and the floor picker',
  },
  {
    src: '/img/plus/indoor-urban-sciences.jpg',
    title: 'Every room, live',
    blurb:
      "Newcastle University's Urban Sciences Building, seven floors room by room: each room's CO₂, temperature and humidity from the Urban Observatory's live sensors, the other floors seen through.",
    alt: "The Urban Sciences Building's first floor, its rooms' CO₂ in rings with their temperature and humidity, the other floors faint",
  },
  {
    src: '/img/plus/indoor-south-station.jpg',
    title: 'A station on six levels',
    blurb:
      "Boston's South Station from the Red Line under the street to the bus terminal: the commuter trains at their tracks and an escalator out of service on its level, live from the MBTA.",
    alt: "South Station's levels stacked in 3D on a dark map, trains at the platforms and two red cards for an escalator out of service",
  },
  {
    src: '/img/plus/model-4d.jpg',
    title: 'A building in 4D',
    blurb:
      "A BIM model's parts built in time from the schedule: a Time Brush moves through the works, and what is late shows in red.",
    alt: 'An apartment block in Nijmegen half built, its parts coloured by material and schedule',
  },
  {
    src: '/img/plus/model-4d-wivenhoe.jpg',
    title: 'A power station, floor by floor',
    blurb:
      "Wivenhoe's pumped hydro in Queensland: its two reversible units in 3D on the relief by the dam, each in the colour of AEMO's five-minute readings, one pumping at −247 MW.",
    alt: "Wivenhoe power station's model on satellite imagery and relief, unit 1 in blue with its card at −247 MW, unit 2 grey at 0 MW, and the floor picker",
  },
  {
    src: '/img/plus/model-4d-dsn.jpg',
    title: 'Antennas that turn',
    blurb:
      "NASA's Deep Space Network live at Goldstone: each antenna's model turned to the spacecraft it is talking to, with its data rate on a card, and a Time Brush to replay the day.",
    alt: 'Goldstone tilted on satellite imagery, four antennas in 3D with cards naming Europa Clipper, Parker Solar Probe and BioSentinel and their data rates',
  },
  {
    src: '/img/plus/european-grid.jpg',
    title: 'Networks and flows',
    blurb:
      "Europe's power grid on one map: the renewable share as gauges, demand as 3D bars and the interconnectors' flows as comets along each link.",
    alt: 'European power grid with renewable share as gauges, demand as 3D bars and interconnector flows as Traffic links',
  },
];

const shots = props.set === 'plus' ? plusShots : freeShots;

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
  <section
    class="showcase"
    :class="{ plus: props.set === 'plus' }"
    aria-roledescription="carousel"
    :aria-label="props.set === 'plus' ? 'Maps built with Plus' : 'Dashboards built with the panel'"
  >
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

/* In a doc page: the page's own width, one frame shape, the pictures fitted inside. */
.showcase.plus {
  padding: 0;
  margin: 24px 0;
}
.showcase.plus .frame img {
  aspect-ratio: 1468 / 770;
  object-fit: contain;
  margin: 0;
}
.showcase.plus .caption {
  min-height: 112px;
}
.showcase.plus .caption h3 {
  border: 0;
  padding: 0;
}

@media (max-width: 640px) {
  .showcase { padding: 0 16px; }
  .arrow { width: 32px; height: 32px; font-size: 18px; }
  .caption { min-height: 110px; }
}
</style>
