import React from 'react';
import styled from 'styled-components';
import { PanelHeaderFactory } from '@kepler.gl/components';

import { assetBaseUrl } from './keplerConfig';

type Factory = typeof PanelHeaderFactory;

/** What the side panel's header names: the plugin, and the library it is built on. */
export interface SidePanelBrand {
  name: string;
  website: string;
  /** Relative to the plugin's own asset path, as in plugin.json's `logos`. */
  logo: string;
}

export const FREE_BRAND: SidePanelBrand = {
  name: 'Kepler Geospatial Maps',
  website: 'https://docs.ubica.dev/',
  logo: 'img/logo-small.svg',
};

const KEPLER_GL_WEBSITE = 'https://kepler.gl';

const Wrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const Mark = styled.img`
  width: 26px;
  height: 26px;
  flex: none;
`;

const Title = styled.div`
  min-width: 0;
`;

const Name = styled.a`
  display: block;
  color: ${(props) => props.theme.logoColor};
  font-size: 13px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PoweredBy = styled.div`
  color: ${(props) => props.theme.subtextColor};
  font-size: 10px;
  font-weight: normal;
  line-height: 14px;
  white-space: nowrap;

  a {
    color: inherit;
    text-decoration: underline;
  }
`;

/**
 * The plugin's own logo and name, with kepler.gl credited right under them.
 *
 * kepler's header shows its own logo, which inside a Grafana panel reads as if
 * the map were kepler.gl's product rather than a plugin built on it. Dropping
 * kepler from the header would be the opposite mistake, so it keeps a line of
 * its own, linked to its site.
 */
export function sidePanelLogo(brand: SidePanelBrand): React.FC {
  function SidePanelLogo() {
    return (
      <Wrapper className="side-panel-logo">
        <Mark src={`${assetBaseUrl()}/${brand.logo}`} alt="" />
        <Title className="logo__title">
          <Name
            className="logo__link"
            href={brand.website}
            target="_blank"
            rel="noopener noreferrer"
            title={brand.name}
          >
            {brand.name}
          </Name>
          <PoweredBy className="logo__version">
            powered by{' '}
            <a href={KEPLER_GL_WEBSITE} target="_blank" rel="noopener noreferrer">
              kepler.gl
            </a>
          </PoweredBy>
        </Title>
      </Wrapper>
    );
  }
  return SidePanelLogo;
}

/** kepler's side panel header with `brand` in place of kepler's logo; the Share menu is untouched. */
export function brandedPanelHeaderFactory(brand: SidePanelBrand): Factory {
  const Logo = sidePanelLogo(brand);

  function BrandedPanelHeaderFactory(...deps: Parameters<Factory>) {
    const Header = PanelHeaderFactory(...deps) as unknown as React.ComponentType<Record<string, unknown>>;
    function BrandedPanelHeader(props: Record<string, unknown>) {
      return <Header {...props} logoComponent={Logo} />;
    }
    return BrandedPanelHeader;
  }
  BrandedPanelHeaderFactory.deps = PanelHeaderFactory.deps;
  return BrandedPanelHeaderFactory as unknown as Factory;
}

/** The recipe `injectComponents` expects to swap the stock side panel header. */
export function replacePanelHeader(brand: SidePanelBrand = FREE_BRAND): [Factory, Factory] {
  return [PanelHeaderFactory, brandedPanelHeaderFactory(brand)];
}
