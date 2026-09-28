/** Epoch milliseconds and deck's longitude/latitude/altitude coordinate order. */
export interface TrajectorySample {
  time: number;
  position: [number, number, number];
  row: number;
}

export type TrajectoryTimeIndex = ReadonlyArray<readonly TrajectorySample[]>;

export function trajectoryTimeIndex(groups: Iterable<readonly TrajectorySample[]>): TrajectoryTimeIndex {
  return Array.from(groups, (samples) =>
    samples
      .filter(
        ({ time, position }) =>
          Number.isFinite(time) &&
          position.every(Number.isFinite) &&
          Math.abs(position[0]) <= 180 &&
          Math.abs(position[1]) <= 90
      )
      .sort((a, b) => a.time - b.time)
  ).filter((samples) => samples.length > 0);
}

/** Last sample at or before the cursor. Never extend a trip beyond its domain. */
export function positionsAtTime(index: TrajectoryTimeIndex, time: number, maxAgeMs: number): TrajectorySample[] {
  if (!Number.isFinite(time) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    return [];
  }
  const result: TrajectorySample[] = [];
  for (const samples of index) {
    if (time < samples[0].time || time > samples[samples.length - 1].time) {
      continue;
    }
    let lo = 0;
    let hi = samples.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (samples[mid].time <= time) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const sample = samples[lo - 1];
    if (sample && time - sample.time <= maxAgeMs) {
      result.push(sample);
    }
  }
  return result;
}
