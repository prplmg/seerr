import { summarizeWorkerHealth } from '../../../server/lib/letterboxdSyncHealth';
/* eslint-disable @typescript-eslint/no-explicit-any -- Inspect transpiled React element trees without mounting a browser. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';

const loadModule = createRequire(__filename);

const code = ts.transpileModule(
  readFileSync(path.join(__dirname, 'LetterboxdBrowserStatus.tsx'), 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2021,
    },
  }
).outputText;
function harness(
  overrides: Record<string, unknown> = {},
  locale = 'en',
  configured = true
) {
  const row = {
    userId: 1,
    username: 'prplmg',
    instance: 'browser',
    enabled: true,
    writeEnabled: false,
    writePilotEligible: true,
    lastSuccess: 1000,
    ...overrides,
  };
  const calls: unknown[] = [];
  const messages: unknown[] = [];
  let mutations = 0;
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => {
    if (name === 'axios')
      return {
        default: {
          put: async (...args: unknown[]) => {
            calls.push(args);
          },
        },
      };
    if (name === 'react')
      return {
        useState: (value: unknown) => [
          value,
          (next: unknown) => messages.push(next),
        ],
      };
    if (name === 'react-intl') return { useIntl: () => ({ locale }) };
    if (name === 'swr')
      return {
        default: () => ({
          data: { configured, bindings: [row] },
          mutate: async () => {
            mutations++;
          },
        }),
      };
    return loadModule(name);
  }, exports);
  const tree = exports.default({ userId: row.userId });
  const nodes: any[] = [];
  const visit = (node: any) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    visit(node.props?.children);
  };
  visit(tree);
  const text = (node: any): string =>
    Array.isArray(node)
      ? node.map(text).join(' ')
      : node && typeof node === 'object'
        ? text(node.props?.children)
        : typeof node === 'string'
          ? node
          : '';
  return {
    calls,
    messages,
    mutations: () => mutations,
    checkbox: nodes.find(
      (n) => n.type === 'input' && n.props.type === 'checkbox'
    ),
    alerts: nodes.filter((n) => n.props?.role === 'alert'),
    counts: nodes.filter((n) => n.type === 'dd').map((n) => n.props.children),
    text: text(tree),
  };
}

it('publishing is opt-in and sends only the supported per-user setting', async () => {
  const h = harness();
  assert.equal(h.checkbox.props.checked, false);
  assert.equal(h.checkbox.props.disabled, false);
  assert.deepEqual(h.calls, []);
  await h.checkbox.props.onChange();
  assert.deepEqual(h.calls, [
    [
      '/api/v1/settings/letterboxd-browser/writes',
      { userId: 1, enabled: true },
    ],
  ]);
  assert.equal(h.mutations(), 1);
  assert.ok(h.messages.includes('Publishing enabled for this account.'));
});

it('shows all queue counts without adding write or resolution actions', () => {
  const h = harness({
    writeQueue: {
      queued: 2,
      dispatched: 1,
      verified: 8,
      conflict: 0,
      unknown: 0,
    },
  });
  assert.deepEqual(h.counts, [2, 1, 8, 0, 0]);
  assert.equal(h.alerts.length, 0);
  assert.deepEqual(h.calls, []);
  assert.match(h.text, /not just the latest run/);
  assert.match(harness().text, /Queue status unavailable/);
});

it('warns about conflicts and uncertain outcomes in both languages', () => {
  for (const field of ['conflict', 'unknown']) {
    for (const locale of ['en', 'es-MX']) {
      const h = harness(
        {
          writeQueue: {
            queued: 0,
            dispatched: 0,
            verified: 0,
            conflict: 0,
            unknown: 0,
            [field]: 1,
          },
        },
        locale
      );
      assert.equal(h.alerts.length, 1);
      assert.match(
        h.text,
        locale === 'en'
          ? /do not blindly publish it again/
          : /no lo vuelvas a publicar a ciegas/
      );
      assert.deepEqual(h.calls, []);
    }
  }
});

it('GET summarizes only the bound user and account without leaking write payloads', async () => {
  const source = readFileSync(
    path.resolve(
      __dirname,
      '../../../server/routes/settings/letterboxdBrowser.ts'
    ),
    'utf8'
  );
  const routeCode = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText;
  let get: any;
  const router = {
    use() {},
    get(_path: string, handler: any) {
      get = handler;
    },
    put() {},
    post() {},
  };
  const intents = [
    'queued',
    'dispatched',
    'verified',
    'conflict',
    'unknown',
    'cancelled',
  ].map((state) => ({
    userId: 1,
    account: 'prplmg',
    state,
    desired: { text: 'PRIVATE REVIEW' },
    token: 'SECRET',
  }));
  const exports = {};
  new Function('require', 'exports', routeCode)((name: string) => {
    if (name === '@server/lib/letterboxdSyncHealth')
      return { summarizeWorkerHealth };
    if (name === 'express') return { Router: () => router };
    if (name === '@server/middleware/auth')
      return { isAuthenticated: () => () => {} };
    if (name === '@server/lib/permissions') return { Permission: { ADMIN: 1 } };
    if (name === '@server/datasource')
      return { getRepository: () => ({ find: async () => [] }) };
    if (name === '@server/lib/letterboxdBrowser')
      return {
        readBrowserState: () => ({
          tokenHash: 'SECRET',
          bindings: [
            {
              userId: 1,
              username: 'prplmg',
              snapshot: { items: ['PRIVATE SNAPSHOT'] },
            },
          ],
        }),
      };
    if (name === '@server/lib/letterboxdWriteQueue')
      return {
        readWriteState: () => ({
          settings: {},
          intents: [
            ...intents,
            { userId: 7, account: 'prplmg', state: 'queued' },
            { userId: 1, account: 'old-account', state: 'unknown' },
          ],
        }),
      };
    return {};
  }, exports);
  let result: any;
  await get(
    {},
    {
      json(value: unknown) {
        result = value;
      },
      sendStatus() {
        assert.fail('GET failed');
      },
    }
  );
  assert.deepEqual(result.bindings[0].writeQueue, {
    queued: 1,
    dispatched: 1,
    verified: 1,
    conflict: 1,
    unknown: 1,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /PRIVATE|SECRET|desired|tokenHash/
  );
});

it('restricts enabling to healthy eligible mappings, including handler guards', async () => {
  for (const overrides of [
    { writePilotEligible: false },
    { enabled: false },
    { lastSuccess: undefined },
    { issue: 'cloudflare' },
  ]) {
    const h = harness(overrides);
    assert.equal(h.checkbox.props.disabled, true);
    await h.checkbox.props.onChange();
    assert.deepEqual(h.calls, []);
  }
  assert.equal(harness({}, 'en', false).checkbox.props.disabled, true);
});

it('allows disabling publishing even while a browser is unavailable', async () => {
  const h = harness(
    {
      writeEnabled: true,
      enabled: false,
      issue: 'offline',
      writePilotEligible: false,
    },
    'en',
    false
  );
  assert.equal(h.checkbox.props.disabled, false);
  await h.checkbox.props.onChange();
  assert.deepEqual(h.calls, [
    [
      '/api/v1/settings/letterboxd-browser/writes',
      { userId: 1, enabled: false },
    ],
  ]);
});

it('explains inbound-only watchlists and per-account publishing in English and Spanish', () => {
  const en = harness().text;
  assert.match(en, /watchlist is inbound only/);
  assert.match(en, /bookmark remains connected to Plex/);
  assert.match(
    en,
    /Does not publish existing history or enable other accounts/
  );
  assert.doesNotMatch(
    en,
    /awaits write-worker activation|Does not publish or delete/
  );
  for (const locale of ['es', 'es-MX']) {
    const es = harness({}, locale).text;
    assert.match(es, /lista de Letterboxd es de solo lectura/);
    assert.match(es, /marcador del catálogo sigue conectado a Plex/);
    assert.match(
      es,
      /No publica el historial existente ni activa otras cuentas/
    );
  }
});

it('shows runtime pauses despite enabled publishing, and missing reports stay unknown', () => {
  const paused = harness({
    writeEnabled: true,
    syncHealth: {
      runtime: 'paused',
      pauseReason: 'read-check',
      unsupportedQueued: 1,
      oldestQueuedAt: 1000,
      recentErrors: [
        { stage: 'lists', at: 1000, type: 'HTTPError', httpStatus: 409 },
      ],
    },
  });
  assert.match(paused.text, /publishing paused/);
  assert.match(paused.text, /read-only check failed/);
  assert.match(paused.text, /not supported/);
  assert.match(paused.text, /HTTP 409/);
  assert.equal(paused.calls.length, 0);
  assert.match(
    harness({ writeEnabled: true }).text,
    /fresh runtime status unavailable/
  );
});
