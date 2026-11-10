const credentialNames = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'authpass',
  'authorization',
  'credential',
];
export const credentialSelector = [
  '[data-analytics-credential]',
  'input[type="password"]',
  'input[type="hidden"]',
  ...credentialNames.flatMap((name) => [
    `[name*="${name}" i]`,
    `[id*="${name}" i]`,
  ]),
].join(',');
export function maskCredentialInput(
  text: string,
  element?: HTMLElement | null
) {
  return !element ||
    element.matches(credentialSelector) ||
    element.closest('[data-analytics-credential]')
    ? '*'.repeat(text.length)
    : text;
}
export function capturePath(url: string) {
  const path = url.split(/[?#]/)[0];
  if (/^\/(login|setup|resetpassword)(\/|$)/.test(path)) return null;
  return path;
}
export function redactCredentialUrl(value: string) {
  const url = new URL(value, window.location.origin);
  for (const key of [...url.searchParams.keys()]) {
    if (
      /password|passwd|secret|token|api.?key|authorization|credential|^code$|^auth$/i.test(
        key
      )
    )
      url.searchParams.set(key, '[REDACTED]');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  if (url.pathname.startsWith('/share/lists/'))
    url.pathname = '/share/lists/[REDACTED]';
  return url.toString();
}
