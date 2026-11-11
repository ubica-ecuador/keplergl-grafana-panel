import { askMap, MAX_ROUNDS, recentHistory, systemPrompt, type ChatMessage, type Complete } from './askMapAgent';
import type { MapActions, TableView } from './askMapTools';

const tables: TableView[] = [
  {
    id: 'A',
    label: 'quakes',
    fields: [
      { name: 'mag', type: 'real' },
      { name: 'place', type: 'string' },
    ],
    numRows: 3,
    valueAt: (r, c) => [[6.1, 'Chile'], [4.6, 'Peru'], [7, 'Chile']][r][c],
    points: [],
  },
];

const actions: MapActions = {
  filterRange: () => true,
  filterValues: () => true,
  clearFilter: () => undefined,
  clearAllFilters: () => [],
  fitBounds: () => undefined,
  addLayer: () => ({ id: 'x' }),
  updateLayer: () => ({ id: 'x', type: 'point' }),
  removeLayer: () => ({ id: 'x' }),
  setView: () => undefined,
  pitch: () => 0,
  setBasemap: () => true,
  flyTo: () => undefined,
  fadeByZoom: () => ({ id: 'x' }),
  filterArea: () => true,
  clearAreas: () => 0,
  drawnAreas: () => [],
  setTimeRange: () => undefined,
  undo: () => null,
  addLayerConfig: () => ({ id: 'x' }),
  visibleLayersOf: () => [],
};

const call = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});

/** A model that plays the given replies in order and records what it was sent. */
function scripted(replies: ChatMessage[]): Complete & { sent: ChatMessage[][] } {
  const sent: ChatMessage[][] = [];
  const fn = (async ({ messages }) => {
    sent.push(messages.map((m) => ({ ...m })));
    const message = replies.shift();
    if (!message) {
      throw new Error('no more replies');
    }
    return { choices: [{ message }] };
  }) as Complete & { sent: ChatMessage[][] };
  fn.sent = sent;
  return fn;
}

describe('askMap', () => {
  it('runs the tools the model asks for and returns its answer with the map changes', async () => {
    const model = scripted([
      { role: 'assistant', content: '', tool_calls: [call('1', 'query_rows', { aggregate: { op: 'max', field: 'mag' } })] },
      { role: 'assistant', content: '', tool_calls: [call('2', 'filter_map', { field: 'mag', min: 6 })] },
      { role: 'assistant', content: 'The strongest is 7. The map now shows magnitude 6 and above.' },
    ]);
    const result = await askMap('strongest?', { tables, actions, filters: [] }, model);

    expect(result.answer).toBe('The strongest is 7. The map now shows magnitude 6 and above.');
    expect(result.steps.map((s) => s.tool)).toEqual(['query_rows', 'filter_map']);
    expect(result.steps[1].mapChange).toBe('Filtered mag 6 – 7');
    // The second request carries the first tool's result.
    const toolMessage = model.sent[1].find((m) => m.role === 'tool');
    expect(JSON.parse(toolMessage!.content!)).toMatchObject({ matched: 3, max: 7 });
  });

  it('hands bad arguments back to the model as an error instead of throwing', async () => {
    const model = scripted([
      { role: 'assistant', content: '', tool_calls: [{ id: '1', type: 'function', function: { name: 'query_rows', arguments: '{oops' } }] },
      { role: 'assistant', content: 'Sorry.' },
    ]);
    const result = await askMap('q', { tables, actions, filters: [] }, model);
    expect(result.steps[0].error).toBe('Arguments were not valid JSON.');
    expect(result.answer).toBe('Sorry.');
  });

  it('continues a conversation from its history', async () => {
    const first = await askMap('a', { tables, actions, filters: [] }, scripted([{ role: 'assistant', content: 'one' }]));
    const model = scripted([{ role: 'assistant', content: 'two' }]);
    await askMap('b', { tables, actions, filters: [] }, model, first.history);
    expect(model.sent[0].map((m) => m.content)).toEqual([expect.any(String), 'a', 'one', 'b']);
  });

  it('cuts long history only where a question starts', () => {
    const turnOf = (i: number): ChatMessage[] => [
      { role: 'user', content: `q${i}` },
      { role: 'assistant', content: '', tool_calls: [call(`c${i}`, 'describe_field', { field: 'mag' })] },
      { role: 'tool', tool_call_id: `c${i}`, content: '{}' },
      { role: 'assistant', content: `a${i}` },
    ];
    const history = Array.from({ length: 10 }, (_, i) => turnOf(i)).flat();
    const kept = recentHistory(history);
    expect(kept[0]).toEqual({ role: 'user', content: 'q4' });
    expect(kept.length).toBeLessThanOrEqual(24);
  });

  it('gives up after a bounded number of rounds', async () => {
    const loop = Array.from({ length: MAX_ROUNDS }, (_, i) => ({
      role: 'assistant' as const,
      content: '',
      tool_calls: [call(String(i), 'describe_field', { field: 'mag' })],
    }));
    const result = await askMap('q', { tables, actions, filters: [] }, scripted(loop));
    expect(result.steps).toHaveLength(MAX_ROUNDS);
    expect(result.answer).toMatch(/stopped after/);
  });

  it('puts the schema, a sample and the current filters in the system prompt', () => {
    const prompt = systemPrompt(tables, ['mag = [5,9]']);
    expect(prompt).toContain('"quakes" (id A), 3 rows: mag (real), place (string)');
    expect(prompt).toContain('{"mag":6.1,"place":"Chile"}');
    expect(prompt).toContain('Filters on the map now: mag = [5,9].');
  });
});
