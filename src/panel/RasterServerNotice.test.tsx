import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { getApplicationConfig } from '@kepler.gl/utils';

import { DEFAULT_RASTER_SERVER_URL, rasterServerUrlsOf, resolveRasterServerUrl } from './constants';
import { configureKepler } from './keplerConfig';
import { RasterServerNotice } from './RasterServerNotice';

/**
 * No raster tile server unless one is set: the server is handed every raster
 * URL, signature included, so the plugin no longer picks a third party's for
 * the admin. What a query that needs one gets instead is a notice naming it.
 */

describe('the raster tile server default', () => {
  it('is empty', () => {
    expect(DEFAULT_RASTER_SERVER_URL).toBe('');
  });

  it('resolves an unset or blank option to no server at all', () => {
    expect(resolveRasterServerUrl(undefined)).toBe('');
    expect(resolveRasterServerUrl('   ')).toBe('');
    expect(rasterServerUrlsOf(undefined)).toEqual([]);
    expect(rasterServerUrlsOf('  ')).toEqual([]);
  });

  it('uses the option when it names one', () => {
    expect(resolveRasterServerUrl(' https://titiler.internal ')).toBe('https://titiler.internal');
    expect(rasterServerUrlsOf('https://titiler.internal')).toEqual(['https://titiler.internal']);
  });

  it('leaves kepler’s own list empty too', () => {
    configureKepler();
    expect(getApplicationConfig().rasterServerUrls).toEqual([]);
  });
});

describe('RasterServerNotice', () => {
  it('says nothing when no query is waiting for a server', () => {
    const { container } = render(<RasterServerNotice queries={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('names the query and the option to set', () => {
    render(<RasterServerNotice queries={['Query A']} />);

    expect(screen.getByText('No raster tile server is set')).toBeInTheDocument();
    expect(screen.getByText(/Query A returns imagery/)).toBeInTheDocument();
    expect(screen.getByText('Raster tile server')).toBeInTheDocument();
  });

  it('names every query, in one sentence', () => {
    render(<RasterServerNotice queries={['Query A', 'Rainfall', 'Query C']} />);

    expect(screen.getByText(/Query A, Rainfall and Query C return imagery/)).toBeInTheDocument();
  });

  it('can be dismissed', () => {
    const { container } = render(<RasterServerNotice queries={['Query A']} />);
    fireEvent.click(screen.getByRole('button'));

    expect(container).toBeEmptyDOMElement();
  });
});
