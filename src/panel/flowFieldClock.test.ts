import { holdOffFor, isRunning, phaseAt, tripsUniforms } from './flowFieldClock';

describe('phaseAt', () => {
  it('walks the cycle and starts it again', () => {
    expect(phaseAt(0, 1000)).toBe(0);
    expect(phaseAt(400, 1000)).toBe(400);
    expect(phaseAt(2500, 1000)).toBe(500);
  });

  it('stands still rather than answering nothing when there is no cycle', () => {
    // A knob can be dragged to its floor, and a modulo by zero is NaN, which
    // reaches the shader as a trail nobody can see and no error anywhere.
    expect(phaseAt(500, 0)).toBe(0);
  });
});

describe('tripsUniforms', () => {
  it('runs a trail at the phase the clock is at', () => {
    expect(tripsUniforms({ nowMs: 2500, cycleMs: 1000, trailMs: 40, running: true })).toEqual({
      currentTime: 500,
      trailLength: 40,
      fadeTrail: true,
    });
  });

  it('draws every line whole when it is not running', () => {
    // A stopped field used to be a blank map: the playhead sat where every
    // trail has zero length. Stopped now means the streamlines themselves,
    // drawn end to end — which is a map a person can read and print.
    //
    // A vertex is drawn while it sits between the playhead and the trail
    // behind it. Traced from a birth anywhere in the cycle, plus the copy the
    // seamless loop carries a cycle earlier, the times span -cycle to twice it.
    const { currentTime, trailLength, fadeTrail } = tripsUniforms({
      nowMs: 123,
      cycleMs: 1000,
      trailMs: 40,
      running: false,
    });

    for (const vertexTime of [-1000, 0, 500, 1000, 2000]) {
      expect(vertexTime).toBeLessThanOrEqual(currentTime);
      expect(vertexTime).toBeGreaterThanOrEqual(currentTime - trailLength);
    }
    expect(fadeTrail).toBe(false);
  });
});

describe('isRunning', () => {
  const RUNNING = { animate: true, onScreen: true, pageHidden: false, reducedMotion: false };

  it('runs when the layer animates and the map is being looked at', () => {
    expect(isRunning(RUNNING)).toBe(true);
  });

  it.each([
    ['the layer was switched to a still field', { animate: false }],
    ['the panel is scrolled out of sight', { onScreen: false }],
    ['the tab is in the background', { pageHidden: true }],
    ['the system asks for less motion', { reducedMotion: true }],
  ])('stops when %s', (_reason, veto) => {
    expect(isRunning({ ...RUNNING, ...veto })).toBe(false);
  });
});

describe('holdOffFor', () => {
  it('asks for the next frame straight away when the last one was cheap', () => {
    // On a machine with a working GPU a frame costs a couple of milliseconds
    // and the browser paces the animation anyway. Holding off there would buy
    // nothing and cost smoothness.
    expect(holdOffFor(3)).toBe(0);
  });

  it('waits as long as the drawing took when the drawing is expensive', () => {
    // Half the time drawing, half the time free. Measured on a map rendered in
    // software: without this the field asks for the next frame the instant the
    // last one lands, and the page never gets its main thread back — clicks on
    // the layer panel stop arriving and the tab reads as hung.
    expect(holdOffFor(200)).toBe(200);
  });

  it('never holds off for more than half a second', () => {
    // A field slow enough to need that is already in trouble; stopping it dead
    // for seconds at a time would only look like a broken map.
    expect(holdOffFor(3_000)).toBe(500);
  });
});
