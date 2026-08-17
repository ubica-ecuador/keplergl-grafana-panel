import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, provideRecipesToInjector, EffectManagerFactory, MapControlFactory } from '@kepler.gl/components';

import { replaceMapControl } from './effectsMapControl';

/**
 * Resolves the map control through kepler's own injector, exactly as
 * `injectComponents` does inside KeplerGl, so the composition under test is the
 * one the panel really renders.
 */
function resolveMapControl(extraRecipes: Array<[any, any]> = []) {
  const appInjector = provideRecipesToInjector([replaceMapControl(), ...extraRecipes], injector());
  return appInjector.get(MapControlFactory);
}

/**
 * The effect manager needs a live kepler store; its internals are kepler's to
 * test. What is ours is the wiring — that the factory mounts whatever the
 * injector hands it as EffectManager when the control is active — so the stub
 * is substituted through the injector, the supported extension point.
 */
function StubEffectManagerFactory() {
  const StubEffectManager = () => <div data-testid="effect-manager" />;
  return StubEffectManager;
}
StubEffectManagerFactory.deps = [];

const controlProps = (active: boolean) => ({
  mapControls: { effect: { show: true, active } },
  onToggleMapControl: jest.fn(),
  top: 0,
});

const renderControl = (MapControl: React.ComponentType<any>, props: Record<string, unknown>) =>
  render(
    <ThemeProvider theme={theme}>
      <IntlProvider locale="en" messages={messages['en']}>
        <MapControl {...props} />
      </IntlProvider>
    </ThemeProvider>
  );

describe('replaceMapControl', () => {
  it("adds kepler's effects button to the stock map controls", () => {
    const MapControl = resolveMapControl();
    const props = controlProps(false);

    const { container } = renderControl(MapControl, props);
    const button = container.querySelector('button.toggle-effect');

    expect(button).not.toBeNull();

    fireEvent.click(button!);
    expect(props.onToggleMapControl).toHaveBeenCalledWith('effect');
  });

  it('mounts the effect manager only while the effect control is active', () => {
    const MapControl = resolveMapControl([[EffectManagerFactory, StubEffectManagerFactory]]);

    const inactive = renderControl(MapControl, controlProps(false));
    expect(inactive.queryByTestId('effect-manager')).toBeNull();
    inactive.unmount();

    const active = renderControl(MapControl, controlProps(true));
    expect(active.getByTestId('effect-manager')).not.toBeNull();
  });
});
