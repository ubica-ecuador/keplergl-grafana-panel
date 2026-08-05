import React from 'react';
import { render, screen } from '@testing-library/react';

import { BasemapAttribution } from './BasemapAttribution';

describe('BasemapAttribution', () => {
  it('renders the exact credit Esri requires and kepler does not show', () => {
    render(<BasemapAttribution />);

    expect(screen.getByText('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community')).toBeInTheDocument();
  });

  it('does not intercept pointer events meant for the map underneath', () => {
    render(<BasemapAttribution />);

    expect(screen.getByText(/Source: Esri/)).toHaveStyle({ pointerEvents: 'none' });
  });
});
