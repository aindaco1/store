function structuredKvValue(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function transformKvBackupValuesToPutRecords(values = {}) {
  if (Array.isArray(values)) {
    return values.map((entry) => ({
      key: String(entry?.key || ''),
      value: String(entry?.value ?? ''),
      ...(entry?.metadata ? { metadata: entry.metadata } : {})
    })).filter((entry) => entry.key);
  }
  return Object.entries(values || {}).map(([key, entry]) => ({
    key,
    value: String(structuredKvValue(entry) ? (entry.value ?? '') : (entry ?? '')),
    ...(structuredKvValue(entry) && entry.metadata ? { metadata: entry.metadata } : {})
  }));
}
