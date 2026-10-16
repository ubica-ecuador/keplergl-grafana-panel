import { act, renderHook } from '@testing-library/react';
import { locationService } from '@grafana/runtime';

import { isPanelBeingEdited, usePanelEditing } from './usePanelEditing';

/**
 * The real `locationService`: under test it runs on a memory history, so a
 * `push` moves the URL and calls the listeners the way Grafana's own
 * navigation does.
 */
function navigate(url: string) {
  act(() => locationService.push(url));
}

beforeEach(() => {
  act(() => locationService.replace('/'));
});

describe('isPanelBeingEdited', () => {
  const edited = (url: string, panelId?: number) => {
    const { pathname, search } = new URL(url, 'http://grafana.local');
    return isPanelBeingEdited(pathname, new URLSearchParams(search), panelId);
  };

  it('is the panel the editor names', () => {
    expect(edited('/d/abc/trips?orgId=1&editPanel=3', 3)).toBe(true);
  });

  it('is no panel on the dashboard itself', () => {
    expect(edited('/d/abc/trips?orgId=1', 3)).toBe(false);
    expect(edited('/d/abc/trips?viewPanel=panel-3', 3)).toBe(false);
  });

  it('is not another panel while one is edited', () => {
    expect(edited('/d/abc/trips?editPanel=4', 3)).toBe(false);
  });

  it('reads the scene key form of the id', () => {
    expect(edited('/d/abc/trips?editPanel=panel-3', 3)).toBe(true);
    expect(edited('/d/abc/trips?editPanel=panel-30', 3)).toBe(false);
  });

  it('is the edited panel on a dashboard not saved yet', () => {
    expect(edited('/dashboard/new?editPanel=1', 1)).toBe(true);
  });

  it('takes a panel with no id for the edited one', () => {
    expect(edited('/d/abc/trips?editPanel=4')).toBe(true);
    expect(edited('/d/abc/trips')).toBe(false);
  });

  it('is never kiosk mode, a solo panel, a public dashboard or a snapshot', () => {
    expect(edited('/d/abc/trips?editPanel=3&kiosk', 3)).toBe(false);
    expect(edited('/d/abc/trips?editPanel=3&kiosk=1', 3)).toBe(false);
    expect(edited('/d-solo/abc/trips?panelId=3&editPanel=3', 3)).toBe(false);
    expect(edited('/dashboard-solo/db/trips?panelId=3&editPanel=3', 3)).toBe(false);
    expect(edited('/public-dashboards/0123abcd?editPanel=3', 3)).toBe(false);
    expect(edited('/dashboard/snapshot/xyz?editPanel=3', 3)).toBe(false);
  });

  it('ignores an empty editPanel', () => {
    expect(edited('/d/abc/trips?editPanel=', 3)).toBe(false);
  });
});

describe('usePanelEditing', () => {
  it('reads the URL it mounts on', () => {
    navigate('/d/abc/trips?editPanel=3');
    expect(renderHook(() => usePanelEditing(3)).result.current).toBe(true);
    expect(renderHook(() => usePanelEditing(4)).result.current).toBe(false);
  });

  it('follows the editor opening and closing', () => {
    navigate('/d/abc/trips?orgId=1');
    const { result } = renderHook(() => usePanelEditing(3));
    expect(result.current).toBe(false);

    navigate('/d/abc/trips?orgId=1&editPanel=3');
    expect(result.current).toBe(true);

    navigate('/d/abc/trips?orgId=1');
    expect(result.current).toBe(false);
  });

  it('follows the editor moving to another panel', () => {
    navigate('/d/abc/trips?editPanel=3');
    const { result } = renderHook(() => usePanelEditing(3));
    expect(result.current).toBe(true);

    navigate('/d/abc/trips?editPanel=4');
    expect(result.current).toBe(false);
  });

  it('follows a change of panel id', () => {
    navigate('/d/abc/trips?editPanel=4');
    const { result, rerender } = renderHook(({ id }) => usePanelEditing(id), { initialProps: { id: 3 } });
    expect(result.current).toBe(false);

    rerender({ id: 4 });
    expect(result.current).toBe(true);
  });

  it('stops listening once unmounted', () => {
    navigate('/d/abc/trips');
    const { result, unmount } = renderHook(() => usePanelEditing(3));
    unmount();

    navigate('/d/abc/trips?editPanel=3');
    expect(result.current).toBe(false);
  });
});
