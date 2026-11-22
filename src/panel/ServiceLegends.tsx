import React, { useEffect, useState } from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Icon, useStyles2 } from '@grafana/ui';

import { fetchArcgisLegend, type LegendGroup, parseArcgisLegend, type ShownLegend } from '../data/serviceLegend';

/** Where kepler's side panel ends when it is open, as its toggle is measured (`SaveMapConfigButton.tsx`). */
const SIDE_PANEL_RIGHT_PX = 332;
/** kepler's control column along the right edge. */
const CONTROLS_PX = 56;
const EDGE_PX = 8;
/** How wide a legend is, at most: a GetLegendGraphic is drawn at its own size up to this. */
export const LEGEND_WIDTH_PX = 240;
/** Kept clear at the top: kepler's side panel toggle, the save button and the notices. */
const TOP_CLEARANCE_PX = 56;
/** The least height the legends get; past it they scroll. */
const MIN_HEIGHT_PX = 48;

/** kepler's bottom widget — its time widget, its animation controls — as measured in the map. */
export interface BottomWidgetBox {
  /** Its left edge, in pixels from the map's. */
  left: number;
  height: number;
}

/**
 * Where the legends go: the bottom-left corner of the map, right of kepler's
 * side panel when it is open, and above kepler's bottom widget when that
 * reaches the corner. The widget is right-aligned and at most 1080 px wide, so
 * on a wide map it leaves the corner free and the legends stay at the bottom;
 * on a narrower one they stand on it. On a map too narrow for a legend right
 * of the open side panel they go over the panel, as the notices do.
 *
 * At most the map's height, less the top strip of kepler's toggle and the
 * notices; what is taller scrolls.
 */
export function legendPlacement({
  width,
  height,
  sidePanelOpen,
  bottomWidget,
}: {
  width: number;
  height: number;
  sidePanelOpen: boolean;
  bottomWidget: BottomWidgetBox | null;
}): { left: number; bottom: number; maxWidth: number; maxHeight: number } {
  const besidePanel = SIDE_PANEL_RIGHT_PX + EDGE_PX;
  const left =
    sidePanelOpen && besidePanel + Math.min(LEGEND_WIDTH_PX, 160) <= width - CONTROLS_PX ? besidePanel : EDGE_PX;
  const maxWidth = Math.max(0, Math.min(LEGEND_WIDTH_PX, width - left - CONTROLS_PX));
  const lifted =
    bottomWidget && bottomWidget.height > 0 && bottomWidget.left < left + maxWidth + EDGE_PX ? bottomWidget.height : 0;
  const bottom = EDGE_PX + lifted;
  return { left, bottom, maxWidth, maxHeight: Math.max(MIN_HEIGHT_PX, height - bottom - TOP_CLEARANCE_PX) };
}

/**
 * kepler's bottom widget, measured in the map: found by the class kepler gives
 * it, inside this panel's own element only, and followed by a ResizeObserver
 * — the widget changes height when a time filter is enlarged or minified, and
 * moves when the map is resized. Null while there is nothing to place, or
 * where there is no ResizeObserver to follow it with.
 */
function useBottomWidget(root: HTMLElement | null, active: boolean): BottomWidgetBox | null {
  const [box, setBox] = useState<BottomWidgetBox | null>(null);
  useEffect(() => {
    if (!root || !active || typeof ResizeObserver === 'undefined') {
      return;
    }
    let widget: Element | null = null;
    const observer = new ResizeObserver(() => measure());
    const measure = () => {
      if (!widget?.isConnected) {
        widget = root.querySelector('.bottom-widget--container');
        if (widget) {
          observer.observe(widget);
        }
      }
      if (!widget) {
        setBox(null);
        return;
      }
      const own = widget.getBoundingClientRect();
      const next = { left: Math.round(own.left - root.getBoundingClientRect().left), height: Math.round(own.height) };
      setBox((last) => (last && last.left === next.left && last.height === next.height ? last : next));
    };
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, [root, active]);
  return active ? box : null;
}

const getStyles = (theme: GrafanaTheme2) => ({
  stack: css({
    position: 'absolute',
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    overflowY: 'auto',
    pointerEvents: 'auto',
  }),
  block: css({
    background: theme.colors.background.primary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    boxShadow: theme.shadows.z2,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
    flex: 'none',
  }),
  header: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    width: '100%',
    padding: theme.spacing(0.5, 1),
    background: 'none',
    border: 'none',
    color: 'inherit',
    font: 'inherit',
    fontWeight: theme.typography.fontWeightMedium,
    textAlign: 'left',
    cursor: 'pointer',
  }),
  title: css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  body: css({ padding: theme.spacing(0, 1, 1) }),
  // A WMS legend is drawn by the service, most often black on transparent:
  // on a light box it reads in either theme.
  picture: css({
    display: 'block',
    maxWidth: '100%',
    padding: theme.spacing(0.5),
    background: '#fff',
    borderRadius: theme.shape.radius.default,
  }),
  group: css({ '& + &': { marginTop: theme.spacing(0.5) } }),
  groupTitle: css({ color: theme.colors.text.secondary, marginBottom: theme.spacing(0.25) }),
  entry: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(0.75), minHeight: 18 }),
  swatch: css({ width: 16, height: 16, flex: 'none', objectFit: 'contain' }),
  label: css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  ramp: css({
    display: 'flex',
    height: 12,
    '& > img': { flex: '1 1 0', minWidth: 0, height: '100%', objectFit: 'fill' },
  }),
  rampEnds: css({ display: 'flex', justifyContent: 'space-between', gap: theme.spacing(1) }),
});

/**
 * The legends of the services the map draws (`serviceLegend.ts`), one block
 * each, in the bottom-left corner (`legendPlacement`): titled with the layer's
 * label, folded and unfolded by that title, and gone while the layer is hidden.
 *
 * Outside kepler's Provider, beside the notices, where @grafana/ui finds
 * Grafana's theme. A legend that cannot be shown — a picture that does not
 * load, an ArcGIS reply refused or with no swatch — is no block at all: the map
 * is drawn as it would be without it.
 */
export function ServiceLegends({
  legends,
  width,
  height,
  sidePanelOpen,
  root,
}: {
  legends: readonly ShownLegend[];
  width: number;
  height: number;
  sidePanelOpen: boolean;
  /** The map's own element, in which kepler's bottom widget is looked for. */
  root: HTMLElement | null;
}) {
  const styles = useStyles2(getStyles);
  const bottomWidget = useBottomWidget(root, legends.length > 0);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (legends.length === 0) {
    return null;
  }
  const { left, bottom, maxWidth, maxHeight } = legendPlacement({ width, height, sidePanelOpen, bottomWidget });
  if (maxWidth < 80) {
    return null;
  }
  const toggle = (id: string) => {
    const next = new Set(folded);
    if (!next.delete(id)) {
      next.add(id);
    }
    setFolded(next);
  };
  return (
    <div className={styles.stack} style={{ left, bottom, maxWidth, maxHeight }} data-testid="service-legends">
      {legends.map((legend) => (
        <LegendBlock
          // A new url is a new legend: one that failed before is tried again.
          key={`${legend.dataId}|${legend.url}`}
          legend={legend}
          folded={folded.has(legend.dataId)}
          onToggle={() => toggle(legend.dataId)}
          styles={styles}
        />
      ))}
    </div>
  );
}

type Styles = ReturnType<typeof getStyles>;

function LegendBlock({
  legend,
  folded,
  onToggle,
  styles,
}: {
  legend: ShownLegend;
  folded: boolean;
  onToggle: () => void;
  styles: Styles;
}) {
  const [failed, setFailed] = useState(false);
  const groups = useArcgisLegend(legend);
  if (failed || (legend.kind === 'arcgis' && (!groups || groups.length === 0))) {
    return null;
  }
  return (
    <div className={styles.block}>
      <button type="button" className={styles.header} onClick={onToggle} aria-expanded={!folded} title={legend.title}>
        <Icon name={folded ? 'angle-right' : 'angle-down'} size="sm" />
        <span className={styles.title}>{legend.title}</span>
      </button>
      {/* Folded rather than unmounted: a picture already loaded is not asked for again. */}
      <div className={styles.body} hidden={folded}>
        {legend.kind === 'image' ? (
          <img
            className={styles.picture}
            src={legend.url}
            alt={`Legend of ${legend.title}`}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
          />
        ) : (
          groups?.map((group, index) => <Group key={index} group={group} shared={groups.length > 1} styles={styles} />)
        )}
      </div>
    </div>
  );
}

function Group({ group, shared, styles }: { group: LegendGroup; shared: boolean; styles: Styles }) {
  return (
    <div className={styles.group}>
      {shared && group.title && <div className={styles.groupTitle}>{group.title}</div>}
      {group.ramp ? (
        <>
          <div className={styles.ramp}>
            {group.entries.map((entry, index) => (
              <img key={index} src={entry.image} alt="" />
            ))}
          </div>
          <div className={styles.rampEnds}>
            <span>{group.ramp.ends[0]}</span>
            <span>{group.ramp.ends[1]}</span>
          </div>
        </>
      ) : (
        group.entries.map((entry, index) => (
          <div key={index} className={styles.entry} title={entry.label}>
            <img className={styles.swatch} src={entry.image} alt="" />
            <span className={styles.label}>{entry.label}</span>
          </div>
        ))
      )}
    </div>
  );
}

/** An ArcGIS legend's groups once fetched; undefined while it is asked for, and for a picture. */
function useArcgisLegend(legend: ShownLegend): LegendGroup[] | undefined {
  const { kind, url, layerId } = legend;
  const [groups, setGroups] = useState<LegendGroup[] | undefined>(undefined);
  useEffect(() => {
    if (kind !== 'arcgis') {
      return;
    }
    let current = true;
    void fetchArcgisLegend(url).then((reply) => {
      if (current) {
        setGroups(parseArcgisLegend(reply, layerId));
      }
    });
    return () => {
      current = false;
    };
  }, [kind, url, layerId]);
  return groups;
}
