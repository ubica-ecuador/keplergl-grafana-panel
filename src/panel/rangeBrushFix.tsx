import React, { useLayoutEffect, useRef } from 'react';
import { RangeBrushFactory } from '@kepler.gl/components';

/**
 * A repair for the time slider, which kepler.gl paints underneath its own
 * histogram.
 *
 * The brush — the shaded window and the two drag handles every range slider
 * carries, the map's time slider included — is not a sibling of the plot but a
 * child of it: `RangePlot` hands it to `HistogramPlot` as a `brushComponent`
 * prop, and the unmasked branch of that component renders it *before* the bars
 * (`histogram-plot.tsx`):
 *
 * ```jsx
 * <g transform={…}>{brushComponent}</g>
 * <g clipPath={…} style={{pointerEvents: 'none'}}>{…bars…}</g>
 * ```
 *
 * SVG has no z-index — siblings paint in document order — so every bar is drawn
 * over the handles. On the demo's dense histograms the handles fall in the gaps
 * between thin bars and the flaw goes unseen; on a daily rainfall series, where
 * a handful of bars fill the width, each handle sits half-buried in the bar it
 * marks and the selected window vanishes altogether. The bars carry
 * `pointer-events: none`, so dragging still works — the slider is invisible,
 * not inert, which is why this reads as a styling bug.
 *
 * The defect is upstream: the same order is in the pinned 3.3.0-alpha.9 — it
 * survived alpha.8 and alpha.9 untouched — and on kepler's master, and it
 * cannot be answered in CSS,
 * because `z-index` has no effect on SVG children. So the brush is lifted in
 * the DOM instead — after every commit the group the plot renders it into is
 * moved to the end of the enclosing `<svg>`, which is where kepler's own
 * *masked* histogram already puts it.
 *
 * Moving that group rather than the brush itself is the whole safety argument.
 * The group stays a child of the same `<svg>`, so React can still unmount it;
 * and its siblings sit at fixed positions in the plot's JSX, so React never
 * inserts relative to it. Delete this module when the pin moves to a kepler.gl
 * that renders the brush last; the `raster-time` and `wms-time` dashboards show
 * the buried handles again the moment it stops working.
 */

type Factory = typeof RangeBrushFactory;
type RangeBrush = ReturnType<Factory>;
type RangeBrushProps = React.ComponentProps<RangeBrush>;

/**
 * Moves the group a brush was rendered into to the end of its `<svg>`, so it
 * paints over the plot rather than under it.
 *
 * Exported for the test: the whole defect is one of document order, so the
 * order this leaves behind is what is worth asserting.
 */
export function raiseBrushGroup(anchor: SVGGElement | null): void {
  if (!anchor) {
    return;
  }

  // Climb to the group that is a direct child of the <svg>. That one carries
  // the transform positioning the brush over the bars, so moving it — rather
  // than anything nested inside it — takes the offset along.
  let group: Element = anchor;
  let parent = group.parentElement;
  while (parent && !(parent instanceof SVGSVGElement)) {
    group = parent;
    parent = group.parentElement;
  }

  if (!parent || parent.lastElementChild === group) {
    return;
  }
  parent.appendChild(group);
}

/**
 * Wraps a range brush so its group is raised above the plot on every commit.
 *
 * Takes the brush as an argument rather than building it: kepler skips the
 * brush entirely under jsdom (`range-plot.tsx` guards it with `isTest`, because
 * d3 fails on jsdom's SVG), so the test needs to hand in a brush it can render.
 */
export function withBrushOnTop(RangeBrush: React.ComponentType<RangeBrushProps>): React.FC<RangeBrushProps> {
  const BrushOnTop: React.FC<RangeBrushProps> = (props) => {
    const anchor = useRef<SVGGElement>(null);

    // No dependency list on purpose. The plot re-renders this group on every
    // resize and every value change, and re-appending an element already last
    // is a no-op, so checking each commit costs less than tracking what could
    // have reordered it.
    useLayoutEffect(() => {
      raiseBrushGroup(anchor.current);
    });

    // An inert group, with no transform of its own, purely so the effect has a
    // node to climb from: the brush's own element belongs to kepler's class
    // component and reaching into it would mean reading its internals.
    return (
      <g ref={anchor}>
        <RangeBrush {...props} />
      </g>
    );
  };

  return BrushOnTop;
}

function BrushOnTopFactory(): React.FC<RangeBrushProps> {
  return withBrushOnTop(RangeBrushFactory());
}

/** The recipe `injectComponents` expects to swap the stock range brush. */
export function replaceRangeBrush(): [Factory, Factory] {
  return [RangeBrushFactory, BrushOnTopFactory as unknown as Factory];
}
