import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const responsiveCss = readFileSync(new URL('../../assets/brand/nexa-responsive.css', import.meta.url), 'utf8');
const storefrontHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');

test('responsive layout stylesheet is loaded last on both store and admin pages', () => {
  const storeLink = storefrontHtml.indexOf('nexa-responsive.css?v=20261107-responsive-v1');
  const storePreviousLayer = storefrontHtml.indexOf('nexa-store-polish.css');
  const adminLink = adminHtml.indexOf('nexa-responsive.css?v=20261107-responsive-v1');
  const adminTheme = adminHtml.indexOf('nexa-wamda-blue.css');
  assert.ok(storePreviousLayer >= 0 && storeLink > storePreviousLayer, 'store responsive layer must load after legacy styling');
  assert.ok(adminTheme >= 0 && adminLink > adminTheme, 'admin responsive layer must load after theme styling');
});

test('responsive layout covers desktop, tablet, mobile and narrow-device breakpoints', () => {
  for (const width of [1024, 860, 760, 560, 420, 360]) {
    assert.match(responsiveCss, new RegExp('@media\\s*\\(max-width:\\s*' + width + 'px\\)'));
  }
  assert.match(responsiveCss, /max-height:\\s*520px/);
});

test('storefront and admin drawers have direction-aware off-canvas states', () => {
  assert.match(responsiveCss, /:root\\[dir="rtl"\\] \\.app-shell \\.sidebar/);
  assert.match(responsiveCss, /:root\\[dir="ltr"\\] \\.app-shell \\.sidebar/);
  assert.match(responsiveCss, /body\\.sidebar-open \\.app-shell \\.sidebar/);
  assert.match(responsiveCss, /:root\\[dir="rtl"\\] #app\\.shell \\.side/);
  assert.match(responsiveCss, /:root\\[dir="ltr"\\] #app\\.shell \\.side/);
  assert.match(responsiveCss, /body\\.admin-sidebar-open #app\\.shell \\.side/);
});

test('tables scroll inside their own containers rather than widening the page', () => {
  assert.match(responsiveCss, /\\.app-shell :is\\(\\.data-table-wrap,\\.table-wrap\\)\\{[^}]*overflow-x:auto!important/);
  assert.match(responsiveCss, /#app\\.shell \\.table-wrap\\{[^}]*overflow-x:auto!important/);
  assert.match(responsiveCss, /#app\\.shell table\\{min-width:700px\\}/);
});

test('order dialog and assistant are constrained to the visible viewport', () => {
  assert.match(responsiveCss, /#orderModal \\.modal\\{[^}]*max-height:calc\\(100dvh - 24px\\)/);
  assert.match(responsiveCss, /#orderModal \\.modal-body\\{[^}]*overflow-y:auto/);
  assert.match(responsiveCss, /\\.app-shell \\.assistant-panel\\{[^}]*max-height:calc\\(100dvh - 110px\\)/);
});

test('stylesheet braces are balanced and narrow viewports remove the old fixed body minimum', () => {
  let depth = 0;
  for (const character of responsiveCss) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    assert.ok(depth >= 0, 'closing brace cannot precede its opening brace');
  }
  assert.equal(depth, 0, 'responsive stylesheet must have balanced braces');
  assert.match(responsiveCss, /body\\{min-width:0!important\\}/);
});
