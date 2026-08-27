import { TripsLayer } from '@deck.gl/geo-layers';

/**
 * The deck.gl layer that draws the traced streamlines.
 *
 * Thin by design: the paths already carry their own timestamps, so all that is
 * left is a trail running along them. Kept apart from `flowFieldLayer.ts` so
 * that module stays free of deck imports and can be tested without loading the
 * whole graph, the way `zarrDeckLayer.ts` is kept apart from `zarrTileLayer.ts`.
 */

/** Builds the trips layer, in the shape `makeFlowFieldLayer` asks for. */
export const buildFlowFieldDeckLayer = (props: Record<string, unknown>): unknown =>
  new TripsLayer({
    getPath: (line: { path: number[][] }) => line.path,
    // The fourth value of each vertex. deck reads a position as its first three
    // components and ignores the rest, so the timestamps ride along inside the
    // path rather than in a second array.
    getTimestamps: (line: { path: number[][] }) => line.path.map((vertex) => vertex[3]),
    // Pixels rather than metres: the whole visualisation is sized to the screen
    // — a fixed number of lines per screen, each a fixed number of pixels long —
    // and a width in metres would thicken as the user zooms in until the field
    // read as a solid sheet.
    widthUnits: 'pixels',
    capRounded: true,
    jointRounded: true,
    fadeTrail: true,
    ...props,
  } as never);
