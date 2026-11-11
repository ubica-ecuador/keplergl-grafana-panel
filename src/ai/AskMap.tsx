import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { config } from '@grafana/runtime';
import { Button, IconButton, Input, Spinner, useTheme2 } from '@grafana/ui';
import type { Store } from 'redux';

import { askMap, type AskStep, type ChatMessage, type Complete } from './askMapAgent';
import type { UndoResult } from './askMapTools';
import { AskMapComposition } from './recipes';
import { describeFilters, describeMap, mapActions, readTables, restoreMap, snapshotMap, type MapSnapshot } from './keplerBridge';

/**
 * `@grafana/llm` in a chunk of its own: it brings the MCP SDK along, and a
 * panel on an instance without the LLM app should not download it at all
 * beyond the check.
 */
const loadLlm = () => import(/* webpackChunkName: "llm" */ '@grafana/llm').then((m) => m.llm);

/**
 * Whether to offer "Ask the map": a signed-in viewer, on an instance whose
 * Grafana LLM app is installed, enabled and configured. Anonymous viewers never
 * see it: every question costs the instance's provider tokens.
 */
function useLlmAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (!config.bootData?.user?.isSignedIn) {
      return;
    }
    let alive = true;
    loadLlm()
      .then((llm) => llm.enabled())
      .then((ok) => alive && setAvailable(Boolean(ok)))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

const complete: Complete = async (request) => {
  const llm = await loadLlm();
  const response = await llm.chatCompletions({
    model: llm.Model.BASE,
    messages: request.messages as never,
    tools: request.tools as never,
  });
  return response as unknown as Awaited<ReturnType<Complete>>;
};

interface Exchange {
  question: string;
  answer?: string;
  steps: AskStep[];
  error?: string;
}

export function AskMap({ store }: { store: Store }): React.ReactElement | null {
  const available = useLlmAvailable();
  const composition = useContext(AskMapComposition);
  const theme = useTheme2();
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const filtered = useRef(false);
  /** The map before each question that changed it, newest last: what Undo walks back through. */
  const snapshots = useRef<MapSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);

  const undo = useCallback((): UndoResult | null => {
    const snapshot = snapshots.current.pop();
    setCanUndo(snapshots.current.length > 0);
    return snapshot ? restoreMap(store, snapshot) : null;
  }, [store]);

  const submit = useCallback(async () => {
    const text = question.trim();
    if (!text || busy) {
      return;
    }
    setBusy(true);
    setExchange({ question: text, steps: [] });
    const before = snapshotMap(store);
    try {
      const result = await askMap(
        text,
        {
          tables: readTables(store),
          actions: mapActions(store, undo),
          recipes: composition.recipes,
          filters: () => describeFilters(store),
          describeMap: () => describeMap(store),
        },
        complete,
        history.current
      );
      history.current = result.history;
      // Kept only when the question changed the map (an undo is not itself undoable).
      if (before && result.steps.some((st) => st.mapChange && !st.error && st.tool !== 'undo')) {
        snapshots.current.push(before);
        snapshots.current = snapshots.current.slice(-20);
        setCanUndo(true);
      }
      filtered.current ||= result.steps.some((s) => s.tool === 'filter_map' && !s.error);
      setExchange({ question: text, answer: result.answer, steps: result.steps });
      setQuestion('');
    } catch (error) {
      setExchange({ question: text, steps: [], error: errorText(error) });
    } finally {
      setBusy(false);
    }
  }, [question, busy, store, undo, composition]);

  const reset = () => {
    history.current = [];
    snapshots.current = [];
    setCanUndo(false);
    setExchange(null);
    if (filtered.current) {
      mapActions(store).clearAllFilters();
      filtered.current = false;
    }
  };

  if (!available) {
    return null;
  }

  const shell: React.CSSProperties = {
    // Top centre: kepler keeps its time widget and charts along the bottom.
    position: 'absolute',
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 100,
    width: open ? 'min(560px, calc(100% - 16px))' : undefined,
    // The answer card comes first in the markup and shows under the question box.
    display: 'flex',
    flexDirection: 'column-reverse',
  };

  if (!open) {
    return (
      <div style={shell}>
        <Button size="sm" variant="secondary" icon="ai-sparkle" onClick={() => setOpen(true)} aria-label="Ask the map">
          Ask the map
        </Button>
      </div>
    );
  }

  const changes = exchange?.steps.filter((s) => s.mapChange && !s.error) ?? [];
  return (
    <div style={shell} data-testid="ask-map">
      {exchange && (
        <div
          style={{
            background: theme.colors.background.primary,
            border: `1px solid ${theme.colors.border.medium}`,
            borderRadius: theme.shape.radius.default,
            boxShadow: theme.shadows.z2,
            padding: theme.spacing(1, 1.5),
            marginTop: theme.spacing(0.5),
            maxHeight: 240,
            overflowY: 'auto',
            fontSize: theme.typography.bodySmall.fontSize,
          }}
        >
          <div style={{ color: theme.colors.text.secondary, marginBottom: 4 }}>{exchange.question}</div>
          {busy && (
            <div>
              <Spinner inline /> Reading the map…
            </div>
          )}
          {exchange.answer && (
            <div data-testid="ask-map-answer" style={{ whiteSpace: 'pre-wrap' }}>
              {exchange.answer}
            </div>
          )}
          {exchange.error && (
            <div data-testid="ask-map-error" style={{ color: theme.colors.error.text }}>
              Error: {exchange.error}
            </div>
          )}
          {changes.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
              {changes.map((s, i) => (
                <span
                  key={i}
                  style={{
                    background: theme.colors.background.secondary,
                    borderRadius: theme.shape.radius.pill,
                    padding: '1px 8px',
                    color: theme.colors.text.secondary,
                  }}
                >
                  {s.mapChange}
                </span>
              ))}
            </div>
          )}
          {!busy && exchange.steps.length > 0 && (
            <details style={{ marginTop: 6, color: theme.colors.text.secondary }}>
              <summary style={{ cursor: 'pointer' }}>
                {exchange.steps.length} {exchange.steps.length === 1 ? 'step' : 'steps'}
              </summary>
              <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {exchange.steps.map((s, i) => (
                  <li key={i}>
                    <code>{s.tool}</code> {JSON.stringify(s.args)}
                    {s.error ? ` — ${s.error}` : ''}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
      <form
        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          autoFocus
          value={question}
          disabled={busy}
          placeholder="Ask about this map: “strongest quakes this week”, “show only Chile”…"
          onChange={(e) => setQuestion(e.currentTarget.value)}
          // Keeps Grafana's dashboard shortcuts (e, v, d…) out of the text box.
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Question about the map"
        />
        <Button type="submit" size="md" icon="arrow-right" disabled={busy || !question.trim()} aria-label="Ask" />
        <IconButton name="history-alt" tooltip="Undo the last change to the map" onClick={() => undo()} disabled={!canUndo || busy} />
        <IconButton name="plus" tooltip="New conversation (clears its filters)" onClick={reset} />
        <IconButton name="times" tooltip="Close" onClick={() => setOpen(false)} />
      </form>
    </div>
  );
}

/** Grafana's fetch rejects with `{ status, data: { message } }`, not an Error. */
function errorText(error: unknown): string {
  const e = error as { data?: { message?: string; error?: string }; message?: string; statusText?: string; status?: number } | null;
  const text = e?.data?.message || e?.data?.error || e?.message || e?.statusText;
  if (text) {
    return e?.status ? `${text} (${e.status})` : text;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
