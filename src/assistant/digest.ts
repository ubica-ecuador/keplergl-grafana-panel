export interface AssistantDigest {
  datasets: Array<{ refId?: string; name?: string; rowCount: number; fields: Array<{ name: string; type: string }> }>;
  baseMap: { id?: string };
  filters: unknown[];
  bounds?: unknown;
  timeRange: { from: string; to: string };
}

interface DigestInput {
  series: Array<{ refId?: string; name?: string; length?: number; fields: Array<{ name: string; type: string }> }>;
  mapConfig?: { config?: { mapStyle?: { styleType?: string }; visState?: { filters?: unknown[] } } };
  timeRange: { from: unknown; to: unknown };
  bounds?: unknown;
}

export function buildAssistantDigest(input: DigestInput): AssistantDigest {
  return {
    datasets: (input.series ?? []).map((s) => ({
      refId: s.refId,
      name: s.name,
      rowCount: s.length ?? 0,
      fields: (s.fields ?? []).map((f) => ({ name: f.name, type: String(f.type) })),
    })),
    baseMap: { id: input.mapConfig?.config?.mapStyle?.styleType },
    filters: input.mapConfig?.config?.visState?.filters ?? [],
    bounds: input.bounds,
    timeRange: { from: String(input.timeRange.from), to: String(input.timeRange.to) },
  };
}
