<template>
  <div class="banner">
    <img
      src="/img/banner.jpg"
      alt="The Amazon basin drawn as a velocity field: every tributary traced by streamlines over a dark basemap"
      width="1234"
      height="450"
    />
  </div>
</template>

<style scoped>
/* Full-bleed inside the home container, and clipped rather than letterboxed:
   the image is a wide strip, so on a narrow screen the middle is what matters. */
.banner {
  max-width: 1152px;
  margin: 0 auto;
  padding: 0 24px;
}
.banner img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
}
@media (max-width: 640px) {
  .banner { padding: 0 16px; }
}
</style>
