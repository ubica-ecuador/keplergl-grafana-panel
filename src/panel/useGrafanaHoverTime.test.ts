import { act, renderHook } from '@testing-library/react';
import { DataHoverEvent, DataHoverClearEvent, EventBusSrv } from '@grafana/data';
import { useGrafanaHoverTime } from './useGrafanaHoverTime';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('coalesces a burst, accepts epoch zero, clears and cancels pending frames', () => {
  const bus = new EventBusSrv();
  const { result, unmount } = renderHook(() => useGrafanaHoverTime(bus, true));
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: 100 } }));
    bus.publish(new DataHoverEvent({ point: { time: 0 } }));
  });
  expect(result.current).toBeNull();
  act(() => jest.advanceTimersByTime(20));
  expect(result.current).toBe(0);
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: 200 } }));
    bus.publish(new DataHoverClearEvent());
    jest.advanceTimersByTime(20);
  });
  expect(result.current).toBeNull();
  act(() => bus.publish(new DataHoverEvent({ point: { time: 300 } })));
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

it('drops the cursor when disabled and does not retain subscriptions', () => {
  const bus = new EventBusSrv();
  const { result, rerender } = renderHook(({ enabled }) => useGrafanaHoverTime(bus, enabled), {
    initialProps: { enabled: true },
  });
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: 100 } }));
    jest.advanceTimersByTime(20);
  });
  expect(result.current).toBe(100);
  rerender({ enabled: false });
  act(() => {
    bus.publish(new DataHoverEvent({ point: { time: 200 } }));
    jest.advanceTimersByTime(20);
  });
  expect(result.current).toBeNull();
  rerender({ enabled: true });
  expect(result.current).toBeNull();
});
