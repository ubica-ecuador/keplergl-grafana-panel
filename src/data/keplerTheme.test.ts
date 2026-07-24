import { createTheme } from '@grafana/data';

import { toKeplerTheme } from './keplerTheme';

describe('toKeplerTheme', () => {
  it('follows Grafana into dark mode', () => {
    expect(toKeplerTheme(createTheme({ colors: { mode: 'dark' } })).name).toBe('dark');
  });

  it('follows Grafana into light mode', () => {
    expect(toKeplerTheme(createTheme({ colors: { mode: 'light' } })).name).toBe('light');
  });

  it('takes its panel surfaces from the Grafana theme rather than kepler defaults', () => {
    const grafana = createTheme({ colors: { mode: 'dark' } });
    const theme = toKeplerTheme(grafana);

    // If these came back as kepler's own greys, the side panel would visibly
    // clash with the dashboard around it.
    expect(theme.sidePanelBg).toBe(grafana.colors.background.primary);
    expect(theme.panelBackground).toBe(grafana.colors.background.secondary);
    expect(theme.textColor).toBe(grafana.colors.text.primary);
  });

  it('uses Grafana primary colour as the accent', () => {
    const grafana = createTheme({ colors: { mode: 'light' } });

    expect(toKeplerTheme(grafana).activeColor).toBe(grafana.colors.primary.main);
  });

  it('picks a base map style matching the mode', () => {
    expect(toKeplerTheme(createTheme({ colors: { mode: 'dark' } })).mapStyle).toBe('dark-matter');
    expect(toKeplerTheme(createTheme({ colors: { mode: 'light' } })).mapStyle).toBe('positron');
  });
});
