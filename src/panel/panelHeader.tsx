import React from 'react';
import styled from 'styled-components';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
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

/**
 * Spacing and type from Grafana's theme, so the header sits with the rest of Grafana's UI; the colours are
 * kepler's side panel's own (its theme, mapped from Grafana's), set by the styled wrapper below.
 */
const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    minWidth: 0,
  }),
  mark: css({
    width: theme.spacing(3),
    height: theme.spacing(3),
    flex: 'none',
  }),
  title: css({
    minWidth: 0,
  }),
  name: css({
    display: 'block',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: theme.typography.bodySmall.lineHeight,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }),
  poweredBy: css({
    fontSize: theme.typography.pxToRem(10),
    fontWeight: theme.typography.fontWeightRegular,
    lineHeight: theme.typography.bodySmall.lineHeight,
    whiteSpace: 'nowrap',
    a: {
      color: 'inherit',
      textDecoration: 'underline',
    },
  }),
});

/** kepler's side panel colours for the name and the credit line. */
const Colours = styled.div`
  .logo__link {
    color: ${(props) => props.theme.logoColor};
  }
  .logo__version {
    color: ${(props) => props.theme.subtextColor};
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
    const styles = useStyles2(getStyles);
    return (
      <Colours className={`side-panel-logo ${styles.wrapper}`}>
        <img className={styles.mark} src={`${assetBaseUrl()}/${brand.logo}`} alt="" />
        <div className={`logo__title ${styles.title}`}>
          <a
            className={`logo__link ${styles.name}`}
            href={brand.website}
            target="_blank"
            rel="noopener noreferrer"
            title={brand.name}
          >
            {brand.name}
          </a>
          <div className={`logo__version ${styles.poweredBy}`}>
            powered by{' '}
            <a href={KEPLER_GL_WEBSITE} target="_blank" rel="noopener noreferrer">
              kepler.gl
            </a>
          </div>
        </div>
      </Colours>
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
