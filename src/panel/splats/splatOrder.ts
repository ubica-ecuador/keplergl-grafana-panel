/**
 * The order splats are drawn in: farthest from the eye first.
 *
 * Splats blend one over another, so they must be drawn back to front, and the
 * glTF extension sorts by distance to the camera (its `cameraDistance`). A
 * distance does not change when the camera only turns, so the order is
 * worked out again only once the eye has moved (`needsResort`).
 *
 * A counting sort on 16-bit keys, as the web's splat viewers do: two passes
 * over the splats whatever their number, against a comparison sort's n log n.
 */

const BUCKETS = 65536;

/**
 * The splats' indices, farthest from `eye` first, as floats for a vertex
 * attribute (exact up to 2²⁴ splats). `out` is filled if it is long enough.
 */
export function backToFront(
  positions: Float32Array,
  count: number,
  eye: ArrayLike<number>,
  out?: Float32Array
): Float32Array {
  const order = out && out.length >= count ? out : new Float32Array(count);
  if (count === 0) {
    return order;
  }
  const distances = new Float32Array(count);
  let near = Infinity;
  let far = -Infinity;
  const [ex, ey, ez] = [eye[0], eye[1], eye[2]];
  for (let i = 0; i < count; i++) {
    const dx = positions[i * 3] - ex;
    const dy = positions[i * 3 + 1] - ey;
    const dz = positions[i * 3 + 2] - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    distances[i] = d;
    if (d < near) {
      near = d;
    }
    if (d > far) {
      far = d;
    }
  }
  const scale = far > near ? (BUCKETS - 1) / (far - near) : 0;
  const keys = new Uint16Array(count);
  const counts = new Uint32Array(BUCKETS);
  for (let i = 0; i < count; i++) {
    // The farthest gets key 0, so an ascending counting sort draws it first.
    const key = (BUCKETS - 1 - (distances[i] - near) * scale) | 0;
    keys[i] = key;
    counts[key]++;
  }
  let start = 0;
  for (let k = 0; k < BUCKETS; k++) {
    const n = counts[k];
    counts[k] = start;
    start += n;
  }
  for (let i = 0; i < count; i++) {
    order[counts[keys[i]]++] = i;
  }
  return order;
}

/**
 * Whether the eye has moved far enough from where the splats were last sorted
 * for the order to change much: by more than `tolerance` of its distance to
 * the splats' centre.
 */
export function needsResort(
  last: ArrayLike<number> | null | undefined,
  eye: ArrayLike<number>,
  centre: ArrayLike<number>,
  tolerance = 0.01
): boolean {
  if (!last) {
    return true;
  }
  const moved = Math.hypot(eye[0] - last[0], eye[1] - last[1], eye[2] - last[2]);
  const distance = Math.hypot(eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]);
  return moved > tolerance * Math.max(distance, 1e-6);
}
