import { GpuFilterValueAccessor, withTripGpuFilterFix } from './tripLayerFix';

/** Calls an accessor the way kepler's gpu filter does, whatever its declared arity. */
const asGpuFilterWould = (accessor: unknown, feature: unknown, fieldIndex: number) =>
  (accessor as GpuFilterValueAccessor)({ valueAt: () => 'from the data container' }, feature, fieldIndex) as (field: {
    fieldIdx: number;
  }) => unknown;

/**
 * A stand-in for kepler's Trip layer, carrying only what the fix touches.
 *
 * The accessor is a class field taking a single argument, exactly as
 * `trip-layer.ts` defines it — which is the whole defect, so the fake has to
 * reproduce it rather than assume it away.
 */
class FakeTripLayer {
  _getColumnModeValueAccessor: (feature: any) => (field: any) => unknown;
  type = 'trip';

  constructor(public props: { dataId: string }) {
    this._getColumnModeValueAccessor = (feature) => (field: { fieldIdx: number }) =>
      feature.properties.values[field.fieldIdx];
  }

  describe(): string {
    return `trip on ${this.props.dataId}`;
  }
}

const feature = { properties: { index: 7, values: ['id-1', 1700000000000] } };

describe('withTripGpuFilterFix', () => {
  it('calls the accessor with the feature kepler passes second, not the data container', () => {
    const Fixed = withTripGpuFilterFix(FakeTripLayer);
    const layer = new Fixed({ dataId: 'grafana-A' });

    const accessor = asGpuFilterWould(layer._getColumnModeValueAccessor, feature, 1);

    expect(accessor({ fieldIdx: 1 })).toBe(1700000000000);
  });

  it('leaves the unfixed class reading the data container, which is the bug', () => {
    const layer = new FakeTripLayer({ dataId: 'grafana-A' });

    // Called the way the gpu filter does, the data container lands in `feature`
    // and `properties` is undefined.
    const accessor = asGpuFilterWould(layer._getColumnModeValueAccessor, feature, 1);

    expect(() => accessor({ fieldIdx: 1 })).toThrow(TypeError);
  });

  it('keeps the rest of the layer intact', () => {
    const Fixed = withTripGpuFilterFix(FakeTripLayer);
    const layer = new Fixed({ dataId: 'grafana-A' });

    expect(layer).toBeInstanceOf(FakeTripLayer);
    expect(layer.type).toBe('trip');
    expect(layer.describe()).toBe('trip on grafana-A');
  });

  it('leaves a class that no longer has the accessor alone rather than throwing', () => {
    class Renamed {
      type = 'trip';
    }

    const Fixed = withTripGpuFilterFix(Renamed);

    // An upstream rename must not take the map down; it surfaces as the deck.gl
    // error coming back, which the provisioned dashboards show immediately.
    expect(() => new Fixed()).not.toThrow();
    expect(new Fixed()).toBeInstanceOf(Renamed);
  });
});
