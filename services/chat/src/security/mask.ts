/** Return-value redaction only. Storage encryption remains a deployment concern. */
export function maskSecret(value?: string | null): string {
  if (!value) return "";
  return value.length <= 8 ? "***" : `${value.slice(0, 4)}***${value.slice(-4)}`;
}

export function maskApiKey<T extends { apiKey?: string | null }>(record: T): T {
  return { ...record, apiKey: maskSecret(record.apiKey) };
}
