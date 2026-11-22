import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import { ThemeProvider } from 'styled-components';
import { theme } from '@kepler.gl/styles';
import { messages } from '@kepler.gl/localization';
import { injector, MapLegendFactory, provideRecipesToInjector } from '@kepler.gl/components';
import { Layer, LayerClasses } from '@kepler.gl/layers';

import { makeEsriImageLayer } from './esriImageLayer';
import { makeXyzTileLayer } from './xyzTileLayer';
import { keplerRecipes } from './keplerRecipes';
import { withWmsTime } from './wmsTimeLayer';

/**
 * kepler's own map legend, with the panel's recipes, over the panel's own WMS
 * and ArcGIS layer classes: what the legend button in the map control opens.
 */
const MapLegend = provideRecipesToInjector(keplerRecipes() as Array<[never, never]>, injector()).get(
  MapLegendFactory as never
) as unknown as React.ComponentType<Record<string, unknown>>;

const WmsLayer = withWmsTime(LayerClasses.wms as never, (props) => props) as unknown as new (props: object) => any;
const EsriLayer = makeEsriImageLayer(Layer as never, (props) => props) as unknown as new (props: object) => any;
const XyzLayer = makeXyzTileLayer(Layer as never, (props) => props) as unknown as new (props: object) => any;

const DWD = 'https://maps.dwd.de/geoserver/ows';
const LANDSAT = 'https://landsat2.arcgis.com/arcgis/rest/services/Landsat/MS/ImageServer';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAYAAACNiR0NAAAAPklEQVQ4jWPMy8v7z0BFwAIiJk6aRBXD8vPyGJgYqAyYRg==';

function wms(visConfig: Record<string, unknown>) {
  const layer = new WmsLayer({ id: 'wms-layer', dataId: 'grafana-A-wms', label: 'Warnings', isVisible: true });
  layer.config.visConfig = { ...layer.config.visConfig, wmsLayer: { name: 'dwd:Autowarn_Analyse' }, ...visConfig };
  layer.meta = { ...layer.meta, tilesetDataUrl: DWD, wmsVersion: '1.3.0' };
  return layer;
}

function esri(legendUrl: string) {
  const layer = new EsriLayer({ id: 'esri-layer', dataId: 'grafana-B-esri', label: 'Landsat', isVisible: true });
  layer.formatLayerData({ 'grafana-B-esri': { metadata: { serviceUrl: LANDSAT, legendUrl } } });
  return layer;
}

function tiles(legendUrl?: string) {
  const layer = new XyzLayer({ id: 'xyz-layer', dataId: 'grafana-C-tiles', label: 'Länder', isVisible: true });
  layer.formatLayerData({
    'grafana-C-tiles': { metadata: { url: 'https://maps.dwd.test/Laender_ocker/{z}/{y}/{x}', legendUrl } },
  });
  return layer;
}

async function legendOf(layers: unknown[]) {
  await act(async () => {
    render(
      <IntlProvider locale="en" messages={messages.en}>
        <ThemeProvider theme={theme}>
          <MapLegend layers={layers} width={240} mapState={{ zoom: 4 }} options={{}} />
        </ThemeProvider>
      </IntlProvider>
    );
  });
}

describe('the service layers in kepler’s map legend', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('lists a WMS layer with the legend of the style it draws', async () => {
    await legendOf([wms({ wmsStyle: 'autowarn_analyse_severity' })]);

    expect(screen.getByText('Warnings')).toBeInTheDocument();
    const picture = screen.getByAltText('Warnings');
    expect(new URL(picture.getAttribute('src')!).searchParams.get('STYLE')).toBe('autowarn_analyse_severity');
  });

  it('lists an ArcGIS service layer with its swatches and labels, and no colour swatch of its own', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        layers: [{ layerId: 0, layerName: 'Landsat/MS', legend: [{ label: 'Red: SWIR 1', imageData: PNG }] }],
      }),
    })) as unknown as typeof fetch;

    await legendOf([esri(`${LANDSAT}/legend`)]);

    expect(screen.getByText('Landsat')).toBeInTheDocument();
    expect(screen.getByText('Red: SWIR 1')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(`${LANDSAT}/legend?f=json`, { credentials: 'omit' });
  });

  it('lists a query’s tiles with the picture of their legend_url, as kepler shows a WMS’s', async () => {
    const legend = `${DWD}?service=WMS&request=GetLegendGraphic&format=image/png&layer=dwd:Laender&style=Laender_ocker`;
    await legendOf([tiles(legend)]);

    expect(screen.getByText('Länder')).toBeInTheDocument();
    expect(screen.getByAltText('Länder')).toHaveAttribute('src', legend);
  });

  it('lists a query’s tiles with no legend and no colour swatch of their own', async () => {
    await legendOf([tiles()]);

    expect(screen.getByText('Länder')).toBeInTheDocument();
    expect(screen.queryByAltText('Länder')).toBeNull();
    expect(document.querySelector('.legend--layer_color-schema, .legend--layer_size-schema')).toBeNull();
  });

  it('shows an ArcGIS service’s picture legend as kepler shows a WMS’s', async () => {
    await legendOf([esri('https://example.org/landsat-legend.png')]);

    expect(screen.getByAltText('Landsat')).toHaveAttribute('src', 'https://example.org/landsat-legend.png');
  });
});
