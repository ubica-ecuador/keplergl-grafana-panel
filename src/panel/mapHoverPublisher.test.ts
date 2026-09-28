import { DataHoverClearEvent, DataHoverEvent, EventBusSrv } from '@grafana/data';
import { MapHoverPublisher } from './mapHoverPublisher';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('publishes the latest pointer time once, with a source tag, and clears on leave', () => {
  const bus = new EventBusSrv();
  const times: number[] = [];
  const tags: string[][] = [];
  let clears = 0;
  bus.getStream(DataHoverEvent).subscribe((e) => {
    times.push(e.payload.point.time!);
    tags.push([...e.tags!]);
  });
  bus.getStream(DataHoverClearEvent).subscribe(() => clears++);
  const publisher = new MapHoverPublisher(bus, 'map-a');
  publisher.move(100);
  publisher.move(200);
  jest.advanceTimersByTime(20);
  publisher.move(200);
  jest.advanceTimersByTime(20);
  expect(times).toEqual([200]);
  expect(tags).toEqual([['map-a']]);
  publisher.move(null);
  publisher.dispose();
  expect(clears).toBe(1);
});

it('does not echo received events or clear a cursor now owned by a graph', () => {
  const bus = new EventBusSrv();
  const publish = jest.spyOn(bus, 'publish');
  const publisher = new MapHoverPublisher(bus, 'map-a');
  publisher.move(100);
  jest.advanceTimersByTime(20);
  bus.publish(new DataHoverEvent({ point: { time: 200 } }).setTags(['uplot']));
  publisher.move(null);
  publisher.dispose();
  jest.advanceTimersByTime(20);
  expect(publish).toHaveBeenCalledTimes(2);
});

it('cancels pending output when another panel takes over or the publisher unmounts', () => {
  const bus = new EventBusSrv();
  const publish = jest.spyOn(bus, 'publish');
  const publisher = new MapHoverPublisher(bus, 'map-a');
  publisher.move(100);
  bus.publish(new DataHoverEvent({ point: { time: 200 } }));
  jest.advanceTimersByTime(20);
  expect(publish).toHaveBeenCalledTimes(1);
  publisher.move(300);
  publisher.dispose();
  jest.advanceTimersByTime(20);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('two map publishers do not bounce events or clear each other', () => {
  const bus = new EventBusSrv();
  const publish = jest.spyOn(bus, 'publish');
  const a = new MapHoverPublisher(bus, 'a');
  const b = new MapHoverPublisher(bus, 'b');
  a.move(100);
  jest.advanceTimersByTime(20);
  b.move(200);
  jest.advanceTimersByTime(20);
  a.move(null);
  expect(publish).toHaveBeenCalledTimes(2);
  b.move(null);
  expect(publish).toHaveBeenCalledTimes(3);
  a.dispose();
  b.dispose();
});

it('takes a graph’s synchronous echo for an echo, and still clears on leave', () => {
  const bus = new EventBusSrv();
  let clears = 0;
  // What a Time series does with a hover it receives: snap to a sample and republish, inside the publish.
  bus.getStream(DataHoverEvent).subscribe((e) => {
    if (!e.tags?.has('uplot')) {
      bus.publish(
        new DataHoverEvent({ point: { time: Math.floor(e.payload.point.time! / 1000) * 1000 } }).setTags(['uplot'])
      );
    }
  });
  bus.getStream(DataHoverClearEvent).subscribe(() => clears++);
  const publisher = new MapHoverPublisher(bus, 'map-a');
  publisher.move(1500);
  jest.advanceTimersByTime(20);
  publisher.move(null);
  expect(clears).toBe(1);
  publisher.dispose();
});
