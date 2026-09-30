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
  /**
   * The base map the panel is actually showing when no `styleType` is saved —
   * e.g. a fresh panel, or `options.basemap: 'auto'` resolved against the
   * dashboard theme. Optional: a caller with no such value (or an older one)
   * still gets a digest, just with `baseMap.id` left undefined as before.
   */
  baseMapId?: string;
}

export function buildAssistantDigest(input: DigestInput): AssistantDigest {
  const styleType = input.mapConfig?.config?.mapStyle?.styleType;
  const baseMapId = styleType ? styleType : input.baseMapId;
  return {
    datasets: (input.series ?? []).map((s, index) => ({
      refId: s.refId ?? String(index),
      name: s.name,
      rowCount: s.length ?? 0,
      fields: (s.fields ?? []).map((f) => ({ name: f.name, type: String(f.type) })),
    })),
    baseMap: { id: baseMapId },
    filters: input.mapConfig?.config?.visState?.filters ?? [],
    bounds: input.bounds,
    timeRange: { from: String(input.timeRange.from), to: String(input.timeRange.to) },
  };
}
