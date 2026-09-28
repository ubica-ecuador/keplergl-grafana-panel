/**
 * Where a time sits on one of kepler's time bars, and back.
 *
 * Both bars lay a linear time axis across a track that starts some way into
 * their container: the enlarged `RangeSlider` pads by half a handle and spans
 * its *display* range (the domain widened by a bin each side when there is a
 * histogram); the minified `TimelineSlider` sits between two date labels. The
 * caller measures the track, so these two stay a pure linear map.
 */
export interface TimeBarGeometry {
  /** The track's left edge, from the container's left edge, in px. */
  left: number;
  /** The track's width in px. */
  width: number;
  /** The range the track spans, in epoch ms. */
  range: readonly [number, number];
}

function isValid({ left, width, range }: TimeBarGeometry) {
  return Number.isFinite(left) && width > 0 && range.every(Number.isFinite) && range[1] > range[0];
}

/** The time under an x offset from the container's left edge; null off the track. */
export function timeAtX(x: number, geometry: TimeBarGeometry): number | null {
  if (!isValid(geometry) || !Number.isFinite(x)) {
    return null;
  }
  const fraction = (x - geometry.left) / geometry.width;
  if (fraction < 0 || fraction > 1) {
    return null;
  }
  const [from, to] = geometry.range;
  return from + fraction * (to - from);
}

/** The x offset of a time on the track; null outside the displayed range. */
export function xAtTime(time: number, geometry: TimeBarGeometry): number | null {
  const [from, to] = geometry.range;
  if (!isValid(geometry) || !Number.isFinite(time) || time < from || time > to) {
    return null;
  }
  return geometry.left + ((time - from) / (to - from)) * geometry.width;
}
