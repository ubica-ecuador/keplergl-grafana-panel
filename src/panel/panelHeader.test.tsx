import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';

import { FREE_BRAND, sidePanelLogo } from './panelHeader';

describe('sidePanelLogo', () => {
  const renderLogo = () => {
    const Logo = sidePanelLogo(FREE_BRAND);
    return render(
      <ThemeProvider theme={{ logoColor: '#fff', subtextColor: '#aaa' }}>
        <Logo />
      </ThemeProvider>
    );
  };

  it('names the plugin and links it to its documentation', () => {
    renderLogo();

    expect(screen.getByRole('link', { name: 'Kepler Geospatial Maps' })).toHaveAttribute(
      'href',
      'https://docs.ubica.dev/'
    );
  });

  it('credits kepler.gl, linked to its site', () => {
    const { container } = renderLogo();

    expect(container.textContent).toContain('powered by kepler.gl');
    expect(screen.getByRole('link', { name: 'kepler.gl' })).toHaveAttribute('href', 'https://kepler.gl');
  });

  it('shows the plugin’s own logo from the plugin’s asset path', () => {
    const { container } = renderLogo();

    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/img\/logo-small\.svg$/);
  });
});
