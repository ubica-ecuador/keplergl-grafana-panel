import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimationControlFactory, RangeSliderFactory } from '@kepler.gl/components';

import { TemporalCursorContext } from './temporalCursorMapContainer';
import { timeAtX, xAtTime, type TimeBarGeometry } from './timeBarCursor';
import { useGrafanaHoverTime } from './useGrafanaHoverTime';
import { useMapHoverPublisher } from './useMapHoverPublisher';

/** Measures the bar's track relative to the wrapper; null while it cannot. */
type Measure = (wrapper: HTMLElement) => TimeBarGeometry | null;

/**
 * The dashboard's shared cursor on one of kepler's time bars.
 *
 * Hovering the bar publishes the time under the pointer, as hovering a Grafana
 * graph does, so the graphs' crosshair and the map's temporal cursor follow it.
 * A cursor coming from a graph is drawn back onto the bar as a line. Dragging a
 * handle publishes nothing: the pointer is moving the brush, not asking a
 * question.
 *
 * The bar itself is passed in already memoised on its props, so a pointer move
 * re-renders this wrapper and not kepler's histogram.
 */
function TimeBarCursor({ bar, measure }: { bar: React.ReactElement; measure: Measure }) {
  const options = useContext(TemporalCursorContext);
  const incoming = useGrafanaHoverTime(options.eventBus, true);
  const [pointer, setPointer] = useState<number | null>(null);
  useMapHoverPublisher(options.eventBus, Boolean(options.publishMapHover), pointer);
  const wrapper = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const time = pointer ?? incoming;
  // Placed on the element rather than through render: the track is only
  // measurable once kepler has laid it out.
  useEffect(() => {
    const geometry = wrapper.current ? measure(wrapper.current) : null;
    const x = time !== null && geometry ? xAtTime(time, geometry) : null;
    if (line.current) {
      line.current.style.display = x === null ? 'none' : 'block';
      line.current.style.left = x === null ? '' : `${x - 1}px`;
    }
  }, [time, measure]);

  return (
    <div
      ref={wrapper}
      style={{ position: 'relative', width: '100%' }}
      onMouseMove={(event) => {
        const geometry = measure(event.currentTarget);
        const left = event.currentTarget.getBoundingClientRect().left;
        setPointer(event.buttons === 0 && geometry ? timeAtX(event.clientX - left, geometry) : null);
      }}
      onMouseLeave={() => setPointer(null)}
    >
      {bar}
      <div
        ref={line}
        className="panel-time-bar-cursor"
        style={{
          display: 'none',
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: 2,
          background: '#ffb300',
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

/** The parts of kepler's `RangeSlider` instance its geometry is read from. */
interface RangeSliderInstance {
  state?: { width?: number };
  props?: { sliderHandleWidth?: number | string };
  _getDisplayRange?: () => number[] | null | undefined;
}

interface RangeSliderProps {
  /** Only the time slider gets an x axis (kepler's `TimeSliderMarker`). */
  xAxis?: unknown;
  timeFormat?: unknown;
}

/**
 * The enlarged time widget's slider. Its track is the container less half a
 * handle each side, over the display range — both read from the instance, so
 * the line lands where kepler draws the bins.
 */
export function withRangeSliderCursor<P extends RangeSliderProps>(Slider: React.ComponentType<P>): React.FC<P> {
  function TimeBarCursorRangeSlider(props: P) {
    const { enabled } = useContext(TemporalCursorContext);
    const slider = useRef<RangeSliderInstance | null>(null);
    const Ref = Slider as unknown as React.ComponentType<P & { ref: React.Ref<RangeSliderInstance> }>;
    const bar = useMemo(() => <Ref {...props} ref={slider} />, [Ref, props]);
    const measure = useMemo<Measure>(
      () => () => {
        const instance = slider.current;
        const range = instance?._getDisplayRange?.();
        const width = instance?.state?.width;
        if (!Array.isArray(range) || range.length < 2 || typeof width !== 'number') {
          return null;
        }
        const handle = Number(instance?.props?.sliderHandleWidth ?? 12);
        return { left: handle / 2, width: width - handle, range: [range[0], range[1]] };
      },
      []
    );
    const isTime = Boolean(props.xAxis) || typeof props.timeFormat === 'string';
    return enabled && isTime ? <TimeBarCursor bar={bar} measure={measure} /> : bar;
  }
  return TimeBarCursorRangeSlider;
}

interface TimelineSliderProps {
  timeline?: { domain?: number[] | null } | null;
}

/**
 * The minified time widget's slider. It sits between two date labels, so its
 * track is measured where kepler put it.
 */
export function withTimelineSliderCursor<P extends TimelineSliderProps>(Slider: React.ComponentType<P>): React.FC<P> {
  function TimeBarCursorTimelineSlider(props: P) {
    const { enabled } = useContext(TemporalCursorContext);
    const bar = useMemo(() => <Slider {...props} />, [props]);
    const domain = props.timeline?.domain;
    const measure = useMemo<Measure>(
      () => (wrapper) => {
        const trackEl = wrapper.querySelector('.animation-control__slider .kg-range-slider');
        if (!trackEl || !Array.isArray(domain) || domain.length < 2) {
          return null;
        }
        const track = trackEl.getBoundingClientRect();
        const left = track.left - wrapper.getBoundingClientRect().left;
        return { left, width: track.width, range: [domain[0], domain[1]] };
      },
      [domain]
    );
    return enabled ? <TimeBarCursor bar={bar} measure={measure} /> : bar;
  }
  return TimeBarCursorTimelineSlider;
}

type RangeFactory = typeof RangeSliderFactory;
type TimelineFactory = ((...deps: unknown[]) => React.ComponentType<TimelineSliderProps>) & { deps: unknown[] };

/**
 * kepler does not export the minified bar's factory; its animation control,
 * which renders it, lists it third among its dependencies
 * (`[PlaybackControls, FloatingTimeDisplay, TimelineSlider]`).
 */
export const TimelineSliderFactory = (AnimationControlFactory as unknown as { deps: TimelineFactory[] }).deps[2];

CustomRangeSliderFactory.deps = RangeSliderFactory.deps;
function CustomRangeSliderFactory(...deps: Parameters<RangeFactory>) {
  return withRangeSliderCursor(RangeSliderFactory(...deps) as unknown as React.ComponentType<RangeSliderProps>);
}

CustomTimelineSliderFactory.deps = TimelineSliderFactory.deps;
function CustomTimelineSliderFactory(...deps: Parameters<TimelineFactory>) {
  return withTimelineSliderCursor(TimelineSliderFactory(...deps));
}

/** The recipe that puts the shared cursor on the enlarged time widget. */
export function replaceRangeSlider(): [RangeFactory, RangeFactory] {
  return [RangeSliderFactory, CustomRangeSliderFactory as unknown as RangeFactory];
}

/** The recipe that puts the shared cursor on the minified time widget. */
export function replaceTimelineSlider(): [TimelineFactory, TimelineFactory] {
  return [TimelineSliderFactory, CustomTimelineSliderFactory as unknown as TimelineFactory];
}
