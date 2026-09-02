import { ANIMATION_WINDOW, BASE_SPEED } from '@kepler.gl/constants';
import { AnimationControllerFactory } from '@kepler.gl/components';

/**
 * A repair for the incremental animation, which restarts before it has shown
 * the last of the data.
 *
 * kepler advances an animated time filter in `AnimationController`. For a
 * growing window — the *incremental* mode, where the start is anchored and only
 * the end moves — the step is:
 *
 * ```js
 * const lastFrame = value[1] + delta > domain[1];
 * value1 = lastFrame ? value[0] + 1 : value[1] + delta;
 * ```
 *
 * The remainder is discarded rather than clamped: as soon as one more step
 * would pass the end of the domain, the window jumps back to the anchor. On a
 * daily rainfall calendar of 2026-08-20…26 the window end climbs to
 * 2026-08-25T23:58:38 and restarts — a minute and a half short of the domain
 * end, so the last day is never selected and its histogram bin never lights up.
 *
 * Clamping to `domain[1]` is not enough, and this is the part worth being
 * careful about. A time filter's domain runs from the first timestamp to the
 * last one, so the final scene sits exactly *on* `domain[1]`: a window ending
 * there reaches it for a single animation frame — around 16 ms — which is not
 * long enough to fetch a WMS image, let alone see it. Every other scene gets a
 * whole bin's worth of frames.
 *
 * So the sweep runs to the end of the last *bin* instead of the last instant.
 * That is the span the plot already draws — `RangeSlider` pads its display
 * range by exactly one bin for time filters so the edge bars are not clipped —
 * so the brush now travels the width of the histogram it sits on, the last bar
 * highlights like every other, and the last scene is shown for as long as its
 * neighbours. The window end passing the newest timestamp is the same thing
 * kepler's *free* mode already does, where the window slides out of the domain
 * on its way past.
 *
 * Nothing else changes: free, point and interval windows are handed straight
 * back to kepler. The defect is upstream in 3.3.0-alpha.9; delete this module
 * when the pin moves to a kepler.gl whose incremental step ends on the data.
 */

/** What `AnimationController` is given to compute one incremental frame. */
export interface IncrementalFrame {
  /** The filter's domain: first and last timestamp of the data, in epoch ms. */
  domain: readonly number[];
  /** The window as it stands, `[anchor, end]`. */
  value: readonly number[];
  /**
   * The bin edges kepler hands the controller for interval playback — the
   * histogram's thresholds with the last one popped. Absent when the filter has
   * no binning interval, which is the case this cannot improve on.
   */
  steps?: readonly number[] | null;
  speed?: number;
  baseSpeed?: number;
}

/**
 * Where an incremental sweep should finish: the end of the last histogram bin,
 * or the end of the domain when the filter has no bins to go by.
 *
 * The last bin's own width rather than the first one's, because a calendar
 * binned by month has bins of different lengths and it is the last that is
 * being extended.
 */
export function sweepEnd(domain: readonly number[], steps?: readonly number[] | null): number {
  const domainEnd = domain[1];
  if (!steps || steps.length < 2) {
    return domainEnd;
  }

  const last = steps[steps.length - 1];
  const end = last + (last - steps[steps.length - 2]);
  return Number.isFinite(end) && end > domainEnd ? end : domainEnd;
}

/**
 * The next `[anchor, end]` of a growing window.
 *
 * Exported for the test: the whole defect is in which value the last frame of a
 * sweep carries, so that is what is worth asserting.
 */
export function nextIncrementalWindow({
  domain,
  value,
  steps,
  speed = 1,
  baseSpeed = BASE_SPEED,
}: IncrementalFrame): [number, number] {
  const anchor = value[0];
  const end = sweepEnd(domain, steps);

  // The sweep is over once the end has been reached — reached, not passed, so
  // the final frame is emitted before the window jumps back to the anchor.
  if (value[1] >= end) {
    return [anchor, anchor + 1];
  }

  const delta = ((domain[1] - domain[0]) / baseSpeed) * speed;
  if (!(delta > 0)) {
    // A domain with no width, or a stopped speed, would otherwise repeat one
    // frame for ever. Finish the sweep instead of stalling on it.
    return [anchor, end];
  }

  return [anchor, Math.min(value[1] + delta, end)];
}

// The usual mixin constructor type; `any[]` for the same reason as in
// `tripLayerFix` — constructor parameters are checked contravariantly.
type Constructor<T> = new (...args: any[]) => T;

/** The shape of the one controller method this overrides. */
interface FrameByDomain {
  props: IncrementalFrame & { animationWindow?: string };
  _nextFrameByDomain(): number | number[] | undefined;
}

function SweepingAnimationControllerFactory(): ReturnType<typeof AnimationControllerFactory> {
  const AnimationController = AnimationControllerFactory();
  const Base = AnimationController as unknown as Constructor<FrameByDomain>;

  class SweepingAnimationController extends Base {
    /**
     * A prototype method, so overriding it is the whole of the change — the
     * controller's timer, reset and playback state are kepler's own.
     */
    _nextFrameByDomain(): number | number[] | undefined {
      const { animationWindow, domain, value } = this.props;
      if (animationWindow !== ANIMATION_WINDOW.incremental || !domain || !Array.isArray(value)) {
        return super._nextFrameByDomain();
      }

      const { steps, speed, baseSpeed } = this.props;
      return nextIncrementalWindow({ domain, value, steps, speed, baseSpeed });
    }
  }

  return SweepingAnimationController as unknown as ReturnType<typeof AnimationControllerFactory>;
}

type Factory = typeof AnimationControllerFactory;

/** The recipe `injectComponents` expects to swap the stock animation controller. */
export function replaceAnimationController(): [Factory, Factory] {
  return [AnimationControllerFactory, SweepingAnimationControllerFactory as unknown as Factory];
}
