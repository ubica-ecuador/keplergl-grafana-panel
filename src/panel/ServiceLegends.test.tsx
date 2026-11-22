import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { ShownLegend } from '../data/serviceLegend';
import { LEGEND_WIDTH_PX, legendPlacement, ServiceLegends } from './ServiceLegends';

const GRAPHIC = 'https://maps.dwd.de/geoserver/ows?service=WMS&request=GetLegendGraphic&layer=dwd%3AAutowarn_Analyse';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAPklEQVQ4jWPMy8v7z0BFwAIiJk6aRBXD8vPyGJgYqAyYRg==';

const picture: ShownLegend = {
  dataId: 'grafana-A-wms',
  label: 'Query A',
  title: 'Storm warnings',
  url: GRAPHIC,
  kind: 'image',
};

describe('legendPlacement', () => {
  it('sits in the bottom-left corner, right of the open side panel', () => {
    expect(legendPlacement({ width: 1200, height: 600, sidePanelOpen: false, bottomWidget: null })).toMatchObject({
      left: 8,
      bottom: 8,
      maxWidth: LEGEND_WIDTH_PX,
    });
    expect(legendPlacement({ width: 1200, height: 600, sidePanelOpen: true, bottomWidget: null }).left).toBe(340);
  });

  it('stands on kepler’s bottom widget when the widget reaches the corner, and not when it leaves it free', () => {
    const under = legendPlacement({
      width: 900,
      height: 600,
      sidePanelOpen: false,
      bottomWidget: { left: 0, height: 120 },
    });
    const beside = legendPlacement({
      width: 1600,
      height: 600,
      sidePanelOpen: false,
      bottomWidget: { left: 520, height: 120 },
    });

    expect(under.bottom).toBe(128);
    expect(under.maxHeight).toBe(600 - 128 - 56);
    expect(beside.bottom).toBe(8);
  });

  it('goes over the side panel on a map too narrow for both', () => {
    expect(legendPlacement({ width: 480, height: 400, sidePanelOpen: true, bottomWidget: null }).left).toBe(8);
  });
});

describe('ServiceLegends', () => {
  const props = { width: 1000, height: 600, sidePanelOpen: false, root: null };

  it('shows nothing without a legend', () => {
    const { container } = render(<ServiceLegends {...props} legends={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a WMS legend picture under the layer’s title, folded and unfolded by the title', () => {
    render(<ServiceLegends {...props} legends={[picture]} />);

    const image = screen.getByAltText('Legend of Storm warnings');
    expect(image).toHaveAttribute('src', GRAPHIC);
    const title = screen.getByRole('button', { name: /Storm warnings/ });
    expect(title).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(title);

    expect(title).toHaveAttribute('aria-expanded', 'false');
    expect(image.parentElement).not.toBeVisible();
  });

  it('drops a legend whose picture does not load, and leaves the others', () => {
    render(<ServiceLegends {...props} legends={[picture, { ...picture, dataId: 'grafana-B-wms', title: 'Rain' }]} />);

    fireEvent.error(screen.getByAltText('Legend of Storm warnings'));

    expect(screen.queryByText('Storm warnings')).toBeNull();
    expect(screen.getByAltText('Legend of Rain')).toBeInTheDocument();
  });

  it('draws an ArcGIS legend’s swatches and labels, and nothing when the service refuses', async () => {
    const original = global.fetch;
    const reply = {
      layers: [
        {
          layerId: 0,
          layerName: 'Landsat/MS',
          legend: [
            { label: 'Red: ShortWaveInfrared_1', imageData: PNG, contentType: 'image/png' },
            { label: 'Green: NearInfrared', imageData: PNG, contentType: 'image/png' },
          ],
        },
      ],
    };
    global.fetch = jest.fn(async (url: string) =>
      url.includes('refused') ? Promise.reject(new TypeError('Failed to fetch')) : { ok: true, json: async () => reply }
    ) as unknown as typeof fetch;
    const arcgis: ShownLegend = {
      dataId: 'grafana-C-esri',
      label: 'Landsat',
      title: 'Landsat',
      url: 'https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer/legend?f=json',
      kind: 'arcgis',
    };
    try {
      await act(async () => {
        render(
          <ServiceLegends
            {...props}
            legends={[arcgis, { ...arcgis, dataId: 'grafana-D-esri', title: 'Refused', url: `${arcgis.url}&refused` }]}
          />
        );
      });

      expect(screen.getByText('Red: ShortWaveInfrared_1')).toBeInTheDocument();
      expect(screen.getByText('Green: NearInfrared')).toBeInTheDocument();
      expect(screen.queryByText('Refused')).toBeNull();
    } finally {
      global.fetch = original;
    }
  });
});
