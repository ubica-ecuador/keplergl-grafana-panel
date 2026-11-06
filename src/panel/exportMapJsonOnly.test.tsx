import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { ExportMapModalFactory, injector, provideRecipesToInjector } from '@kepler.gl/components';
import { EXPORT_MAP_FORMAT_OPTIONS, EXPORT_MAP_FORMATS } from '@kepler.gl/constants';
import { messages } from '@kepler.gl/localization';
import { theme } from '@kepler.gl/styles';

import { keplerRecipes } from './keplerRecipes';
import { EXPORT_MAP_MESSAGES, registerExportMapMessages } from './exportMapJsonOnly';

/**
 * Share → Export Map, as the panel resolves it: kepler's dialog with no HTML
 * export, which would load kepler.gl, React and fonts from public CDNs, and
 * none of the preview pictures kepler fetches from CloudFront for it.
 */
describe('the Export Map dialog', () => {
  const ExportMapModal = provideRecipesToInjector(keplerRecipes() as Array<[never, never]>, injector()).get(
    ExportMapModalFactory as never
  ) as React.FC<Record<string, unknown>>;

  const open = (options: Record<string, unknown>, onChangeExportMapFormat = jest.fn()) => {
    const catalogue = { ...messages.en };
    registerExportMapMessages({ en: catalogue });
    const view = render(
      <IntlProvider locale="en" messages={catalogue}>
        <ThemeProvider theme={theme}>
          <ExportMapModal
            config={{ version: 'v1', config: {} }}
            options={options}
            onChangeExportMapFormat={onChangeExportMapFormat}
          />
        </ThemeProvider>
      </IntlProvider>
    );
    return { ...view, onChangeExportMapFormat };
  };

  it('offers JSON only, and sets it as it opens on kepler’s HTML default', () => {
    const { container, onChangeExportMapFormat } = open({ format: EXPORT_MAP_FORMATS.HTML, HTML: {}, JSON: {} });

    expect(EXPORT_MAP_FORMAT_OPTIONS.map((o) => o.id)).toEqual([EXPORT_MAP_FORMATS.JSON]);
    const formats = Array.from(container.querySelectorAll('[role="group"] button')).map((b) => b.textContent);
    expect(formats).toEqual(['json']);
    expect(onChangeExportMapFormat).toHaveBeenCalledWith(EXPORT_MAP_FORMATS.JSON);
  });

  it('fetches no picture, from CloudFront or anywhere', () => {
    const { container } = open({ format: EXPORT_MAP_FORMATS.JSON, HTML: {}, JSON: {} });

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/cloudfront|unpkg|esm\.sh/);
    // kepler's JSON panel is there.
    expect(container.textContent).toMatch(/json/i);
  });

  it('says in its help why HTML is missing', () => {
    expect(EXPORT_MAP_MESSAGES['modal.exportMap.formatHtmlHelp']).toMatch(/CDN/);
  });
});
