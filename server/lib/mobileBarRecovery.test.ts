import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import ts from 'typescript';
/* eslint-disable @typescript-eslint/no-explicit-any */
const api: any = {};
new Function(
  'exports',
  ts.transpileModule(
    fs.readFileSync(
      path.join(__dirname, '../../src/utils/mobileBarRecovery.ts'),
      'utf8'
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }
  ).outputText
)(api);
function harness(ios = true, geometry = false) {
  const events = new Map<string, (event: any) => void>();
  let timer: (() => void) | undefined,
    recovered = 0;
  const target = {
    addEventListener: (name: string, fn: any) => events.set(name, fn),
    removeEventListener: (name: string) => events.delete(name),
  };
  const viewport = { ...target, height: 800, scale: 1, offsetTop: 0 };
  const win = {
    ...target,
    navigator: {
      userAgent: ios ? 'iPhone' : 'Android',
      platform: '',
      maxTouchPoints: 1,
    },
    visualViewport: viewport,
    setTimeout: (fn: () => void) => {
      timer = fn;
      return 1;
    },
    clearTimeout: () => {
      timer = undefined;
    },
  };
  const rect = { bottom: 800, width: 390, height: 90 };
  const cleanup = api.installMobileBarRecovery(
    () => recovered++,
    win,
    target,
    () => (geometry ? { getBoundingClientRect: () => rect } : null)
  );
  const editor = { matches: () => true };
  return {
    viewport,
    rect,
    doc: target as any,
    scroll: () => events.get('scroll')?.({}),
    events,
    cleanup,
    count: () => recovered,
    focus: () => events.get('focusin')?.({ target: editor }),
    blur: () =>
      events.get('focusout')?.({ target: editor, relatedTarget: null }),
    resize: () => events.get('resize')?.({}),
    settle: () => {
      const next = timer;
      timer = undefined;
      next?.();
    },
  };
}
it('iOS recovery waits for the keyboard to close, repaints once and never polls', () => {
  const h = harness();
  h.focus();
  h.viewport.height = 450;
  h.resize();
  h.settle();
  assert.equal(h.count(), 0);
  h.blur();
  h.settle();
  assert.equal(h.count(), 0);
  h.viewport.height = 800;
  h.resize();
  h.settle();
  assert.equal(h.count(), 1);
  h.resize();
  h.settle();
  assert.equal(h.count(), 1);
});
it('native picker dismissal recovers without requiring a resize; cleanup cancels pending work', () => {
  const h = harness();
  h.focus();
  h.blur();
  h.settle();
  assert.equal(h.count(), 1);
  h.focus();
  h.blur();
  h.cleanup();
  h.settle();
  assert.equal(h.count(), 1);
  assert.equal(h.events.size, 0);
});
it('ordinary resize, non-iOS and zoom do not trigger recovery', () => {
  const h = harness();
  h.resize();
  h.settle();
  assert.equal(h.count(), 0);
  h.focus();
  h.viewport.scale = 2;
  h.blur();
  h.settle();
  assert.equal(h.count(), 0);
  const other = harness(false);
  other.focus();
  other.blur();
  other.settle();
  assert.equal(other.count(), 0);
  assert.equal(other.events.size, 0);
});

it('scroll drift recovers in either direction, is bounded and resets only after alignment', () => {
  const h = harness(true, true);
  h.scroll();
  h.settle();
  assert.equal(h.count(), 0);
  h.rect.bottom = 500;
  h.scroll();
  h.settle();
  assert.equal(h.count(), 1);
  h.scroll();
  h.settle();
  assert.equal(h.count(), 2);
  h.scroll();
  h.settle();
  assert.equal(h.count(), 2);
  h.rect.bottom = 800;
  h.scroll();
  h.settle();
  h.rect.bottom = 900;
  h.scroll();
  h.settle();
  assert.equal(h.count(), 3);
});
it('visual viewport offset is included; keyboard focus, zoom and hidden bars are untouched', () => {
  const h = harness(true, true);
  h.viewport.offsetTop = 40;
  h.rect.bottom = 840;
  h.scroll();
  h.settle();
  assert.equal(h.count(), 0);
  h.rect.bottom = 500;
  h.doc.activeElement = { matches: () => true };
  h.scroll();
  h.settle();
  assert.equal(h.count(), 0);
  h.doc.activeElement = null;
  h.viewport.scale = 2;
  h.scroll();
  h.settle();
  assert.equal(h.count(), 0);
  h.viewport.scale = 1;
  h.rect.width = 0;
  h.scroll();
  h.settle();
  assert.equal(h.count(), 0);
  h.rect.width = 390;
  h.scroll();
  h.cleanup();
  h.settle();
  assert.equal(h.count(), 0);
});
