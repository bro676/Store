import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../');
const pages = ['index.html', 'admin.html'];

for (const page of pages) {
  test(page + ' inline JavaScript parses without syntax errors', async () => {
    const html = await fs.readFile(path.join(webRoot, page), 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(source => source.trim());
    assert.ok(scripts.length > 0, 'No inline scripts found in ' + page);
    for (const [index, source] of scripts.entries()) {
      assert.doesNotThrow(() => new vm.Script(source, { filename: page + '#script-' + (index + 1) }));
    }
  });
}
const backendFiles = ['../src/server.js','../src/admin-core.js','../src/exchange-rate.js'];
for (const relativePath of backendFiles) {
  test(relativePath + ' backend JavaScript parses without syntax errors', () => {
    const absolutePath = path.resolve(here, relativePath);
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', absolutePath], { stdio:'pipe' }));
  });
}


test('store and admin themes use independent persisted preferences', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const storeKey = store.match(/const NEXA_THEME_KEY='([^']+)'/);
  const adminKey = admin.match(/const ADMIN_THEME_KEY='([^']+)'/);
  assert.ok(storeKey, 'Store theme preference key is present');
  assert.ok(adminKey, 'Admin theme preference key is present');
  assert.notEqual(storeKey[1], adminKey[1], 'Store and admin theme preferences must not synchronize');
});

test('product click targets are complete and wallet checkout controls are present', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes("'data-open-item=\"'+esc(product.id)+'\" data-open-category=\"'+esc(cat.id)+'\"'"), 'Category product tiles must open through the canonical item handler and retain category context');
  assert.ok(store.includes("'data-open-item=\"'+esc(i.id)+'\" data-open-category=\"'+esc(c.id)+'\"'"), 'Search product tiles must retain their category context');
  assert.ok(store.includes('<article class="product-card" data-open-item="${esc(it.id)}" data-open-category="${esc(cat.id)}" role="button" tabindex="0"'), 'Featured product cards retain category context and open when clicked');
  assert.ok(store.includes('<article class="product-card" data-open-item="${esc(item.id)}" data-open-category="${esc(cat.id)}" role="button" tabindex="0"'), 'Saved product cards retain category context and open when clicked');
  assert.ok(store.includes("e.target.matches?.('.product-card[role=\"button\"][data-open-item]')"), 'Product cards support keyboard activation');
  assert.ok(store.includes('id="paymentMethod"'), 'Checkout must expose a payment method selector');
  assert.ok(store.includes('value="shamcash"') && store.includes('value="wallet"'), 'Checkout must offer direct and wallet payment');
  assert.ok(store.includes('id="customerWalletCard"') && store.includes('id="walletTopupForm"'), 'Wallet account and top-up interface must exist');
});

test('light mode overrides legacy dark panels across storefront and dashboard', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-luxury.css'), 'utf8');
  const lightRules = [
    ':root[data-theme="light"] .home-intro',
    ':root[data-theme="light"] .category-card',
    ':root[data-theme="light"] .wallet-api-side',
    ':root[data-theme="light"] .assistant-head',
    ':root[data-theme="light"] .modal-header',
    ':root[data-theme="light"] #app.shell .api-code',
    ':root[data-theme="light"] .menu-toggle',
    ':root[data-theme="light"] .toast',
    ':root[data-theme="light"] #app.shell .side',
    ':root[data-theme="light"] #app.shell .toast',
    ':root[data-theme="light"] #loginScreen.login-screen',
    ':root[data-theme="light"] .modal',
    ':root[data-theme="light"] .assistant-messages',
    ':root[data-theme="light"] .support-safety-panel',
    ':root[data-theme="light"] .support-help-links',
    ':root[data-theme="light"] .view[data-view="orders"] .data-table',
  ];
  for (const selector of lightRules) assert.ok(css.includes(selector), 'Missing light-mode override: ' + selector);
  assert.ok(css.includes(':root[data-theme="dark"] .wallet-api-side'), 'Dark mode retains its dark wallet panel');
});


test('Store and admin assets are revalidated instead of serving a stale theme', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  assert.ok(store.includes('nexa-luxury.css?v=20261101-05'), 'Store stylesheet uses the cache-busting version');
  assert.ok(admin.includes('nexa-luxury.css?v=20261101-05'), 'Admin stylesheet uses the cache-busting version');
  assert.ok(server.includes("const cacheControl = extension === '.html' ? 'no-store'"), 'HTML responses are not cached');
  assert.ok(server.includes("'Cache-Control':cacheControl"), 'Static files send explicit cache policy');
});


test('admin catalog product disclosures use a valid native summary without nested buttons', async () => {
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const productRenderer = admin.match(/function renderProduct\(p,ci,pi\)\{([\s\S]*?)\nfunction renderOption/);
  assert.ok(productRenderer, 'Admin product renderer is present');
  assert.match(productRenderer[1], /<details class="product-editor"><summary>/, 'Each catalog product uses native details/summary');
  assert.match(productRenderer[1], /<span class="icon-btn product-editor-chevron" aria-hidden="true">⌄<\/span>/, 'Disclosure indicator is decorative, not a nested button');
  const summaryStart = productRenderer[1].indexOf('<summary>');
  const summaryEnd = productRenderer[1].indexOf('</summary>', summaryStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart, 'Product summary exists');
  const summaryContent = productRenderer[1].slice(summaryStart, summaryEnd);
  assert.ok(!summaryContent.includes('<button'), 'A button must not be nested inside summary');
});

test('invoice receiver details renderer is defined and shows a copyable wallet address', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.match(store, /function renderInvoiceDetails\(order=\{\}\)/, 'Invoice rendering function exists before use');
  assert.match(store, /order\.receiverAddress\|\|order\.invoiceIdentifier/, 'Invoice renderer accepts the address returned by the API');
  assert.match(store, /function renderShamCashReceiver\(info=\{\}\)/, 'Wallet receiver panel renderer exists');
  assert.match(store, /data-copy-value="\$\{esc\(receiverAddress\)\}"/, 'Wallet address can be copied without exposing secrets');
  assert.match(store, /renderShamCashReceiver\(d\)/, 'Initial payment config populates receiver address');
});

test('payments config resolves receiver wallet even when checkout is disabled', async () => {
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  const route = server.slice(server.indexOf("url.pathname === '/api/payments/config'"), server.indexOf("const orderLookup", server.indexOf("url.pathname === '/api/payments/config'")));
  assert.match(route, /if \(cfg\.apiToken && cfg\.walletId\)/, 'Wallet lookup runs whenever stored API credentials exist');
  assert.match(route, /const wallet = await getWallet\(\)/, 'Receiver address comes from the provider wallet response');
  assert.match(route, /receiverAddress,/, 'Receiver address is part of public payment config');
});

test('theme contract assigns readable dark and light surfaces to store and admin content', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-luxury.css'), 'utf8');
  for (const selector of [
    ':root[data-theme="dark"] #app.shell .product-editor',
    ':root[data-theme="light"] #app.shell .product-editor',
    ':root[data-theme="dark"] .app-shell .wallet-api-side',
    ':root[data-theme="light"] .app-shell .wallet-api-side',
    ':root[data-theme="dark"] .app-shell .payment-receipt',
    ':root[data-theme="light"] .app-shell .payment-receipt',
    ':root[data-theme="dark"] .app-shell .data-table td',
    ':root[data-theme="light"] .app-shell .data-table td'
  ]) assert.ok(css.includes(selector), 'Missing explicit theme surface rule: ' + selector);
});


test('storefront product navigation normalizes ids and keeps the originating category', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.match(store, /function getCategory\(id\)\{return categories\.find\(x=>String\(x\.id\)===String\(id\)\)\|\|null\}/, 'Category ids are normalized across DOM and API string values');
  assert.match(store, /function getItem\(id,categoryId=state\.category\)/, 'Product lookup is scoped to the active category where possible');
  assert.ok(store.includes('data-open-category="${esc(cat.id)}" role="button" tabindex="0"'), 'Featured product cards retain their category id');
  assert.ok(store.includes('data-open-item="${esc(it.id)}" data-open-category="${esc(cat.id)}">استكشف'), 'Featured call-to-action retains its category id');
  assert.match(store, /const productControl=e\.target\.closest\('\[data-open-item\]'\)/, 'Product clicks use a dedicated delegated handler');
  assert.match(store, /openItem\(productControl\.dataset\.openItem,productControl\.dataset\.openCategory\|\|null\)/, 'Product handler passes both identifiers to the detail route');
  const openItem = store.slice(store.indexOf('function openItem'), store.indexOf('function resetCatalog'));
  assert.ok(openItem.includes("state.category=category.id;state.item=it.id"), 'Product selection stores canonical API identifiers');
  assert.ok(!openItem.includes('available===false'), 'Unavailable products can still be opened for details');
});

test('unavailable products open for details but cannot be purchased', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes("product.wamda?.available===false?'غير متوفر حالياً':'اختيار المنتج',false"), 'Unavailable products remain clickable from the category list');
  assert.ok(store.includes("it.wamda?.available===false?'disabled aria-disabled=\"true\"':''"), 'Unavailable pack buttons are disabled');
  assert.ok(store.includes('لا يمكن إنشاء طلب قبل عودته إلى التوفر لدى المورد'), 'The detail view explains the availability restriction');
});

test('storefront light and dark themes override high-specificity form fields and autofill', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-luxury.css'), 'utf8');
  for (const selector of [
    ':root[data-theme="light"] .app-shell .support-form .field input',
    ':root[data-theme="light"] .app-shell .view[data-view="wallet"] .wallet-payment-form .field input',
    ':root[data-theme="dark"] .app-shell .support-form .field input',
    ':root[data-theme="dark"] .app-shell .view[data-view="wallet"] .wallet-payment-form .field input',
    ':root[data-theme="light"] .app-shell input:-webkit-autofill',
    ':root[data-theme="dark"] .app-shell input:-webkit-autofill',
    ':root[data-theme="light"] .app-shell .home-intro',
    ':root[data-theme="light"] .app-shell .home-intro-note',
    ':root[data-theme="light"] .app-shell .home-assistant-link'
  ]) assert.ok(css.includes(selector), 'Missing storefront theme override: ' + selector);
});


test('favorite product cards resolve category ids consistently and retain click context', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const renderer = store.slice(store.indexOf('function renderFavorites'), store.indexOf('function toggleFavorite'));
  assert.ok(renderer.includes('String(i.id)===String(id)&&i===item'), 'Favorite category lookup uses normalized IDs and the matched product object');
  assert.ok(renderer.includes('data-open-category="${esc(cat.id)}"'), 'Favorite cards pass their category identifier to product navigation');
  assert.ok(renderer.includes('data-open-item="${esc(item.id)}" data-open-category="${esc(cat.id)}">استكشف'), 'Favorite call-to-action passes both item and category identifiers');
});
