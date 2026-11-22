import React, { useEffect, useState } from 'react';
import styled from 'styled-components';
import { LayerLegendContentFactory } from '@kepler.gl/components';

import { fetchArcgisLegend, type LegendGroup, parseArcgisLegend } from '../data/serviceLegend';
import { esriLegendOf, type EsriLegendSpec } from './esriImageLayer';

type Factory = typeof LayerLegendContentFactory;

/*
 * Drawn in kepler's legend, with kepler's legend look: the 10 px labels in its
 * text colour and the 20 px rows of its colour legends, the 12 px bar and the
 * 9.5 px end labels of its colour ramps (`common/color-legend.js`), and its
 * scroll bar past a height. Inside kepler's own Provider, so the theme is
 * kepler's, not Grafana's.
 */
const StyledServiceLegend = styled.div`
  ${(props) => props.theme.sidePanelScrollBar};
  margin-top: 6px;
  max-height: 240px;
  overflow-y: auto;
  overflow-x: hidden;
`;

const StyledGroupTitle = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.labelColor};
  margin: 4px 0 2px;
`;

const StyledRow = styled.div`
  display: flex;
  align-items: center;
  height: 20px;
  min-width: 0;

  img {
    width: 16px;
    height: 16px;
    flex: none;
    object-fit: contain;
  }
`;

const StyledLabel = styled.div`
  font-size: 10px;
  color: ${(props) => props.theme.textColor};
  padding-left: 4px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledRamp = styled.div`
  display: flex;
  height: 12px;
  width: 100%;
  overflow: hidden;

  img {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    object-fit: fill;
  }
`;

const StyledRampLabels = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 4px;
  margin-top: 2px;
  font-size: 9.5px;
  line-height: 12px;
  color: ${(props) => props.theme.textColor};
`;

/** An ArcGIS legend's groups once fetched; undefined while it is asked for. */
function useArcgisLegend({ url, layerId }: EsriLegendSpec): LegendGroup[] | undefined {
  // Keyed by what was asked, so a legend asked for anew shows nothing of the
  // last one while it comes.
  const key = `${url}|${layerId ?? ''}`;
  const [answer, setAnswer] = useState<{ key: string; groups: LegendGroup[] } | null>(null);
  useEffect(() => {
    let current = true;
    void fetchArcgisLegend(url).then((reply) => {
      if (current) {
        setAnswer({ key, groups: parseArcgisLegend(reply, layerId) });
      }
    });
    return () => {
      current = false;
    };
  }, [key, url, layerId]);
  return answer?.key === key ? answer.groups : undefined;
}

/**
 * An ArcGIS service's legend (`…/legend?f=json`), in kepler's legend under the
 * layer's header: its swatches and labels, a stretch of many values as one bar
 * between its end labels, a title over each of its layers when it has several.
 * Nothing while it is asked for, and nothing for a service that refuses or
 * answers nothing drawable: the header stays, as for any layer with nothing to
 * explain.
 */
export function ArcgisLegend({ legend }: { legend: EsriLegendSpec }) {
  const groups = useArcgisLegend(legend);
  if (!groups?.length) {
    return null;
  }
  return (
    <StyledServiceLegend className="legend--layer_service-legend">
      {groups.map((group, index) => (
        <div key={index}>
          {groups.length > 1 && group.title ? <StyledGroupTitle>{group.title}</StyledGroupTitle> : null}
          {group.ramp ? (
            <>
              <StyledRamp>
                {group.entries.map((entry, at) => (
                  <img key={at} src={entry.image} alt="" />
                ))}
              </StyledRamp>
              <StyledRampLabels>
                <span>{group.ramp.ends[0]}</span>
                <span>{group.ramp.ends[1]}</span>
              </StyledRampLabels>
            </>
          ) : (
            group.entries.map((entry, at) => (
              <StyledRow key={at} title={entry.label}>
                <img src={entry.image} alt="" />
                <StyledLabel>{entry.label}</StyledLabel>
              </StyledRow>
            ))
          )}
        </div>
      ))}
    </StyledServiceLegend>
  );
}

/**
 * kepler's legend content, and for an ArcGIS service layer with an ArcGIS
 * legend its swatches after it. kepler's content draws what a layer offers
 * through `getLegendImageUrl` and its visual channels — a picture `legend_url`
 * of an ArcGIS service, a WMS's legend of the style drawn (`withWmsTime`) —
 * and has no door for a legend made of swatches and labels; every other layer
 * is left to it whole.
 */
export function withServiceLegends<P extends { layer: unknown }>(Content: React.ComponentType<P>): React.FC<P> {
  function LayerLegendContentWithServices(props: P) {
    const legend = esriLegendOf(props.layer);
    return (
      <>
        <Content {...props} />
        {legend ? <ArcgisLegend legend={legend} /> : null}
      </>
    );
  }
  return LayerLegendContentWithServices;
}

CustomLayerLegendContentFactory.deps = LayerLegendContentFactory.deps;

function CustomLayerLegendContentFactory(...deps: Parameters<Factory>) {
  return withServiceLegends(LayerLegendContentFactory(...deps) as React.ComponentType<{ layer: unknown }>);
}

/** The recipe `injectComponents` expects to swap the stock legend content of a layer. */
export function replaceLayerLegendContent(): [Factory, Factory] {
  return [LayerLegendContentFactory, CustomLayerLegendContentFactory as unknown as Factory];
}
