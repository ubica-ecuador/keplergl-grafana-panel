import React, { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { locationService } from '@grafana/runtime';
import type { Store } from 'redux';

import type { SavedMapConfig } from '../data/mapConfig';
import { captureMapConfig } from './keplerAdapter';
import { SAVED_FEEDBACK_MS, SaveMapConfigButton, saveButtonPlacement } from './SaveMapConfigButton';
import { useSaveMapConfig } from './useSaveMapConfig';

jest.mock('./keplerAdapter', () => ({ captureMapConfig: jest.fn() }));

const capture = captureMapConfig as jest.MockedFunction<typeof captureMapConfig>;
const CAPTURED: SavedMapConfig = { version: 'v1', config: { visState: { layers: [{ id: 'trips' }] } } };

/** The real `locationService`, on the memory history it runs on under test. */
function navigate(url: string) {
  act(() => locationService.push(url));
}

const button = () => screen.queryByTestId('save-map-config-on-map');

function renderButton(props: Partial<React.ComponentProps<typeof SaveMapConfigButton>> = {}) {
  const onSave = jest.fn(() => true);
  const view = render(<SaveMapConfigButton panelId={3} width={1000} sidePanelOpen onSave={onSave} {...props} />);
  return { ...view, onSave };
}

beforeEach(() => {
  act(() => locationService.replace('/'));
  capture.mockReset();
  capture.mockReturnValue(CAPTURED);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SaveMapConfigButton', () => {
  it('is not drawn on the dashboard', () => {
    navigate('/d/abc/trips?orgId=1');
    renderButton();

    expect(button()).toBeNull();
  });

  it('is drawn while its panel is in the panel editor', () => {
    navigate('/d/abc/trips?orgId=1&editPanel=3');
    renderButton();

    const save = screen.getByRole('button', { name: 'Save map configuration' });
    expect(save).toBe(button());
    expect(save).toHaveTextContent('Save map');
  });

  it('is not drawn while another panel is edited', () => {
    navigate('/d/abc/trips?editPanel=4');
    renderButton();

    expect(button()).toBeNull();
  });

  it('is not drawn in kiosk mode or in a solo panel', () => {
    navigate('/d/abc/trips?editPanel=3&kiosk');
    renderButton();
    expect(button()).toBeNull();

    navigate('/d-solo/abc/trips?panelId=3&editPanel=3');
    expect(button()).toBeNull();
  });

  it('comes and goes with the editor', () => {
    navigate('/d/abc/trips');
    renderButton();
    expect(button()).toBeNull();

    navigate('/d/abc/trips?editPanel=3');
    expect(button()).not.toBeNull();

    navigate('/d/abc/trips');
    expect(button()).toBeNull();
  });

  it('saves once per click', () => {
    navigate('/d/abc/trips?editPanel=3');
    const { onSave } = renderButton();

    fireEvent.click(button()!);

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('says it saved, for a moment', () => {
    jest.useFakeTimers();
    navigate('/d/abc/trips?editPanel=3');
    renderButton();

    fireEvent.click(button()!);
    expect(button()).toHaveTextContent('Saved');
    expect(button()).toHaveAccessibleName('Map configuration saved');

    act(() => jest.advanceTimersByTime(SAVED_FEEDBACK_MS - 1));
    expect(button()).toHaveTextContent('Saved');

    act(() => jest.advanceTimersByTime(1));
    expect(button()).toHaveTextContent('Save map');
    expect(button()).toHaveAccessibleName('Save map configuration');
  });

  it('starts the moment over on a second click', () => {
    jest.useFakeTimers();
    navigate('/d/abc/trips?editPanel=3');
    renderButton();

    fireEvent.click(button()!);
    act(() => jest.advanceTimersByTime(SAVED_FEEDBACK_MS - 500));
    fireEvent.click(button()!);
    act(() => jest.advanceTimersByTime(SAVED_FEEDBACK_MS - 1));

    expect(button()).toHaveTextContent('Saved');
  });

  it('does not claim a save that captured nothing', () => {
    navigate('/d/abc/trips?editPanel=3');
    renderButton({ onSave: jest.fn(() => false) });

    fireEvent.click(button()!);

    expect(button()).toHaveTextContent('Save map');
  });

  it('keeps to its icon on a narrow map, with its name', () => {
    navigate('/d/abc/trips?editPanel=3');
    renderButton({ width: 480 });

    expect(button()?.textContent).toBe('');
    expect(button()).toHaveAccessibleName('Save map configuration');
  });
});

describe('saveButtonPlacement', () => {
  it('sits just right of the side panel toggle, open or closed', () => {
    expect(saveButtonPlacement({ width: 1000, sidePanelOpen: true })).toEqual({ left: 340, compact: false });
    expect(saveButtonPlacement({ width: 1000, sidePanelOpen: false })).toEqual({ left: 48, compact: false });
  });

  it('drops its words before they reach the control column', () => {
    expect(saveButtonPlacement({ width: 500, sidePanelOpen: true }).compact).toBe(false);
    expect(saveButtonPlacement({ width: 499, sidePanelOpen: true }).compact).toBe(true);
    expect(saveButtonPlacement({ width: 499, sidePanelOpen: false }).compact).toBe(false);
  });
});

/**
 * The map's button and the options editor's are one save: the panel wires the
 * button to what `useSaveMapConfig` returns, the same function the hook runs
 * when `saveRequest` moves.
 */
describe('the map’s button and the options editor', () => {
  function Map({ saveRequest, onMapConfigCaptured }: { saveRequest: number; onMapConfigCaptured: jest.Mock }) {
    const appliedConfig = useRef<SavedMapConfig | null | undefined>(undefined);
    const save = useSaveMapConfig({
      store: {} as Store,
      saveRequest,
      onMapConfigCaptured,
      appliedConfigRef: appliedConfig,
    });
    return <SaveMapConfigButton panelId={3} width={1000} sidePanelOpen onSave={save} />;
  }

  it('capture the same way, once each', () => {
    navigate('/d/abc/trips?editPanel=3');
    const onMapConfigCaptured = jest.fn();
    const { rerender } = render(<Map saveRequest={0} onMapConfigCaptured={onMapConfigCaptured} />);

    fireEvent.click(button()!);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(onMapConfigCaptured).toHaveBeenCalledTimes(1);
    expect(onMapConfigCaptured).toHaveBeenLastCalledWith(CAPTURED);

    rerender(<Map saveRequest={1} onMapConfigCaptured={onMapConfigCaptured} />);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(onMapConfigCaptured).toHaveBeenCalledTimes(2);
    expect(onMapConfigCaptured).toHaveBeenLastCalledWith(CAPTURED);
  });
});
