import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { MapNotices, NoticeStack, noticePlacement } from './MapNotices';
import type { MapNotice } from './mapNotices';

const failed: MapNotice = { severity: 'error', text: 'Query A: The service refused the time range' };
const vector: MapNotice = {
  severity: 'warning',
  text: 'services (query B) gives vector tiles (mvt), which this map does not draw yet.',
};

describe('MapNotices', () => {
  it('says nothing when nothing is wrong', () => {
    const { container } = render(<MapNotices notices={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('says one notice as its title, and several as a list under a count', () => {
    const { rerender } = render(<MapNotices notices={[failed]} />);
    expect(screen.getByText(failed.text)).toBeInTheDocument();

    rerender(<MapNotices notices={[failed, vector]} />);
    expect(screen.getByText('2 notes on this map')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('cuts a message too long to read over a map, whole in its tooltip', () => {
    const long = { severity: 'error' as const, text: `Query A: ${'x'.repeat(400)}` };
    render(<MapNotices notices={[long, vector]} />);

    const item = screen.getAllByRole('listitem')[0];
    expect(item).toHaveAttribute('title', long.text);
    expect(item.textContent!.length).toBeLessThan(310);
  });

  it('stays dismissed across refreshes, shows a new notice alone, and one that comes back', () => {
    const { container, rerender } = render(<MapNotices notices={[failed]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(container).toBeEmptyDOMElement();

    // A refresh says the same: still dismissed.
    rerender(<MapNotices notices={[failed]} />);
    expect(container).toBeEmptyDOMElement();

    // Something new: only that.
    rerender(<MapNotices notices={[failed, vector]} />);
    expect(screen.getByText(vector.text)).toBeInTheDocument();
    expect(screen.queryByText(failed.text)).toBeNull();

    // The query recovers, then fails again: said again.
    rerender(<MapNotices notices={[vector]} />);
    rerender(<MapNotices notices={[failed, vector]} />);
    expect(screen.getByText('2 notes on this map')).toBeInTheDocument();
  });
});

describe('noticePlacement', () => {
  it('keeps to the strip between kepler’s side panel and its controls', () => {
    expect(noticePlacement({ width: 1200, sidePanelOpen: true })).toEqual({ left: 340, right: 56 });
    expect(noticePlacement({ width: 1200, sidePanelOpen: false })).toEqual({ left: 48, right: 56 });
  });

  it('takes the whole width on a map too narrow for that strip', () => {
    expect(noticePlacement({ width: 600, sidePanelOpen: true })).toEqual({ left: 8, right: 8 });
  });
});

describe('NoticeStack', () => {
  it('lets the map have its pointer events, the notices theirs', () => {
    const { container } = render(
      <NoticeStack width={1200} sidePanelOpen={false}>
        <MapNotices notices={[failed]} />
      </NoticeStack>
    );

    expect((container.firstChild as HTMLElement).style.pointerEvents).toBe('none');
    expect(screen.getByText(failed.text)).toBeInTheDocument();
  });
});
