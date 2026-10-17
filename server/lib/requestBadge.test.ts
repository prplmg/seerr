import { MediaStatus } from '@server/constants/media';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

function badge(es = false) {
  const compiled = ts.transpileModule(
    readFileSync(
      path.join(__dirname, '../../src/components/StatusBadge/index.tsx'),
      'utf8'
    ),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }
  ).outputText;
  const exports: any = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (name === 'react/jsx-runtime') return jsxRuntime;
    if (name === '@server/constants/media') return { MediaStatus };
    if (name.endsWith('/Common/Badge'))
      return (p: any) =>
        React.createElement('span', { 'data-color': p.badgeType }, p.children);
    if (name.endsWith('/Common/Tooltip')) return (p: any) => p.children;
    if (name.endsWith('/hooks/useSettings'))
      return () => ({ currentSettings: {} });
    if (name.endsWith('/hooks/useUser'))
      return {
        useUser: () => ({ hasPermission: () => false }),
        Permission: {},
      };
    if (name.endsWith('/WatchParty/messages'))
      return {
        usePartyText: () => (en: string, spanish: string) =>
          es ? spanish : en,
      };
    if (name === 'react-intl')
      return {
        useIntl: () => ({
          formatMessage: (msg: string, values: any) => values?.status || msg,
        }),
      };
    if (name.endsWith('/defineMessages'))
      return (_name: string, messages: any) => messages;
    if (name.endsWith('/globalMessages'))
      return {
        available: 'Available',
        partiallyavailable: 'Partially Available',
        processing: 'Processing',
        requested: 'Requested',
      };
    return () => null;
  }, exports);
  return exports.default;
}
it('renders the yellow manual-search label in English and Spanish', () => {
  for (const es of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(badge(es), {
        manualSearch: true,
        status: MediaStatus.PROCESSING,
      })
    );
    assert.match(html, /data-color="warning"/);
    assert.ok(html.includes(es ? 'Búsqueda manual' : 'Manual search'));
  }
});
it('available and partially available statuses supersede the manual-search label', () => {
  for (const status of [
    MediaStatus.AVAILABLE,
    MediaStatus.PARTIALLY_AVAILABLE,
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(badge(), { manualSearch: true, status })
    );
    assert.ok(!html.includes('Manual search'));
    assert.ok(html.includes('Available'));
  }
});
