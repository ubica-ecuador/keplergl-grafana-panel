import { GATE_GRACE_MS, GATE_HOLD_MS, PublishGate } from './publishGate';
import { MIN_PUBLISH_INTERVAL_MS } from './timeVariableSync';

describe('PublishGate', () => {
  const T = 10_000;

  it('has its grace over by the shortest interval, so with no datasource the pace is the interval', () => {
    expect(GATE_GRACE_MS).toBeLessThanOrEqual(MIN_PUBLISH_INTERVAL_MS);
  });

  it('is open before anything was published', () => {
    expect(new PublishGate().waitMs(T)).toBe(0);
  });

  it('waits out the grace for a busy, then opens when none came', () => {
    const gate = new PublishGate();
    gate.published(T);
    expect(gate.waitMs(T + 100)).toBe(GATE_GRACE_MS - 100);
    expect(gate.waitMs(T + GATE_GRACE_MS)).toBe(0);
  });

  it('holds from busy until the settled that follows', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'busy', at: T + 20 });
    expect(gate.waitMs(T + 400)).toBe(GATE_HOLD_MS - 400);
    gate.signal({ state: 'settled', at: T + 450 });
    expect(gate.waitMs(T + 450)).toBe(0);
  });

  it('holds again when the datasource gets busy after settling', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'busy', at: T + 20 });
    gate.signal({ state: 'settled', at: T + 100 });
    gate.signal({ state: 'busy', at: T + 120 });
    expect(gate.waitMs(T + 130)).toBeGreaterThan(0);
  });

  it('catches a busy that arrives after the grace, before the next publish', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'busy', at: T + GATE_GRACE_MS + 50 });
    expect(gate.waitMs(T + GATE_GRACE_MS + 60)).toBeGreaterThan(0);
  });

  it('ignores a settled with no busy before it', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'settled', at: T + 10 });
    expect(gate.waitMs(T + 10)).toBe(GATE_GRACE_MS - 10);
  });

  it('ignores events from before the last publish', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'busy', at: T - 5 });
    expect(gate.waitMs(T + GATE_GRACE_MS)).toBe(0);
  });

  it('never holds longer than the cap, whatever the signals', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'busy', at: T + 1 });
    expect(gate.waitMs(T + GATE_HOLD_MS)).toBe(0);
  });

  it('opens for good on reset', () => {
    const gate = new PublishGate();
    gate.published(T);
    gate.signal({ state: 'busy', at: T + 1 });
    gate.reset();
    expect(gate.waitMs(T + 2)).toBe(0);
  });
});
