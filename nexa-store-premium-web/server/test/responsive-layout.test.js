import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const responsiveCss = readFileSync(new URL('../../assets/brand/nexa-responsive.css', import.meta.url), 'utf8');
const storefrontHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');

test('responsive layout stylesheet is loaded after legacy styles on both pages', () => {
  const storeLink = storefrontHtml.indexOf('nexa-responsive.css?v=20261107-responsive-v1');
  const storePreviousLayer = storefrontHtml.indexOf('nexa-store-polish.css');
  const adminLink = adminHtml.indexOf('nexa-responsive.css?v=20261107-responsive-v1');
  const adminTheme = adminHtml.indexOf('nexa-wamda-blue.css');
  assert.ok(storePreviousLayer >= 0 && storeLink > storePreviousLayer);
  assert.ok(adminTheme >= 0 && adminLink > adminTheme);
});

test('responsive layout includes tablet, mobile and narrow-device breakpoints', () => {
  for (const width of [1024, 860, 760, 560, 420, 360]) {
    assert.ok(responsiveCss.includes('@media (max-width:' + width + 'px)'));
  }
  assert.ok(responsiveCss.includes('@media (max-height:520px)'));
});

test('storefront and admin drawers have direction-aware open and closed states', () => {
  for (const selector of [
    ':root[dir="rtl"] .app-shell .sidebar',
    ':root[dir="ltr"] .app-shell .sidebar',
    'body.sidebar-open .app-shell .sidebar',
    ':root[dir="rtl"] #app.shell .side',
    ':root[dir="ltr"] #app.shell .side',
    'body.admin-sidebar-open #app.shell .side'
  ]) assert.ok(responsiveCss.includes(selector), 'missing drawer rule: ' + selector);
});

test('tables scroll inside their own containers rather than widening the page', () => {
  assert.ok(responsiveCss.includes('.app-shell :is(.data-table-wrap,.table-wrap)'));
  assert.ok(responsiveCss.includes('#app.shell .table-wrap{width:100%;max-width:100%;overflow-x:auto!important'));
  assert.ok(responsiveCss.includes('#app.shell table{min-width:700px}'));
});

test('order dialog and assistant are constrained to the visible viewport', () => {
  assert.ok(responsiveCss.includes('#orderModal .modal{width:min(640px,calc(100vw - 24px))'));
  assert.ok(responsiveCss.includes('#orderModal .modal-body{min-width:0;overflow-y:auto'));
  assert.ok(responsiveCss.includes('.app-shell .assistant-panel{max-width:calc(100vw - 24px);max-height:calc(100dvh - 110px)'));
});

test('stylesheet braces are balanced and narrow viewports remove the old fixed body minimum', () => {
  let depth = 0;
  for (const character of responsiveCss) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    assert.ok(depth >= 0, 'closing brace cannot precede its opening brace');
  }
  assert.equal(depth, 0);
  assert.ok(responsiveCss.includes('body{min-width:0!important}'));
});
