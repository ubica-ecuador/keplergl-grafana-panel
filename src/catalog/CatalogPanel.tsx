import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { config } from '@grafana/runtime';
import { MapControlButton } from '@kepler.gl/components';

import type { SavedCatalogLayer, SavedRemoteDataset } from '../data/mapConfig';
import {
  type AddContext,
  catalogDataset,
  catalogEntries,
  type CatalogEntry,
  listCatalogs,
  searchCatalog,
  followedArea,
  MAX_FOLLOW_SPAN,
  momentDataset,
  momentLabel,
  searchDataset,
  searchScenes,
  serviceDataset,
  featuresArea,
  featuresDataset,
  featuresHaveTime,
  featuresLabel,
  readableHere,
  serviceLabel,
  vectorDataset,
  vectorFormat,
  vectorQuery,
  parquetLayer,
  readsByArea,
  type SearchedScenes,
  whereInstead,
  whyNotAddable,
  withSeries,
} from './catalogSource';

/** What the map offers the catalog panel: adding a dataset to it, and what it draws rasters with. Provided by KeplerMap. */
export interface CatalogApi {
  add(saved: SavedRemoteDataset): void;
  /** Adds a layer the map reads by query over its view (a GeoParquet read by area). */
  addLayer?(layer: SavedCatalogLayer): void;
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
  ['map-service', 'Services'],
  ['features', 'Features'],
  ['geoparquet', 'GeoParquet'],
  ['vector', 'Vectors'],
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

/** What a series' scenes are, for its toggle: years when each starts a year, else dates. */
export function scenesLabel(members: Array<Pick<CatalogEntry, 'start'>>): string {
  return members.every((member) => /^\d{4}$/.test(entryDate(member.start))) ? 'Years' : 'Dates';
}

/** A time range as the list's chip says it: days, in UTC. */
function rangeText(range: { from: number; to: number }): string {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  return `${day(range.from)} to ${day(range.to)}`;
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
const Actions = styled.div`
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
`;
const Toggle = styled.button`
  padding: 3px 8px;
  border-radius: 3px;
  border: 1px solid ${(props) => props.theme.panelBorderColor};
  background: transparent;
  color: ${(props) => props.theme.textColor};
  cursor: pointer;
  font-size: 11px;
`;
const Members = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: -4px 0 0 16px;
`;
const MemberRow = styled(Row)`
  padding: 4px 6px;
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
  // Series whose scenes are listed one by one, and whether the list keeps to the dashboard's time range.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [inRange, setInRange] = useState(false);
  // What a search said, by entry: searching, how many scenes, none here, or why it failed.
  const [notes, setNotes] = useState<Record<string, string>>({});
  // A searched series' moments over the view, listed to add one alone: by entry.
  const [moments, setMoments] = useState<Record<string, SearchedScenes>>({});

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
  const range = api.context.timeRange ?? null;
  const shown = searchCatalog(entries ?? [], text, kind, inRange ? range : null);
  const follows = api.context.followsDashboard === true;
  const note = (id: string, said: string) => setNotes((was) => ({ ...was, [id]: said }));
  // A searched series is searched first, over the view in the dashboard's range: added at its newest scene, or not
  // at all when the area has none in that range.
  // Where a search goes: the view, on the grid the map follows it on; none when the view is too wide to search.
  const searchArea = (entry: CatalogEntry) => {
    const view = api.context.viewBounds?.() ?? null;
    const area = followedArea(view);
    if (!view || !range) {
      note(entry.id, 'No view or time range to search');
    } else if (!area) {
      note(entry.id, `Zoom in to search: the view is wider than ${MAX_FOLLOW_SPAN}°`);
    }
    return range ? area : null;
  };
  const addSearch = async (entry: CatalogEntry) => {
    const area = searchArea(entry);
    if (!entry.search || !area || !range) {
      return;
    }
    note(entry.id, 'Searching…');
    try {
      const found = await searchScenes(uid, { target: entry.search.target, bbox: area }, range);
      const saved = searchDataset(entry, uid, api.context, found, area);
      if (!saved) {
        note(entry.id, 'No scene over this view in the time range');
        return;
      }
      api.add(saved);
      setAdded((was) => new Set([...was, entry.id]));
      const n = found.scenes.length;
      note(entry.id, `${n}${found.truncated ? '+' : ''} scene${n === 1 ? '' : 's'} in the time range`);
    } catch (err) {
      note(entry.id, `The search failed: ${String((err as Error)?.message ?? err)}`);
    }
  };
  // The moments a searched series has over the view in the range, listed below its row.
  const listMoments = async (entry: CatalogEntry) => {
    const area = searchArea(entry);
    if (!entry.search || !area || !range) {
      return;
    }
    note(entry.id, 'Searching…');
    try {
      const found = await searchScenes(uid, { target: entry.search.target, bbox: area }, range);
      setMoments((was) => ({ ...was, [entry.id]: found }));
      note(
        entry.id,
        found.scenes.length ? `${found.scenes.length} dates over the view` : 'No scene over this view in the time range'
      );
    } catch (err) {
      note(entry.id, `The search failed: ${String((err as Error)?.message ?? err)}`);
    }
  };
  const addMoment = (entry: CatalogEntry, scene: SearchedScenes['scenes'][number], painted: boolean | null) => {
    const saved = momentDataset(entry, uid, api.context, scene, painted);
    if (saved) {
      api.add(saved);
      setAdded((was) => new Set([...was, saved.data.id]));
    }
  };
  // A map service is read first when it has to be (a TileJSON, a PMTiles header), then added as the map draws it.
  const addService = async (entry: CatalogEntry) => {
    note(entry.id, 'Reading…');
    try {
      const saved = await serviceDataset(entry, uid);
      if (!saved) {
        note(entry.id, 'This map cannot draw this service');
        return;
      }
      api.add(saved);
      setAdded((was) => new Set([...was, entry.id]));
      note(entry.id, entry.license);
    } catch (err) {
      note(entry.id, `The service did not answer: ${String((err as Error)?.message ?? err)}`);
    }
  };
  // Features of an OGC API, a WFS or an ArcGIS layer: loaded by kepler from the address of the view and the time
  // range, which it follows.
  const addFeatures = (entry: CatalogEntry) => {
    // Any view: the service answers at most a count of features, however wide the area.
    const area = featuresArea(api.context.viewBounds?.() ?? null);
    if (!area) {
      note(entry.id, 'No view to ask the features of');
      return;
    }
    const saved = featuresDataset(entry, uid, area, range);
    if (saved) {
      api.add(saved);
      setAdded((was) => new Set([...was, entry.id]));
      note(entry.id, `The first features over the view${featuresHaveTime(entry) ? ' in the time range' : ''}`);
    }
  };
  // A vector file: loaded whole by kepler from its address (a PMTiles archive as tiles).
  const addVector = async (entry: CatalogEntry) => {
    if (!(await readableHere(entry.href))) {
      note(entry.id, `Its server lets no browser read it (CORS): read it by query, ${vectorQuery(entry)}`);
      return;
    }
    const saved = await vectorDataset(entry, uid);
    if (saved) {
      api.add(saved);
      setAdded((was) => new Set([...was, entry.id]));
    }
  };
  // A GeoParquet: read by area over the view, again as it moves, only the row groups there.
  const addParquet = (entry: CatalogEntry) => {
    const area = searchArea(entry);
    if (area && api.addLayer) {
      api.addLayer(parquetLayer(entry, uid, area));
      setAdded((was) => new Set([...was, entry.id]));
      note(entry.id, 'Read over the view, again as it moves');
    }
  };
  const add = (entry: CatalogEntry) => {
    if (readsByArea(entry)) {
      addParquet(entry);
      return;
    }
    if (entry.kind === 'map-service') {
      void addService(entry);
      return;
    }
    if (entry.kind === 'features') {
      addFeatures(entry);
      return;
    }
    if (entry.kind === 'vector') {
      void addVector(entry);
      return;
    }
    if (entry.search) {
      void addSearch(entry);
      return;
    }
    const saved = catalogDataset(entry, uid, api.context);
    if (saved) {
      api.add(saved);
      setAdded(new Set([...added, entry.id]));
    }
  };
  const addButton = (entry: CatalogEntry, title: string) => {
    const done = added.has(entry.id);
    const busy = notes[entry.id] === 'Searching…' || notes[entry.id] === 'Reading…';
    return (
      <Add aria-label={`Add ${entry.title}`} title={title} disabled={done || busy} onClick={() => add(entry)}>
        {done ? 'Added' : busy ? '…' : 'Add'}
      </Add>
    );
  };
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
        {range ? (
          <Chip
            $on={inRange}
            aria-pressed={inRange}
            title={`Only what holds within the dashboard's time range, ${rangeText(range)}`}
            onClick={() => setInRange(!inRange)}
          >
            In the time range
          </Chip>
        ) : null}
      </Kinds>
      {error ? <span>The catalog did not answer: {error}</span> : null}
      {entries === null && !error ? <span>Reading the catalog…</span> : null}
      {entries !== null ? <span>{shown.length} entries</span> : null}
      {shown.map((entry) => {
        const why = whyNotAddable(entry, api.context);
        const members = entry.members ?? [];
        const isOpen = members.length > 0 && (expanded.has(entry.id) || entry.foundByMembers === true);
        const datesOpen = Boolean(entry.search) && expanded.has(entry.id);
        const found = moments[entry.id];
        const picks = follows ? "the dashboard's date picks the scene" : "the map's time slider picks the scene";
        const searched = entry.search ? `searched over the map's view in the dashboard's time range; ${picks}` : null;
        return (
          <React.Fragment key={entry.id}>
            <Row
              className="catalog-entry"
              title={
                why ??
                (searched ? `${entry.title}: ${searched}` : entry.scenes ? `${entry.title}: ${picks}` : entry.title)
              }
            >
              <Thumb style={entry.thumbnail ? { backgroundImage: `url("${pageUrl(entry.thumbnail)}")` } : undefined} />
              <Text>
                <b>{entry.title}</b>
                <span>
                  {(readsByArea(entry)
                    ? [
                        'GeoParquet',
                        'read by area',
                        typeof entry.size === 'number'
                          ? `${(entry.size / 1e9).toFixed(entry.size < 1e10 ? 1 : 0)} GB`
                          : '',
                      ]
                    : entry.kind === 'features'
                      ? featuresLabel(entry)
                      : entry.kind === 'vector'
                        ? [
                            (vectorFormat(entry) ?? 'file').toUpperCase(),
                            typeof entry.size === 'number'
                              ? `${(entry.size / 1e6).toFixed(entry.size < 1e7 ? 1 : 0)} MB`
                              : '',
                            entry.collection,
                          ]
                        : entry.service
                          ? [serviceLabel(entry.service), entry.service.layers.join(', '), entry.collection]
                          : entry.search
                            ? [entry.kind === 'external' ? 'STAC API' : 'tiles', 'searched over the view']
                            : entry.scenes
                              ? [entryWhen(entry), follows ? 'follows the date' : 'raster series']
                              : [entry.kind, entry.collection, entryWhen(entry)]
                  )
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span>{notes[entry.id] ?? entry.license}</span>
              </Text>
              <Actions>
                {why ? (
                  <Elsewhere title={entry.kind === 'vector' ? `${why} ${vectorQuery(entry)}` : why}>
                    {whereInstead(entry)}
                  </Elsewhere>
                ) : (
                  addButton(
                    entry,
                    searched
                      ? `Add the scenes ${searched}`
                      : entry.scenes
                        ? `Add the whole series: ${picks}`
                        : `Add ${entry.title}`
                  )
                )}
                {members.length > 0 ? (
                  <Toggle
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? 'Hide' : 'Show'} the scenes of ${entry.title}`}
                    title="Add one scene alone, fixed whatever the date: two of them compare"
                    onClick={() => {
                      const next = new Set(expanded);
                      if (isOpen) {
                        next.delete(entry.id);
                      } else {
                        next.add(entry.id);
                      }
                      setExpanded(next);
                    }}
                  >
                    {scenesLabel(members)} {isOpen ? '▴' : '▾'}
                  </Toggle>
                ) : null}
                {entry.search && !why ? (
                  <Toggle
                    aria-expanded={datesOpen}
                    aria-label={`${datesOpen ? 'Hide' : 'Show'} the dates of ${entry.title}`}
                    title="The dates over the view in the time range: add one alone, fixed whatever the date"
                    onClick={() => {
                      const next = new Set(expanded);
                      if (datesOpen) {
                        next.delete(entry.id);
                      } else {
                        next.add(entry.id);
                        void listMoments(entry);
                      }
                      setExpanded(next);
                    }}
                  >
                    Dates {datesOpen ? '▴' : '▾'}
                  </Toggle>
                ) : null}
              </Actions>
            </Row>
            {datesOpen && found ? (
              <Members role="group" aria-label={`The dates of ${entry.title}`}>
                {[...found.scenes].reverse().map((scene) => {
                  const id = momentDataset(entry, uid, api.context, scene, found.painted)?.data.id ?? scene.url;
                  const pieces = scene.parts?.length ?? 1;
                  const label = momentLabel(scene.time);
                  return (
                    <MemberRow key={id} className="catalog-entry catalog-moment" title={`${entry.title}, ${label}`}>
                      <Text>
                        <b>{label || 'Undated'}</b>
                        <span>{[pieces > 1 ? `${pieces} images` : '1 image', 'fixed'].join(' · ')}</span>
                      </Text>
                      <Add
                        aria-label={`Add ${entry.title}, ${label}`}
                        title={`Add ${label} alone, whatever the date`}
                        disabled={added.has(id)}
                        onClick={() => addMoment(entry, scene, found.painted)}
                      >
                        {added.has(id) ? 'Added' : 'Add'}
                      </Add>
                    </MemberRow>
                  );
                })}
              </Members>
            ) : null}
            {isOpen ? (
              <Members role="group" aria-label={`The scenes of ${entry.title}`}>
                {members.map((member) => {
                  const whyMember = whyNotAddable(member, api.context);
                  return (
                    <MemberRow
                      key={member.id}
                      className="catalog-entry catalog-member"
                      title={whyMember ?? member.title}
                    >
                      <Text>
                        <b>{entryDate(member.start) || member.title}</b>
                        <span>{[member.kind, 'fixed'].join(' · ')}</span>
                      </Text>
                      {whyMember ? (
                        <Elsewhere>{whereInstead(member)}</Elsewhere>
                      ) : (
                        addButton(member, `Add ${member.title} alone, whatever the date`)
                      )}
                    </MemberRow>
                  );
                })}
              </Members>
            ) : null}
          </React.Fragment>
        );
      })}
    </Panel>
  );
}
