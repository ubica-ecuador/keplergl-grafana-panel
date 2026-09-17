import React, { useRef, useState, useSyncExternalStore } from 'react';
import { useIntl } from 'react-intl';
import { Button, Input, PanelLabel, SidePanelSection } from '@kepler.gl/components';

import { MAX_PICTURES } from './pictureRows';
import { readPictureStatus, subscribePictureStatus, summarisePictureStatus } from './pictureState';

/**
 * Where a symbol layer's picture comes from, and what became of its pictures.
 *
 * The URL is written when the field is left, not on every keystroke: each
 * write clones the panel's options and renders the layer again, which would
 * try to load every half-typed URL on the way.
 */

/**
 * The longest data URI an upload may write, about 75 KB of file. It lives in
 * the dashboard's JSON, which Grafana clones and compares on every change to
 * the panel's options.
 */
export const MAX_UPLOAD_CHARS = 100_000;

export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'image/gif'];

/** Failures named one by one; the count says how many more there are. */
const SHOWN_FAILURES = 3;

function shorten(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}…` : url;
}

/** The size of the file behind a base64 data URI, in KB. */
function uploadedKb(dataUri: string): number {
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
  return Math.ceil((base64.length * 3) / 4 / 1024);
}

const noticeStyle: React.CSSProperties = { fontSize: 11, marginTop: 6, lineHeight: 1.4 };

export function PictureSourceInput({
  layerId,
  value,
  onChange,
}: {
  layerId: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const intl = useIntl();
  const [draft, setDraft] = useState(value);
  const [uploadProblem, setUploadProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const status = useSyncExternalStore(subscribePictureStatus, () => readPictureStatus(layerId));
  const summary = summarisePictureStatus(status);
  const uploaded = value.startsWith('data:');

  // What is saved wins over what was being typed when it changes from outside:
  // an upload, a cleared picture, a dashboard reloaded. Adjusted during render
  // rather than in an effect, so it lands before this render is painted
  // instead of one render behind (react.dev/learn/you-might-not-need-an-effect
  // — "Adjusting state when a prop changes"). A ref cannot stand in for
  // `committedValue` here: the lint rules for React's compiler forbid reading
  // or writing a ref during render, only `useState` is allowed.
  const [committedValue, setCommittedValue] = useState(value);
  if (committedValue !== value) {
    setCommittedValue(value);
    setDraft(value);
  }

  const commit = () => {
    const next = draft.trim();
    if (next !== value) {
      onChange(next);
    }
  };

  const upload = (file: File | undefined) => {
    if (!file) {
      return;
    }
    if (!UPLOAD_TYPES.includes(file.type)) {
      setUploadProblem('symbol.picture.notImage');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = typeof reader.result === 'string' ? reader.result : '';
      if (dataUri.length > MAX_UPLOAD_CHARS) {
        setUploadProblem('symbol.picture.tooLarge');
        return;
      }
      setUploadProblem(null);
      onChange(dataUri);
    };
    reader.readAsDataURL(file);
  };

  return (
    <SidePanelSection>
      <PanelLabel>{intl.formatMessage({ id: 'symbol.pictureUrl' })}</PanelLabel>
      {uploaded ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{intl.formatMessage({ id: 'symbol.picture.uploaded' }, { kb: uploadedKb(value) })}</span>
          <Button secondary small onClick={() => onChange('')}>
            {intl.formatMessage({ id: 'symbol.picture.useUrl' })}
          </Button>
        </div>
      ) : (
        <Input
          type="text"
          value={draft}
          placeholder="https://…"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              commit();
            }
          }}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <Button secondary small onClick={() => picker.current?.click()}>
          {intl.formatMessage({ id: 'symbol.picture.upload' })}
        </Button>
        <input
          ref={picker}
          type="file"
          accept={UPLOAD_TYPES.join(',')}
          hidden
          onChange={(event) => {
            upload(event.target.files?.[0]);
            // Cleared, so choosing the same file again still reads it.
            event.target.value = '';
          }}
        />
        {value ? (
          // Anonymous, as the map loads it, so a picture without CORS fails
          // here too instead of looking fine beside a map that cannot draw it.
          <img src={value} crossOrigin="anonymous" alt="" width={32} height={32} style={{ objectFit: 'contain' }} />
        ) : null}
      </div>

      {uploadProblem ? (
        <div role="alert" style={noticeStyle}>
          {intl.formatMessage({ id: uploadProblem })}
        </div>
      ) : null}

      {summary.failed.length > 0 ? (
        <div role="status" style={noticeStyle}>
          <div>
            {intl.formatMessage(
              { id: 'symbol.picture.failed' },
              { failed: summary.failed.length, total: summary.total }
            )}
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
          {intl.formatMessage({ id: 'symbol.picture.overflow' }, { overflow: summary.overflow, max: MAX_PICTURES })}
        </div>
      ) : null}
    </SidePanelSection>
  );
}
