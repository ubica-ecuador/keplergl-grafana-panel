import React from 'react';
import { render } from '@testing-library/react';
import { injector, provideRecipesToInjector, RangeBrushFactory } from '@kepler.gl/components';

import { raiseBrushGroup, replaceRangeBrush, withBrushOnTop } from './rangeBrushFix';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The shape kepler's unmasked histogram builds: a group holding the brush,
 * then the bars, then the y axis — the order that buries the handles.
 */
function plotWithBrushFirst() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const brushGroup = document.createElementNS(SVG_NS, 'g');
  brushGroup.setAttribute('transform', 'translate(12, 0)');
  const anchor = document.createElementNS(SVG_NS, 'g');
  const brush = document.createElementNS(SVG_NS, 'g');
  brush.setAttribute('class', 'kg-range-slider__brush');

  anchor.appendChild(brush);
  brushGroup.appendChild(anchor);
  svg.append(brushGroup, document.createElementNS(SVG_NS, 'g'), document.createElementNS(SVG_NS, 'g'));
  document.body.appendChild(svg);

  return { svg, brushGroup, anchor };
}

const childIndexOf = (svg: SVGSVGElement, node: Element) => Array.from(svg.children).indexOf(node);

describe('raiseBrushGroup', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it("moves the brush's group to the end of the svg, so the bars stop painting over it", () => {
    const { svg, brushGroup, anchor } = plotWithBrushFirst();
    expect(childIndexOf(svg, brushGroup)).toBe(0);

    raiseBrushGroup(anchor);

    expect(childIndexOf(svg, brushGroup)).toBe(svg.children.length - 1);
  });

  it('carries the transform that positions the brush, by moving the group rather than the brush', () => {
    const { svg, brushGroup, anchor } = plotWithBrushFirst();

    raiseBrushGroup(anchor);

    expect(svg.lastElementChild).toBe(brushGroup);
    expect(brushGroup.getAttribute('transform')).toBe('translate(12, 0)');
    expect(brushGroup.contains(anchor)).toBe(true);
  });

  it('leaves a brush kepler already renders last alone, as its masked histogram does', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const bars = document.createElementNS(SVG_NS, 'g');
    const brushGroup = document.createElementNS(SVG_NS, 'g');
    const anchor = document.createElementNS(SVG_NS, 'g');
    brushGroup.appendChild(anchor);
    svg.append(bars, brushGroup);
    document.body.appendChild(svg);

    raiseBrushGroup(anchor);

    expect(Array.from(svg.children)).toEqual([bars, brushGroup]);
  });

  it('does nothing when the brush has no svg around it', () => {
    const orphan = document.createElementNS(SVG_NS, 'g');
    const parent = document.createElementNS(SVG_NS, 'g');
    parent.appendChild(orphan);

    expect(() => raiseBrushGroup(orphan)).not.toThrow();
    expect(parent.firstElementChild).toBe(orphan);
  });

  it('does nothing before the group is mounted', () => {
    expect(() => raiseBrushGroup(null)).not.toThrow();
  });
});

describe('withBrushOnTop', () => {
  it('raises the brush as soon as it mounts, and again after the plot re-renders it', () => {
    const StubBrush: React.FC<any> = () => <g className="kg-range-slider__brush" />;
    const BrushOnTop = withBrushOnTop(StubBrush);

    // The bars follow the brush in the markup, exactly as the histogram writes
    // them, so a mount that changes nothing would leave the brush buried.
    const Plot: React.FC<{ value: number[] }> = ({ value }) => (
      <svg>
        <g transform="translate(0, 0)">
          <BrushOnTop {...({ value } as any)} />
        </g>
        <g className="histogram-bars" />
      </svg>
    );

    const { container, rerender } = render(<Plot value={[0, 1]} />);
    const svg = container.querySelector('svg')!;
    const brushIsLast = () => svg.lastElementChild!.querySelector('.kg-range-slider__brush') !== null;

    expect(brushIsLast()).toBe(true);

    rerender(<Plot value={[0, 2]} />);
    expect(brushIsLast()).toBe(true);
  });
});

describe('replaceRangeBrush', () => {
  it('resolves through kepler’s injector in place of the stock brush', () => {
    // Same cast as the map-control test: kepler types a recipe as a pair of
    // factories over `{}` props, which no real factory satisfies.
    const appInjector = provideRecipesToInjector([replaceRangeBrush() as [any, any]], injector());

    expect(appInjector.get(RangeBrushFactory)).not.toBe(RangeBrushFactory());
  });
});
