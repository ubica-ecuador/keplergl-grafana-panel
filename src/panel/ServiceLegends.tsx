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

/**
 * Something of kepler's in the map's bottom edge that the legends stand on
 * rather than cover: its bottom widget (the time widget, the animation
 * controls) or its scale bar, as measured in the map.
 */
export interface CornerObstacle {
  /** Its left and right edges, in pixels from the map's left edge. */
  left: number;
  right: number;
  /** How high its top is above the map's bottom edge, in pixels. */
  rise: number;
}

/**
 * Where the legends go: the bottom-left corner of the map, right of kepler's
 * side panel when it is open, and above whatever of kepler's sits in that
 * corner (`CornerObstacle`): its scale bar, which is always there, and its
 * bottom widget when that reaches the corner. The widget is right-aligned and
 * at most 1080 px wide, so on a wide map it leaves the corner free; on a
 * narrower one the legends stand on it. On a map too narrow for a legend right
 * of the open side panel they go over the panel, as the notices do.
 *
 * At most the map's height, less the top strip of kepler's toggle and the
 * notices; what is taller scrolls.
 */
export function legendPlacement({
  width,
  height,
  sidePanelOpen,
  obstacles,
}: {
  width: number;
  height: number;
  sidePanelOpen: boolean;
  obstacles: readonly CornerObstacle[];
}): { left: number; bottom: number; maxWidth: number; maxHeight: number } {
  const besidePanel = SIDE_PANEL_RIGHT_PX + EDGE_PX;
  const left =
    sidePanelOpen && besidePanel + Math.min(LEGEND_WIDTH_PX, 160) <= width - CONTROLS_PX ? besidePanel : EDGE_PX;
  const maxWidth = Math.max(0, Math.min(LEGEND_WIDTH_PX, width - left - CONTROLS_PX));
  // Only what lies under the legends' own span lifts them.
  const lifted = obstacles
    .filter((obstacle) => obstacle.rise > 0 && obstacle.left < left + maxWidth && obstacle.right > left)
    .reduce((highest, obstacle) => Math.max(highest, obstacle.rise), 0);
  const bottom = EDGE_PX + lifted;
  return { left, bottom, maxWidth, maxHeight: Math.max(MIN_HEIGHT_PX, height - bottom - TOP_CLEARANCE_PX) };
}

/** What the legends stand on: kepler's bottom widget, and its scale bar (one per pane of a split map). */
const OBSTACLES = '.bottom-widget--container, .map-scale';

/**
 * kepler's bottom widget and scale bar, measured in the map: found by the
 * classes kepler gives them, inside this panel's own element only. Followed by
 * a ResizeObserver on each and on the map — the widget changes height when a
 * time filter is enlarged or minified, the scale bar its width with the zoom —
 * and looked for again on a frame after kepler adds or removes elements, since
 * either may come after the legends. None where there is no ResizeObserver.
 */
function useCornerObstacles(root: HTMLElement | null, active: boolean): readonly CornerObstacle[] {
  const [obstacles, setObstacles] = useState<readonly CornerObstacle[]>(NO_OBSTACLES);
  useEffect(() => {
    if (!root || !active || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observed = new Set<Element>();
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const map = root.getBoundingClientRect();
      const next: CornerObstacle[] = [];
      root.querySelectorAll(OBSTACLES).forEach((element) => {
        if (!observed.has(element)) {
          observed.add(element);
          resized.observe(element);
        }
        const own = element.getBoundingClientRect();
        if (own.width > 0 && own.height > 0) {
          next.push({
            left: Math.round(own.left - map.left),
            right: Math.round(own.right - map.left),
            rise: Math.round(map.bottom - own.top),
          });
        }
      });
      setObstacles((last) => (JSON.stringify(last) === JSON.stringify(next) ? last : next));
    };
    const later = () => {
      if (frame === null) {
        frame = requestAnimationFrame(measure);
      }
    };
    const resized = new ResizeObserver(later);
    resized.observe(root);
    const added = typeof MutationObserver === 'undefined' ? null : new MutationObserver(later);
    added?.observe(root, { childList: true, subtree: true });
    measure();
    return () => {
      resized.disconnect();
      added?.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [root, active]);
  return active ? obstacles : NO_OBSTACLES;
}

const NO_OBSTACLES: readonly CornerObstacle[] = [];

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
 * each, in the bottom-left corner (`legendPlacement`): titled as `legendTitle`
 * says, folded and unfolded by that title, and gone while the layer is hidden.
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
  const obstacles = useCornerObstacles(root, legends.length > 0);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  if (legends.length === 0) {
    return null;
  }
  const { left, bottom, maxWidth, maxHeight } = legendPlacement({ width, height, sidePanelOpen, obstacles });
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
