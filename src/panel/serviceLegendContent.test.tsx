import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';

import { withServiceLegends } from './serviceLegendContent';

const SERVICE = 'https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAPklEQVQ4jWPMy8v7z0BFwAIiJk6aRBXD8vPyGJgYqAyYRg==';

/** kepler's own legend content, as far as these tests need it: what it would draw of the layer. */
function Stock({ layer }: { layer: { config: { label: string } } }) {
  return <div>kepler’s legend of {layer.config.label}</div>;
}
const Content = withServiceLegends(Stock as React.ComponentType<{ layer: unknown }>);

const reply = (layerName: string, count: number) => ({
  layers: [
    {
      layerId: 0,
      layerName,
      legend: Array.from({ length: count }, (_, i) => ({
        label: `class ${i}`,
        imageData: PNG,
        contentType: 'image/png',
      })),
    },
  ],
});

describe('the legend content of a layer', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  const shown = async (layer: unknown, answer: (url: string) => unknown) => {
    global.fetch = jest.fn(async (url: string) => {
      const body = answer(url);
      return body instanceof Error ? Promise.reject(body) : { ok: true, json: async () => body };
    }) as unknown as typeof fetch;
    await act(async () => {
      render(
        <ThemeProvider theme={theme}>
          <Content layer={layer} />
        </ThemeProvider>
      );
    });
  };

  it('leaves every layer that is no ArcGIS service to kepler, untouched', async () => {
    await shown({ type: 'wms', config: { label: 'Warnings' } }, () => reply('x', 1));

    expect(screen.getByText('kepler’s legend of Warnings')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('draws an ArcGIS legend’s swatches and labels after kepler’s content', async () => {
    const layer = {
      type: 'esriImage',
      config: { label: 'Landsat' },
      esriLegend: { url: `${SERVICE}/legend?f=json&swatches` },
    };
    await shown(layer, () => reply('Landsat/MS', 3));

    expect(screen.getByText('kepler’s legend of Landsat')).toBeInTheDocument();
    expect(screen.getByText('class 0')).toBeInTheDocument();
    expect(screen.getByText('class 2')).toBeInTheDocument();
  });

  it('draws a stretch of many values as a bar between its end labels', async () => {
    const layer = {
      type: 'esriImage',
      config: { label: 'NDVI' },
      esriLegend: { url: `${SERVICE}/legend?f=json&ramp` },
    };
    await shown(layer, () => reply('NDVI', 256));

    expect(screen.getByText('class 0')).toBeInTheDocument();
    expect(screen.getByText('class 255')).toBeInTheDocument();
    expect(screen.queryByText('class 128')).toBeNull();
  });

  it('draws nothing more for a service that refuses, and keeps kepler’s content', async () => {
    const layer = {
      type: 'esriImage',
      config: { label: 'Refused' },
      esriLegend: { url: `${SERVICE}/legend?f=json&no` },
    };
    await shown(layer, () => new TypeError('Failed to fetch'));

    expect(screen.getByText('kepler’s legend of Refused')).toBeInTheDocument();
    expect(document.querySelector('.legend--layer_service-legend')).toBeNull();
  });
});
