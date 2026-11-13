import React, { useSyncExternalStore } from 'react';
import { useIntl } from 'react-intl';

import { MAX_PICTURES } from './pictureRows';
import {
  readPictureAssignment,
  readPictureOutcomes,
  readPictureVersion,
  subscribePictures,
  summarisePictures,
} from './pictureState';

/**
 * What became of a layer's pictures, under its picture settings: how many
 * could not load and why, and how many were left over past the cap. Shared by
 * the symbol layer's picture and the photos layer's picture column.
 */

/** Failures named one by one; the count says how many more there are. */
const SHOWN_FAILURES = 3;

export const noticeStyle: React.CSSProperties = { fontSize: 11, marginTop: 6, lineHeight: 1.4 };

function shorten(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}…` : url;
}

export function PictureNotices({
  layer,
  hasFallback,
}: {
  /** The kepler layer object itself — the one the map renders — not its id, which another panel may share. */
  layer: object;
  /** Whether a row past the cap draws a picture of the layer's own instead of none. */
  hasFallback: boolean;
}) {
  const intl = useIntl();
  // The version is only what tells React to render again; what is shown is
  // read from the store itself.
  useSyncExternalStore(subscribePictures, readPictureVersion);
  const summary = summarisePictures(readPictureAssignment(layer), readPictureOutcomes());
  const failedCount = summary.failed.length + summary.moreFailed;

  return (
    <>
      {failedCount > 0 ? (
        <div role="status" style={noticeStyle}>
          <div>
            {intl.formatMessage({ id: 'symbol.picture.failed' }, { failed: failedCount, total: summary.total })}
          </div>
          {summary.failed.slice(0, SHOWN_FAILURES).map(({ url, problem }) => (
            <div key={url} title={url}>
              {`${shorten(url)} — ${intl.formatMessage({ id: `symbol.picture.problem.${problem}` })}`}
            </div>
          ))}
        </div>
      ) : null}

      {summary.overflow > 0 ? (
        <div role="status" style={noticeStyle}>
          {intl.formatMessage(
            { id: hasFallback ? 'symbol.picture.overflow' : 'symbol.picture.overflowNotDrawn' },
            { overflow: summary.overflow, max: MAX_PICTURES }
          )}
        </div>
      ) : null}
    </>
  );
}
