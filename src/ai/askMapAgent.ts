import { ASK_MAP_TOOLS, runTool, type TableView, type ToolContext } from './askMapTools';

/** The slice of `@grafana/llm`'s message the loop uses: injected, so tests need no Grafana. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export type Complete = (request: {
  messages: ChatMessage[];
  tools: typeof ASK_MAP_TOOLS;
}) => Promise<{ choices: Array<{ message: ChatMessage }> }>;

export interface AskStep {
  tool: string;
  args: Record<string, unknown>;
  mapChange?: string;
  error?: string;
}

export interface AskResult {
  answer: string;
  steps: AskStep[];
  /** The conversation so far, system prompt excluded: what a follow-up question continues. */
  history: ChatMessage[];
}

/** Model rounds per question: a describe, a query or two, a filter, a zoom, and the answer. */
export const MAX_ROUNDS = 8;
/** What one tool result may cost in the prompt. */
const MAX_TOOL_RESULT_CHARS = 6000;
/** How many earlier messages a follow-up carries. */
const MAX_HISTORY = 24;

export function systemPrompt(tables: TableView[], filters: string[], map = ''): string {
  const schema = tables
    .map((t) => {
      const fields = t.fields.map((f) => `${f.name} (${f.type})`).join(', ');
      const sample = Math.min(2, t.numRows);
      const rows = Array.from({ length: sample }, (_, r) =>
        JSON.stringify(Object.fromEntries(t.fields.slice(0, 12).map((f, c) => [f.name, clip(t.valueAt(r, c))])))
      ).join('\n  ');
      return `- "${t.label}" (id ${t.id}), ${t.numRows} rows: ${fields}${sample ? `\n  sample:\n  ${rows}` : ''}`;
    })
    .join('\n');
  return [
    'You answer questions about the data on a Grafana map panel (kepler.gl) and can filter and frame that map.',
    'Datasets on the map:',
    schema || '(none)',
    `Filters on the map now: ${filters.length ? filters.join('; ') : 'none'}.`,
    ...(map
      ? [
          'The map as it was when this question was asked (tool results tell you what your calls changed since):',
          map,
        ]
      : []),
    'Rules:',
    '- Every number, name or date you state comes from a tool result in this conversation. Never estimate or recall facts about the data.',
    '- Learn a text column\'s actual values with describe_field before filtering or matching on it.',
    '- When the question asks to see, show, highlight or focus on something, change the map (filter_map, zoom_to); when it only asks a question, answer it and leave the map alone.',
    '- To change how the map looks (heatmap, hexagons, 3D, colours, base map, tilt) use add_layer, update_layer, set_view, set_basemap. A new layer usually covers the existing one: hide the old layer when the new one replaces it, and say so.',
    '- Your layer and view changes last until the dashboard reloads; tell the viewer that an editor saves the map to keep them.',
    '- Carry out each request once, then answer. A relative request ("rotate 30 degrees", "zoom in") is one call computed from the camera above. "Flat", "2D" or "top view" means pitch 0 and bearing 0.',
    '- Describe a layer you made from the encoding its tool result gives (what sets colour, what sets height), not from what you asked for.',
    '- Asked how to show the data, or for a better map: call suggest_visualizations, then apply the best available recipe (or offer the top two). Mention a better recipe that needs Kepler Plus once, as a fact, without pushing it.',
    '- Filters replace the one on the same column; say when you clear filters the viewer did not ask to clear.',
    '- Answer in the language of the question, in at most three short sentences, plain text, no markdown tables. Mention what you changed on the map.',
    '- Conditions carried over from earlier questions narrow later ones. When they leave no rows (or very few), check without them too and give both figures, e.g. "none of magnitude 6 or more, 44 in all".',
    '- The map\'s time filter follows the dashboard time range: every row on the map is already inside it, so do not repeat it in conditions and do not clear it.',
    '- If the data cannot answer the question, say so and say what it holds instead.',
  ].join('\n');
}

/**
 * One question, answered: the model reads the map's rows through the tools,
 * may change the map, and ends with a short answer. `history` carries the
 * earlier questions so a follow-up ("only the ones in Chile") works.
 */
export async function askMap(
  question: string,
  ctx: ToolContext & { filters: string[] | (() => string[]); describeMap?: () => string },
  complete: Complete,
  history: ChatMessage[] = []
): Promise<AskResult> {
  const turn: ChatMessage[] = [...recentHistory(history), { role: 'user', content: question }];
  const steps: AskStep[] = [];
  // One picture of the map per question. Re-read each round, it showed the model its own
  // changes as the starting point: "that layer already exists", a rotation repeated 8 times.
  const prompt = systemPrompt(ctx.tables, typeof ctx.filters === 'function' ? ctx.filters() : ctx.filters, ctx.describeMap?.());

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await complete({
      messages: [{ role: 'system', content: prompt }, ...turn],
      tools: ASK_MAP_TOOLS,
      // No temperature: the LLM app maps "base" to whatever model the admin chose, and newer ones
      // (Claude Sonnet 5) refuse the parameter outright.
    });
    const message = response.choices?.[0]?.message;
    if (!message) {
      throw new Error('The model returned no message.');
    }
    const calls = message.tool_calls ?? [];
    turn.push({ role: 'assistant', content: message.content ?? '', ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length) {
      return { answer: (message.content ?? '').trim(), steps, history: turn };
    }
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      let content: string;
      try {
        args = JSON.parse(call.function.arguments || '{}');
        const outcome = runTool(call.function.name, args, ctx);
        const error = (outcome.result as { error?: string } | null)?.error;
        steps.push({ tool: call.function.name, args, mapChange: outcome.mapChange, error });
        content = JSON.stringify(outcome.result);
      } catch (error) {
        const text = error instanceof SyntaxError ? 'Arguments were not valid JSON.' : String((error as Error)?.message ?? error);
        steps.push({ tool: call.function.name, args, error: text });
        content = JSON.stringify({ error: text });
      }
      turn.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, MAX_TOOL_RESULT_CHARS) });
    }
  }
  return {
    answer: `I stopped after ${MAX_ROUNDS} steps without a final answer.`,
    steps,
    history: turn,
  };
}

/**
 * The last messages of the conversation, cut where a question starts: a cut
 * inside a turn can keep a tool result whose call was dropped, and the
 * provider refuses that ("tool_call_id not found").
 */
export function recentHistory(history: ChatMessage[]): ChatMessage[] {
  let start = Math.max(0, history.length - MAX_HISTORY);
  while (start < history.length && history[start].role !== 'user') {
    start++;
  }
  return history.slice(start);
}

function clip(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 80) {
    return `${value.slice(0, 80)}…`;
  }
  if (value && typeof value === 'object') {
    return '[object]';
  }
  return value;
}
