import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { DataHoverClearEvent, DataHoverEvent, EventBusSrv } from '@grafana/data';

import { TemporalCursorContext, type TemporalCursorOptions } from './temporalCursorMapContainer';
import { TimelineSliderFactory, withRangeSliderCursor, withTimelineSliderCursor } from './timeBarCursorSlider';

/**
 * Stand-ins for kepler's two time bars. The enlarged one is a class the wrapper
 * reads its width and display range from; the minified one is measured in the
 * DOM, so its track reports a box.
 */
let renders = 0;
class FakeRangeSlider extends React.Component<{ xAxis?: unknown }> {
  state = { width: 212 };
  _getDisplayRange = () => [1000, 2000];
  render() {
    renders++;
    return <div data-testid="bar" />;
  }
}
function FakeTimeline(_: { timeline?: { domain?: number[] } }) {
  renders++;
  return (
    <div data-testid="bar" className="animation-control__slider">
      <div className="kg-range-slider" data-testid="track" />
    </div>
  );
}
const RangeSlider = withRangeSliderCursor(FakeRangeSlider as unknown as React.ComponentType<{ xAxis?: unknown }>);
const Timeline = withTimelineSliderCursor(FakeTimeline);

function setup(element: React.ReactElement, options: TemporalCursorOptions = {}) {
  const bus = new EventBusSrv();
  const events: Array<DataHoverEvent | DataHoverClearEvent> = [];
  bus.getStream(DataHoverEvent).subscribe((e) => events.push(e));
  bus.getStream(DataHoverClearEvent).subscribe((e) => events.push(e));
  const view = render(
    <TemporalCursorContext.Provider value={{ eventBus: bus, enabled: true, ...options }}>
      {element}
    </TemporalCursorContext.Provider>
  );
  const wrapper = view.getByTestId('bar').parentElement!;
  wrapper.getBoundingClientRect = () => ({ left: 100 }) as DOMRect;
  const line = () => view.container.querySelector<HTMLElement>('.panel-time-bar-cursor');
  // Effects flush when act ends, so a frame scheduled by one is advanced in the next.
  const step = (fn: () => void) => {
    act(fn);
    act(() => {
      jest.advanceTimersByTime(20);
    });
  };
  return { bus, events, view, wrapper, line, step };
}

beforeEach(() => {
  jest.useFakeTimers();
  renders = 0;
});
afterEach(() => jest.useRealTimers());

describe('the enlarged time bar', () => {
  it('publishes the time under the pointer and clears on leave, without re-rendering kepler', () => {
    const { events, wrapper, line, step } = setup(<RangeSlider xAxis={() => null} />, { publishMapHover: true });
    const before = renders;
    // Half a 12 px handle pads each side of the 212 px container: 206 − 100 is mid-track.
    step(() => fireEvent.mouseMove(wrapper, { clientX: 206, buttons: 0 }));
    const hover = events.find((e): e is DataHoverEvent => e instanceof DataHoverEvent);
    expect(hover?.payload.point.time).toBe(1500);
    expect(line()?.style.left).toBe('105px');
    expect(renders).toBe(before);
    step(() => fireEvent.mouseLeave(wrapper));
    expect(events.at(-1)).toBeInstanceOf(DataHoverClearEvent);
    expect(line()?.style.display).toBe('none');
  });

  it('publishes nothing while a handle is dragged', () => {
    const { events, wrapper, step } = setup(<RangeSlider xAxis={() => null} />, { publishMapHover: true });
    step(() => fireEvent.mouseMove(wrapper, { clientX: 206, buttons: 1 }));
    expect(events).toHaveLength(0);
  });

  it('draws a graph’s cursor but publishes nothing unless map hover is on', () => {
    const { bus, events, wrapper, line, step } = setup(<RangeSlider xAxis={() => null} />);
    step(() => bus.publish(new DataHoverEvent({ point: { time: 1250 } })));
    expect(line()?.style.left).toBe('55px');
    step(() => fireEvent.mouseMove(wrapper, { clientX: 206, buttons: 0 }));
    expect(events).toHaveLength(1);
  });

  it('leaves value sliders and a disabled cursor alone', () => {
    const value = setup(<RangeSlider />, { publishMapHover: true });
    expect(value.line()).toBeNull();
    value.view.unmount();
    const off = setup(<RangeSlider xAxis={() => null} />, { enabled: false });
    expect(off.line()).toBeNull();
  });
});

describe('the minified time bar', () => {
  it('maps the pointer across the measured track', () => {
    const { events, view, wrapper, line, step } = setup(<Timeline timeline={{ domain: [1000, 2000] }} />, {
      publishMapHover: true,
    });
    view.getByTestId('track').getBoundingClientRect = () => ({ left: 150, width: 100 }) as DOMRect;
    step(() => fireEvent.mouseMove(wrapper, { clientX: 175, buttons: 0 }));
    const hover = events.find((e): e is DataHoverEvent => e instanceof DataHoverEvent);
    expect(hover?.payload.point.time).toBe(1250);
    expect(line()?.style.left).toBe('74px');
    step(() => fireEvent.mouseMove(wrapper, { clientX: 120, buttons: 0 }));
    expect(events.at(-1)).toBeInstanceOf(DataHoverClearEvent);
  });
});

it('takes the minified bar’s factory from where kepler lists it', () => {
  // Positional: a reordering upstream would otherwise replace another component in silence.
  expect(TimelineSliderFactory.name).toBe('TimelineSliderFactory');
});
