import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const responsiveCss = readFileSync(new URL('../../assets/brand/nexa-responsive.css', import.meta.url), 'utf8');
const storefrontHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');

test('responsive layout stylesheet is loaded after legacy styles on both pages', () => {
  const storeLink = storefrontHtml.indexOf('nexa-responsive.css?v=20261107-drawer-single-rail-v6');
  const storePreviousLayer = storefrontHtml.indexOf('nexa-store-polish.css');
  const adminLink = adminHtml.indexOf('nexa-responsive.css?v=20261107-layout-final-v5');
  const adminTheme = adminHtml.indexOf('nexa-wamda-blue.css');
  assert.ok(storePreviousLayer >= 0 && storeLink > storePreviousLayer);
  assert.ok(adminTheme >= 0 && adminLink > adminTheme);
  const finalAdminStyle = adminHtml.lastIndexOf('</style>', adminHtml.indexOf('</head>'));
  assert.ok(finalAdminStyle >= 0 && adminLink > finalAdminStyle, 'admin responsive CSS must load after every inline style block');
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

test('final responsive layer sizes the desktop rail and content by available width', () => {
  assert.ok(responsiveCss.includes('--rail-width:clamp(250px,20vw,320px)'));
  assert.ok(responsiveCss.includes('container-name:nexa-stage'));
  assert.ok(responsiveCss.includes('@container nexa-stage (max-width:820px)'));
  assert.ok(responsiveCss.includes('width:100%!important;max-width:var(--nexa-content-max)'));
  assert.ok(!responsiveCss.includes('calc(100% - 2 * var(--nexa-layout-gutter))'));
});

test('light mode retains the Nexa sky-blue storefront header', () => {
  assert.ok(responsiveCss.includes(':root[data-theme="light"] body .app-shell .header'));
  assert.ok(responsiveCss.includes('background:#62c8f2!important'));
  assert.ok(responsiveCss.includes('color:#06334b!important'));
});

test('dark and light modes define complete storefront and admin surface contracts', () => {
  for (const token of [
    ':root[data-theme="dark"]',
    ':root[data-theme="light"]',
    '--surface:#121b23',
    '--surface:#fff',
    '--drawer-bg:#101a22',
    '.app-shell .sidebar',
    '#app.shell .side',
    '#orderModal .modal'
  ]) assert.ok(responsiveCss.includes(token), 'missing theme token or selector: ' + token);
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


test('storefront drawer reserves sidebar width once and keeps the page and top bar full-width', () => {
  const mainMarkup = storefrontHtml.match(/<main\s+id="appMain"[^>]*>/)?.[0] || '';
  assert.ok(mainMarkup, 'The storefront main element is #appMain');
  assert.ok(responsiveCss.includes('.app-shell #appMain,'), 'The actual storefront main element receives responsive sizing');
  assert.ok(responsiveCss.includes('container-name:nexa-stage'), 'The main content is the responsive container');
  assert.ok(responsiveCss.includes('container-type:inline-size!important'), 'Container breakpoints have a real container');
  assert.ok(responsiveCss.includes('/* DRAWER SINGLE-RAIL CONTRACT v6'), 'The final drawer contract is loaded after legacy spacing rules');
  assert.ok(responsiveCss.includes(':root[dir="rtl"] .app-shell > .app-main{'), 'RTL rail spacing is applied to the outer content shell');
  assert.ok(responsiveCss.includes(':root[dir="ltr"] .app-shell > .app-main{'), 'LTR rail spacing is applied to the outer content shell');
  assert.ok(responsiveCss.includes(':root[dir="rtl"] .app-shell > .app-main > #appMain,:root[dir="ltr"] .app-shell > .app-main > #appMain{'), 'The inner page never reserves the sidebar a second time');
  assert.ok(responsiveCss.includes('body.sidebar-closed .app-shell > .app-main'), 'The outer shell expands when the desktop drawer closes');
  assert.ok(responsiveCss.includes('.app-shell > .app-main > .header > .wrap.header-main{width:100%!important;max-width:none!important;min-width:0!important;margin:0!important;box-sizing:border-box!important;}'), 'The top bar inner row fills the available shell width');
});

test('mobile drawer lock and header layout stay stable during drawer transitions', () => {
  assert.ok(responsiveCss.includes('html.store-drawer-scroll-locked body{'), 'Mobile scroll lock fixes the page at its previous scroll position');
  assert.ok(responsiveCss.includes('top:var(--store-drawer-scroll-top,0px)!important'), 'Scroll position is restored without a header jump');
  assert.ok(responsiveCss.includes('.app-shell .app-main > .header{'), 'The storefront top bar follows its actual app-main parent');
  assert.ok(responsiveCss.includes('.app-shell .app-main > .header{width:100%!important;max-width:100%!important;margin:0!important}'), 'The top bar inherits the full width of the rail-sized parent and expands when it closes');
  assert.ok(responsiveCss.includes('.app-shell .header-actions{display:flex!important'), 'Header actions do not wrap into each other on phones');
});

test('narrow storefront cards use readable wrapping and mobile columns', () => {
  assert.ok(responsiveCss.includes('overflow-wrap:break-word!important;word-break:normal!important'), 'UI labels do not break at arbitrary character boundaries');
  assert.ok(responsiveCss.includes('@media(max-width:420px)'), 'Small phones use a dedicated layout breakpoint');
  assert.ok(responsiveCss.includes('.app-shell .featured-grid,.app-shell .catalog-grid{grid-template-columns:minmax(0,1fr)!important'), 'Product cards use a readable single column on narrow phones');
});

test('package cards and order details receive explicit dark surfaces', () => {
  assert.ok(responsiveCss.includes('#catalogContent :is('), 'Package catalog surfaces have an explicit theme scope');
  assert.ok(responsiveCss.includes('.pack-card,.pack-body,.step-summary,.empty-state,.catalog-note'), 'All package detail panels are covered');
  assert.ok(responsiveCss.includes(':root[data-theme="dark"] #orderModal :is('), 'The order detail dialog receives a dark theme outside the app shell');
  assert.ok(responsiveCss.includes('background-color:var(--surface-2)!important'), 'Package cards use a dark theme surface');
});


test('storefront route is shown before the catalog network request completes', () => {
  const initStart = storefrontHtml.indexOf('function init(){');
  const initEnd = storefrontHtml.indexOf('// delegated interactions', initStart);
  assert.ok(initStart >= 0 && initEnd > initStart, 'The storefront initializer is present');
  const init = storefrontHtml.slice(initStart, initEnd);
  const navigation = init.indexOf("navigate(resolveStoreLocation(),{historyMode:'replace'})");
  const catalogFetch = init.indexOf("fetch('/api/catalog',{cache:'no-store'})");
  assert.ok(navigation >= 0 && catalogFetch > navigation, 'The requested route is made visible before catalog data is requested');
  assert.ok(!init.includes('await fetch'), 'Catalog loading does not block first paint or route visibility');
  assert.ok(init.includes(".catch(()=>{});"), 'A catalog network failure leaves the storefront shell usable');
});

test('mobile storefront header selector matches the actual DOM hierarchy', () => {
  assert.match(storefrontHtml, /<div class="app-main">[\s\S]*?<header class="header">[\s\S]*?<main id="appMain">/);
  assert.ok(responsiveCss.includes('.app-shell .app-main > .header{'), 'Responsive header rule targets the actual nested header');
  assert.ok(!responsiveCss.includes('.app-shell>.header{'), 'No ineffective direct-child header selector remains');
});
