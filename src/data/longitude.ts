/**
 * Longitudes past ±180°, as a map that repeats the world hands them out: deck
 * unprojects a pixel on the copy east of the main world to 190°, not -170°.
 * Free of deck and React, for the data modules and the panel alike.
 */

/** A longitude brought into [-180, 180]; one already there is left as it is. */
export function wrapLongitude(longitude: number): number {
  if (!Number.isFinite(longitude) || (longitude >= -180 && longitude <= 180)) {
    return longitude;
  }
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** The copy of a longitude nearest to another, the view's centre: the same place, 360° at a time. */
export function nearestCopy(longitude: number, centre: number): number {
  if (!Number.isFinite(longitude) || !Number.isFinite(centre)) {
    return longitude;
  }
  return longitude + 360 * Math.round((centre - longitude) / 360);
}
