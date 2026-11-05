import { type DataFrame, type Field, FieldType } from '@grafana/data';

/**
 * A frame whose series are told apart by labels, turned into one row per
 * series and instant, with each label as a column.
 *
 * Grafana Live hands a measurement pushed with tags — `bus,id=b07
 * latitude=…,longitude=…` in line protocol, the way Telegraf and most MQTT
 * bridges write — as one wide frame: a time column, then `latitude{id=b07}`,
 * `longitude{id=b07}`, … for every tag set seen. The map reads columns by
 * name, so it found the first vehicle's latitude and longitude and drew that
 * vehicle alone. Long, the frame is what a map wants: `time, id, latitude,
 * longitude`, a row per vehicle per message.
 *
 * Applies only to a frame whose every non-time field carries labels: a plain
 * table, or one with a single labelled value beside unlabelled columns, is
 * returned as it was (null). A row is kept for a series and instant when any
 * of that series' fields has a value there: the wide frame pads every series
 * with nulls at the instants of the others.
 */
export function labelledToLong(frame: DataFrame): DataFrame | null {
  const time = frame.fields.find((field) => field.type === FieldType.time);
  const others = frame.fields.filter((field) => field !== time);
  if (!time || others.length === 0 || others.some((field) => !hasLabels(field))) {
    return null;
  }

  // The series, in the order their first field appears, each with its fields by name.
  const series = new Map<string, { labels: Record<string, string>; fields: Map<string, Field> }>();
  const labelKeys: string[] = [];
  const names: string[] = [];
  for (const field of others) {
    const labels = field.labels as Record<string, string>;
    const key = JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
    let entry = series.get(key);
    if (!entry) {
      entry = { labels, fields: new Map() };
      series.set(key, entry);
    }
    entry.fields.set(field.name, field);
    for (const label of Object.keys(labels)) {
      if (!labelKeys.includes(label)) {
        labelKeys.push(label);
      }
    }
    if (!names.includes(field.name)) {
      names.push(field.name);
    }
  }
  // A label named like a value column would make two columns of one name.
  const labelColumns = labelKeys.filter((label) => !names.includes(label) && label !== time.name);

  const times: unknown[] = [];
  const labelValues = labelColumns.map(() => [] as Array<string | null>);
  const values = names.map(() => [] as unknown[]);
  const length = time.values.length;
  for (const { labels, fields } of series.values()) {
    const columns = names.map((name) => fields.get(name));
    for (let row = 0; row < length; row++) {
      if (!columns.some((field) => field !== undefined && field.values[row] != null)) {
        continue;
      }
      times.push(time.values[row]);
      labelColumns.forEach((label, i) => labelValues[i].push(labels[label] ?? null));
      columns.forEach((field, i) => values[i].push(field?.values[row] ?? null));
    }
  }

  const first = (name: string) => others.find((field) => field.name === name) as Field;
  return {
    ...frame,
    length: times.length,
    fields: [
      { ...time, values: times },
      ...labelColumns.map((label, i) => ({
        name: label,
        type: FieldType.string,
        config: {},
        values: labelValues[i],
      })),
      ...names.map((name, i) => {
        const { labels, ...field } = first(name);
        const { displayNameFromDS, ...config } = field.config;
        return { ...field, config, values: values[i] };
      }),
    ],
  };
}

function hasLabels(field: Field): boolean {
  return Boolean(field.labels) && Object.keys(field.labels as object).length > 0;
}
