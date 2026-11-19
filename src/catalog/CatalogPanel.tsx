import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { config } from '@grafana/runtime';
import { MapControlButton } from '@kepler.gl/components';

import type { SavedRemoteDataset } from '../data/mapConfig';
import {
  type AddContext,
  catalogDataset,
  catalogEntries,
  type CatalogEntry,
  listCatalogs,
  searchCatalog,
  whereInstead,
  whyNotAddable,
  withSeries,
} from './catalogSource';

/** What the map offers the catalog panel: adding a dataset to it, and what it draws rasters with. Provided by KeplerMap. */
export interface CatalogApi {
  add(saved: SavedRemoteDataset): void;
  context: AddContext;
}
export const CatalogContext = createContext<CatalogApi | null>(null);

/** Whether the catalog panel is open; held by the map control, which mounts both the button and the panel. */
export const CatalogToggleContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => undefined,
});

const KINDS: Array<[string, string]> = [
  ['', 'All'],
  ['3d-tiles', '3D Tiles'],
  ['gltf-model', 'Models'],
  ['raster', 'Rasters'],
  ['external', 'Catalogs'],
];

/** An entry's date for its row: the year alone when it starts a year (a yearly series), else the day. */
export function entryDate(start: number | null): string {
  if (start === null) {
    return '';
  }
  const iso = new Date(start).toISOString();
  return iso.endsWith('-01-01T00:00:00.000Z') ? iso.slice(0, 4) : iso.slice(0, 10);
}

/** When an entry holds, for its row: a series' first and last scene and how many, else its date. */
export function entryWhen(entry: Pick<CatalogEntry, 'start' | 'scenes'>): string {
  const scenes = entry.scenes ?? [];
  if (scenes.length < 2) {
    return entryDate(entry.start);
  }
  return `${entryDate(scenes[0].start)}–${entryDate(scenes[scenes.length - 1].start)} · ${scenes.length} scenes`;
}

/** An address the page can load: Grafana's own paths under its sub-path. */
function pageUrl(url: string): string {
  const sub = config.appSubUrl ?? '';
  return url.startsWith('/') && sub && !url.startsWith(`${sub}/`) ? `${sub}${url}` : url;
}

function CatalogIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
      <path d="M17.5 3.5v5M15 6h5" />
    </svg>
  );
}

/** The toolbar button: shown when this Grafana has a catalog data source. */
export function CatalogControl() {
  const { open, setOpen } = useContext(CatalogToggleContext);
  const api = useContext(CatalogContext);
  const hasCatalog = useMemo(() => listCatalogs().length > 0, []);
  if (!api || !hasCatalog) {
    return null;
  }
  return (
    <MapControlButton
      className="map-control-button toggle-catalog"
      title={open ? 'Close the catalog' : 'Add from catalog'}
      aria-label="Add from catalog"
      active={open}
      onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        setOpen(!open);
      }}
    >
      <CatalogIcon />
    </MapControlButton>
  );
}

const Panel = styled.div`
  width: 320px;
  max-height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  margin: 0 8px 8px 0;
  padding: 12px;
  background: ${(props) => props.theme.panelBackground};
  color: ${(props) => props.theme.textColor};
  box-shadow: ${(props) => props.theme.panelBoxShadow};
  border-radius: 4px;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;
const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 13px;
  color: ${(props) => props.theme.textColorHl};
`;
const Field = styled.input`
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  background: ${(props) => props.theme.inputBgd};
  color: ${(props) => props.theme.inputColor};
  border: 1px solid ${(props) => props.theme.inputBorderColor};
  border-radius: 3px;
`;
const Kinds = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;
const Chip = styled.button<{ $on: boolean }>`
  padding: 3px 8px;
  border-radius: 12px;
  border: 1px solid ${(props) => (props.$on ? props.theme.activeColor : props.theme.panelBorderColor)};
  background: ${(props) => (props.$on ? props.theme.activeColor : 'transparent')};
  color: ${(props) => (props.$on ? '#fff' : props.theme.textColor)};
  cursor: pointer;
  font-size: 11px;
`;
const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid ${(props) => props.theme.panelBorderColor};
`;
const Thumb = styled.div`
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 3px;
  background: ${(props) => props.theme.panelBackgroundHover} center / cover no-repeat;
`;
const Text = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  & > b {
    color: ${(props) => props.theme.textColorHl};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  & > span {
    color: ${(props) => props.theme.subtextColor};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;
const Add = styled.button`
  flex: none;
  padding: 4px 10px;
  border-radius: 3px;
  border: none;
  cursor: pointer;
  background: ${(props) => props.theme.primaryBtnBgd};
  color: ${(props) => props.theme.primaryBtnColor};
  &:disabled {
    cursor: default;
    opacity: 0.4;
  }
`;
const Picker = styled.select`
  width: 100%;
  padding: 5px 6px;
  background: ${(props) => props.theme.inputBgd};
  color: ${(props) => props.theme.inputColor};
  border: 1px solid ${(props) => props.theme.inputBorderColor};
  border-radius: 3px;
`;
const Elsewhere = styled.span`
  flex: none;
  padding: 3px 8px;
  border-radius: 10px;
  border: 1px solid ${(props) => props.theme.panelBorderColor};
  color: ${(props) => props.theme.subtextColor};
  font-size: 11px;
`;
const Close = styled.button`
  border: none;
  background: transparent;
  color: ${(props) => props.theme.textColor};
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
`;

/** The catalog's entries: search, a kind, and Add for what this map can draw. */
export function CatalogPanel() {
  const { open, setOpen } = useContext(CatalogToggleContext);
  const api = useContext(CatalogContext);
  const catalogs = useMemo(() => listCatalogs(), []);
  const [uid, setUid] = useState(catalogs[0]?.uid ?? '');
  // What the catalog answered, and for which one: a list of another catalog's reads as not read yet.
  const [read, setRead] = useState<{ uid: string; entries?: CatalogEntry[]; error?: string } | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open || !uid) {
      return;
    }
    let live = true;
    catalogEntries(uid)
      .then((answer) => live && setRead({ uid, entries: answer }))
      .catch((err) => live && setRead({ uid, error: String(err?.message ?? err) }));
    return () => {
      live = false;
    };
  }, [open, uid]);
  const answered = read?.uid === uid ? (read.entries ?? null) : null;
  // A collection's dated rasters are one series to add: the map's time range picks the scene.
  const entries = useMemo(() => (answered ? withSeries(answered) : null), [answered]);
  const error = read?.uid === uid ? (read.error ?? null) : null;

  if (!open || !api) {
    return null;
  }
  const shown = searchCatalog(entries ?? [], text, kind);
  return (
    <Panel className="catalog-panel" role="dialog" aria-label="Add from catalog">
      <Header>
        <span>Add from catalog</span>
        <Close aria-label="Close" onClick={() => setOpen(false)}>
          ×
        </Close>
      </Header>
      {catalogs.length > 1 ? (
        <Picker aria-label="Catalog" value={uid} onChange={(e) => setUid(e.target.value)}>
          {catalogs.map((c) => (
            <option key={c.uid} value={c.uid}>
              {c.name}
            </option>
          ))}
        </Picker>
      ) : null}
      <Field
        aria-label="Search the catalog"
        placeholder="Search"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Kinds role="group" aria-label="Kind">
        {KINDS.map(([value, label]) => (
          <Chip key={value} $on={kind === value} aria-pressed={kind === value} onClick={() => setKind(value)}>
            {label}
          </Chip>
        ))}
      </Kinds>
      {error ? <span>The catalog did not answer: {error}</span> : null}
      {entries === null && !error ? <span>Reading the catalog…</span> : null}
      {entries !== null ? <span>{shown.length} entries</span> : null}
      {shown.map((entry) => {
        const why = whyNotAddable(entry, api.context);
        const done = added.has(entry.id);
        const tip = why ?? (entry.scenes ? `${entry.title}: the map's time range picks the scene` : entry.title);
        return (
          <Row key={entry.id} className="catalog-entry" title={tip}>
            <Thumb style={entry.thumbnail ? { backgroundImage: `url("${pageUrl(entry.thumbnail)}")` } : undefined} />
            <Text>
              <b>{entry.title}</b>
              <span>
                {(entry.scenes ? [entryWhen(entry), 'raster series'] : [entry.kind, entry.collection, entryWhen(entry)])
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <span>{entry.license}</span>
            </Text>
            {why ? (
              <Elsewhere>{whereInstead(entry)}</Elsewhere>
            ) : (
              <Add
                aria-label={`Add ${entry.title}`}
                disabled={done}
                onClick={() => {
                  const saved = catalogDataset(entry, uid, api.context);
                  if (saved) {
                    api.add(saved);
                    setAdded(new Set([...added, entry.id]));
                  }
                }}
              >
                {done ? 'Added' : 'Add'}
              </Add>
            )}
          </Row>
        );
      })}
    </Panel>
  );
}
