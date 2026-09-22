import React from 'react';
import { Button, Input, LayerConfigGroup, PanelLabel, VisConfigSlider } from '@kepler.gl/components';

import { MarkerSpec, newMarker, readMarkers } from './markers';
import { SymbolPicker } from './symbolPicker';

/**
 * The layer panel for the markers layer: one row per marker — label, colour
 * and the two variables its position is written to — plus the marker size.
 *
 * Text fields commit on blur rather than on every key: each commit is a kepler
 * action that rebuilds the panel, and a controlled field rebuilt mid-word loses
 * the caret. Keyed by marker id so a removed row does not hand its text to the
 * next one.
 *
 * Wired in `flowFieldConfigurator.tsx`, which owns the configurator subclass.
 */

export interface MarkersLayerConfigProps {
  layer: {
    config: { visConfig: Record<string, unknown> };
    visConfigSettings: Record<string, Record<string, unknown>>;
  };
  visConfiguratorProps: Record<string, unknown> & { onChange?: (patch: Record<string, unknown>) => void };
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

function fromHex(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return match ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)] : null;
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 };

export function MarkersLayerConfig({ layer, visConfiguratorProps }: MarkersLayerConfigProps) {
  const markers = readMarkers(layer.config.visConfig);
  const settings = layer.visConfigSettings ?? {};
  const commit = (next: MarkerSpec[]) => visConfiguratorProps.onChange?.({ markers: next });
  const edit = (id: string, patch: Partial<MarkerSpec>) =>
    commit(markers.map((marker) => (marker.id === id ? { ...marker, ...patch } : marker)));

  return (
    <div>
      <LayerConfigGroup label={'markers.group.markers'}>
        {markers.map((marker) => (
          <div key={marker.id} data-testid={`marker-row-${marker.id}`} style={{ marginBottom: 10 }}>
            <div style={rowStyle}>
              <input
                type="color"
                aria-label="Marker colour"
                value={toHex(marker.color)}
                onChange={(event) => {
                  const color = fromHex(event.target.value);
                  if (color) {
                    edit(marker.id, { color });
                  }
                }}
                style={{ width: 28, height: 28, padding: 0, border: 'none', background: 'none' }}
              />
              <Input
                aria-label="Marker label"
                placeholder="Label"
                defaultValue={marker.label}
                onBlur={(event: React.FocusEvent<HTMLInputElement>) => edit(marker.id, { label: event.target.value })}
              />
              <Button
                secondary
                small
                aria-label="Remove marker"
                onClick={() => commit(markers.filter((other) => other.id !== marker.id))}
              >
                ✕
              </Button>
            </div>
            <div style={rowStyle}>
              <PanelLabel style={{ margin: 0, minWidth: 24 }}>Lat</PanelLabel>
              <Input
                aria-label="Latitude variable"
                placeholder="variable"
                defaultValue={marker.latVariable}
                onBlur={(event: React.FocusEvent<HTMLInputElement>) =>
                  edit(marker.id, { latVariable: event.target.value.trim() })
                }
              />
              <PanelLabel style={{ margin: 0, minWidth: 24 }}>Lng</PanelLabel>
              <Input
                aria-label="Longitude variable"
                placeholder="variable"
                defaultValue={marker.lngVariable}
                onBlur={(event: React.FocusEvent<HTMLInputElement>) =>
                  edit(marker.id, { lngVariable: event.target.value.trim() })
                }
              />
            </div>
          </div>
        ))}
        <Button secondary small onClick={() => commit([...markers, newMarker(markers)])}>
          + Add marker
        </Button>
      </LayerConfigGroup>

      <LayerConfigGroup label={'markers.group.display'} collapsible>
        {/* The symbol layer's picker: a category, then its symbols, each
            drawn beside its name. */}
        {settings.symbol ? <SymbolPicker layer={layer} visConfiguratorProps={visConfiguratorProps} /> : null}
        {settings.angleDegrees && layer.config.visConfig.symbol !== 'circle' ? (
          <VisConfigSlider {...settings.angleDegrees} {...visConfiguratorProps} />
        ) : null}
        {settings.markerRadius ? <VisConfigSlider {...settings.markerRadius} {...visConfiguratorProps} /> : null}
      </LayerConfigGroup>
    </div>
  );
}
