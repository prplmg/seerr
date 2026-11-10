export function trackEvent(
  name: string,
  properties: Record<string, unknown> = {}
) {
  window.dispatchEvent(
    new CustomEvent('catalogue-analytics', { detail: { name, properties } })
  );
}
export function safeSettings(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeSettings);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/password|passwd|secret|token|api.?key|credential|authorization|private.?key/i.test(
            key
          )
      )
      .map(([key, val]) => [key, safeSettings(val)])
  );
}
