const mockConfig: { theme2?: unknown } = {};
jest.mock('@grafana/runtime', () => ({
  get config() {
    return mockConfig;
  },
}));

import { createTheme } from '@grafana/data';

import { grafanaTheme, space, typeSize } from './grafanaSpacing';

describe("Grafana's spacing and type for kepler-styled parts", () => {
  it("reads the running Grafana's theme", () => {
    const theme = createTheme({ spacing: { gridSize: 4 } });
    mockConfig.theme2 = theme;
    expect(grafanaTheme()).toBe(theme);
    expect(space(2)()).toBe('8px');
  });

  it('measures with a theme of its own when the running one is partial or missing', () => {
    mockConfig.theme2 = { isDark: true };
    expect(space(0.5, 1.25)()).toBe('4px 10px');
    expect(typeSize(11)()).toBe(createTheme().typography.pxToRem(11));
    mockConfig.theme2 = undefined;
    expect(space(1)()).toBe('8px');
  });
});
