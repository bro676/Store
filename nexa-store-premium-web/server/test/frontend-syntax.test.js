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
const backendFiles = ['../src/server.js','../src/admin-core.js','../src/exchange-rate.js','../src/order-expiry.js','../src/best-store-api.js','../src/best-store-webhook.js','../src/best-store-fulfillment.js','../src/supplier-comparison.js'];
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
  assert.ok(store.includes("return '<article class=\"product-card\" data-open-item=\"'+esc(it.id)+'\" data-open-category=\"'+esc(cat.id)+'\" role=\"button\" tabindex=\"0\""), 'Featured product cards retain category context and open when clicked');
  assert.ok(store.includes('<article class="product-card" data-open-item="${esc(item.id)}" data-open-category="${esc(cat.id)}" role="button" tabindex="0"'), 'Saved product cards retain category context and open when clicked');
  assert.ok(store.includes("const productControl=eventElement(e,'[data-open-item]')"), 'All product cards route through composed-path delegated click handling');
  assert.ok(store.includes("document.addEventListener('keydown',e=>"), 'Product cards support keyboard activation');
  assert.ok(store.includes("eventElement(e,'.product-card[role=\"button\"][data-open-item]')"), 'Keyboard activation resolves the product card and its category context');
  assert.ok(store.includes(" },true);\n document.addEventListener('keydown',e=>"), 'Product and pack selection handlers run in capture phase');
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
  assert.ok(store.includes('nexa-luxury.css?v=20261102-01'), 'Store stylesheet uses the cache-busting version');
  assert.ok(admin.includes('nexa-luxury.css?v=20261102-01'), 'Admin stylesheet uses the cache-busting version');
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
  assert.ok(store.includes('data-open-item=\"\'+esc(it.id)+\'\" data-open-category=\"\'+esc(cat.id)+\'\">استكشف'), 'Featured call-to-action retains its category id');
  assert.match(store, /const productControl=eventElement\(e,'\[data-open-item\]'\)/, 'Product clicks use the shared composed-path delegated handler');
  assert.match(store, /openItem\(productControl\.dataset\.openItem,productControl\.dataset\.openCategory\|\|null\)/, 'Product handler passes both identifiers to the detail route');
  const openItem = store.slice(store.indexOf('function openItem'), store.indexOf('function resetCatalog'));
  assert.ok(openItem.includes("state.category=category.id;state.item=it.id"), 'Product selection stores canonical API identifiers');
  assert.ok(!openItem.includes('available===false'), 'Unavailable products can still be opened for details');
});

test('unavailable products open for details but cannot be purchased', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes("(product.wamda||product.bestStore)?.available===false?'غير متوفر حالياً':(NexaCatalog.getProductOptions(product).length===1?'عرض الباقات':'عرض المنتج'),false"), 'Unavailable products remain clickable from either supplier and single-option products lead to packs');
  assert.ok(store.includes("(it.wamda||it.bestStore)?.available===false?'disabled aria-disabled=\"true\"':''"), 'Unavailable pack buttons are disabled for either supplier');
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


test('checkout modal fields have direct dark and light overrides outside the app wrapper', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-luxury.css'), 'utf8');
  for (const selector of [
    ':root[data-theme="light"] #orderModal .modal',
    ':root[data-theme="light"] #orderModal .modal-body',
    ':root[data-theme="light"] #orderModal input:not([type="checkbox"]):not([type="radio"])',
    ':root[data-theme="light"] #orderModal select',
    ':root[data-theme="light"] #orderModal textarea',
    ':root[data-theme="light"] #orderModal input:-webkit-autofill',
    ':root[data-theme="dark"] #orderModal .modal',
    ':root[data-theme="dark"] #orderModal input:not([type="checkbox"]):not([type="radio"])',
    ':root[data-theme="dark"] #orderModal select',
    ':root[data-theme="dark"] #orderModal textarea'
  ]) assert.ok(css.includes(selector), 'Missing checkout modal theme rule: ' + selector);
});

test('homepage departments link into the five-level product hierarchy', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes('function renderDepartmentCard(group)'), 'Homepage renders separate main department cards');
  assert.ok(store.includes('NexaCatalog.getDepartmentSummaries(categories)'), 'Main departments group the API catalogue instead of taking the first eight categories');
  assert.ok(store.includes("data-department=\"'+esc(group.id)+'\""), 'Department cards have a dedicated navigation target');
  assert.ok(store.includes("if(el.dataset.department){state.department=el.dataset.department"), 'Department selection updates the current hierarchy state');
  assert.ok(store.includes("navigate('store');return}"), 'A homepage department click opens the visible catalogue page');
  for (const selector of ['function renderCatalog(){','if(!department){','}else if(!cat){','}else if(!it){','}else if(!opt){']) {
    assert.ok(store.includes(selector), 'Missing hierarchy stage: ' + selector);
  }
  assert.ok(store.includes("const steps=['القسم الرئيسي','قسم المورد','المنتج','الخيار / المنطقة','الباقة والسعر']"), 'Breadcrumb progress identifies all five steps');
});

test('product images and canonical folders use category-specific paths and preserve source names', async () => {
  const source = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-catalog.js'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(source, {filename:'nexa-catalog.js'}));
  const context = {window:{}, URL};
  vm.runInNewContext(source, context);
  const catalog = context.window.NexaCatalog;
  assert.equal(catalog.classifyCategory({name:'قسم الألعاب'}), 'games');
  assert.equal(catalog.classifyCategory({name:'ChatGPT Plus'}), 'ai');
  assert.equal(catalog.categoryImage({name:'قسم الألعاب',image:'assets/brand/logo.svg'}), 'assets/products/01-games/cover.svg');
  assert.equal(catalog.productImage({name:'PUBG UC',image:'assets/brand/logo.svg'}, {name:'قسم الألعاب'}), 'assets/products/01-games/pubg/cover.svg');
  const pathName = catalog.folderFor(
    {id:'wamda-category-12',name:'قسم الألعاب'},
    {id:'wamda-44',name:'اسم المنتج الداخلي',apiSource:{name:'اسم المنتج الخارجي'}},
    {id:'region-sg',name:'المنطقة السنغافورية'},
    ['9999 Silver',4]
  );
  assert.ok(pathName.startsWith('assets/products/01-games/'), 'Product directory starts under the main department');
  assert.ok(pathName.includes('قسم-الألعاب--wamda-category-12'), 'Folder preserves supplier category name and ID');
  assert.ok(pathName.includes('اسم-المنتج-الداخلي--source-اسم-المنتج-الخارجي--wamda-44'), 'Folder preserves internal and external product names and product ID');
  assert.ok(pathName.includes('options/المنطقة-السنغافورية--region-sg/packs/pack-9999-silver'), 'Option and pack names appear beneath the product folder');
});

test('storefront image lookup replaces the old logo placeholder in every primary surface', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes('/assets/brand/nexa-catalog.js?v=20261102-01'), 'Image and hierarchy helper loads before page scripts');
  assert.ok(store.includes('NexaCatalog.categoryImage(c)'), 'Homepage and catalog use department/category covers');
  assert.ok(store.includes('NexaCatalog.productImage(product,cat)'), 'Product tiles use product-specific images');
  assert.ok(store.includes('NexaCatalog.optionImage(o,it,cat)'), 'Option tiles use option artwork or the product fallback');
  assert.ok(store.includes('NexaCatalog.productImage(it,getCategory(state.category))'), 'Order modal receives the selected product image');
});


test('Best Store publication requires an explicit source-currency confirmation', async () => {
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  assert.ok(admin.includes('id="bestStoreCurrencyConfirmed"'), 'Admin exposes an explicit supplier-currency confirmation');
  assert.ok(admin.includes("bestStoreCurrencyConfirmed:$('bestStoreCurrencyConfirmed').checked"), 'The currency confirmation is persisted from the UI');
  assert.ok(server.includes("storeSettings?.bestStoreCurrencyConfirmed!==true"), 'Supplier comparisons are rejected until the currency is confirmed');
  assert.ok(server.includes("available:bestStore.available!==false&&Boolean(bestStoreApiTokenRuntime)&&storeSettings?.bestStoreCurrencyConfirmed===true"), 'Best Store products remain unavailable to customers until a valid token and currency are confirmed');
});

test('Best Store webhook URL is shown only in the admin integration panel with a copy action', async () => {
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  assert.ok(admin.includes('id="bestStoreWebhookUrl"'), 'Admin shows the webhook URL field');
  assert.ok(admin.includes('id="copyBestStoreWebhookBtn"'), 'Admin provides a copy action');
  assert.ok(admin.includes("$('bestStoreWebhookUrl').value=s.bestStoreWebhookUrl||''"), 'Admin loads the generated URL from safe settings');
  assert.ok(server.includes("'/api/webhooks/best-store/'"), 'Server publishes a path-scoped Best Store callback endpoint');
  assert.ok(server.includes('bestStoreWebhookUrl:'), 'Only the generated URL is exposed in admin settings');
  assert.ok(server.includes('bestStoreWebhookSecretEncrypted'), 'Webhook secret is stored encrypted');
  assert.ok(server.includes('resolveBestStoreWebhookReference'), 'Webhook maps callback to a known supplier order');
  assert.ok(server.includes('client.checkOrder(orderUuid)'), 'Best Store status is rechecked through its API worker rather than trusting callback status');
});

test('single-option products bypass the redundant option screen and invalid packs are not offered', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const catalogHelper = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-catalog.js'), 'utf8');
  assert.ok(store.includes('state.option=NexaCatalog.initialOptionId(it)'), 'One-option products automatically open the option/pack step');
  assert.ok(store.includes('NexaCatalog.getProductOptions(it)'), 'Only valid options are displayed');
  assert.ok(store.includes('NexaCatalog.isValidPack(p)'), 'Only valid priced packs are shown');
  assert.ok(store.includes("const productOptions=NexaCatalog.getProductOptions(it),backToProducts=productOptions.length===1;"), 'Single-option pack pages return directly to the product list');
  assert.ok(catalogHelper.includes('function initialOptionId(product)'), 'The navigation helper detects a single selectable option');
});

test('Best Store settings are persisted after repricing and runtime credentials are refreshed before success', async () => {
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  const start = server.indexOf("if (req.method === 'PATCH' && url.pathname === '/api/admin/settings')");
  const end = server.indexOf("if (req.method === 'POST' && url.pathname === '/api/admin/fx/refresh')", start);
  assert.ok(start >= 0 && end > start, 'Admin settings PATCH route exists');
  const route = server.slice(start, end);
  const repriceWamda = route.indexOf('if(pricingChanged)await repricePublishedWamdaProducts(nextSettings)');
  const repriceBestStore = route.indexOf('if(bestStorePricingChanged)await repricePublishedBestStoreProducts(nextSettings)');
  const persist = route.indexOf('await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)])');
  const apply = route.indexOf('storeSettings=nextSettings;');
  const success = route.indexOf("return send(res,200,{ok:true,settings:safeSettingsForAdmin()");
  assert.ok(repriceWamda >= 0 && repriceBestStore > repriceWamda, 'Both supplier reprice operations run before settings persistence');
  assert.ok(persist > repriceBestStore, 'Validated settings are persisted even when repricing ran');
  assert.ok(apply > persist && success > apply, 'Runtime secrets are reloaded before the success response');
  assert.ok(!route.includes('if(!pricingChanged&&!bestStorePricingChanged)'), 'Pricing changes must not bypass settings persistence');
});

test('Best Store token input remains visible until the server confirms the encrypted credential was saved', async () => {
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const start = admin.indexOf('async function saveBestStoreSettings');
  const end = admin.indexOf('async function testBestStore', start);
  assert.ok(start >= 0 && end > start, 'Best Store save function exists');
  const save = admin.slice(start, end);
  assert.ok(save.includes('if(payload.bestStoreApiToken&&!savedSettings.bestStoreApiTokenConfigured)'), 'A submitted token must be confirmed by the server');
  assert.ok(save.indexOf('if(payload.bestStoreApiToken&&!savedSettings.bestStoreApiTokenConfigured)') < save.indexOf("  $('bestStoreApiToken').value='';"), 'Token input is cleared only after the server confirms persistence');
  assert.ok(save.includes('state.settings={...state.settings,...savedSettings}'), 'Admin preserves the rest of the loaded settings');
});

test('storefront product cards have direct click handlers on each dynamic rendering root', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const helper = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-catalog.js'), 'utf8');
  assert.ok(helper.includes('function resolveProductNavigation(categories,productId,categoryId=null)'), 'Catalog helper resolves the selected product and its canonical step state');
  assert.ok(store.includes('NexaCatalog.resolveProductNavigation(categories,itemId,categoryId)'), 'Storefront uses the canonical product resolver');
  assert.ok(store.includes("for(const rootId of ['homeView','catalogContent','favoritesGrid'])"), 'Home, catalogue/search, and favourites each have a stable click root');
  assert.ok(store.includes("root?.addEventListener('click',handleStoreProductActivation,true)"), 'Dynamic product cards are opened from a direct root capture listener');
  assert.ok(store.includes('function handleStoreProductActivation(event)'), 'Product activation has a dedicated event handler');
  assert.ok(store.includes('function closestStoreTarget(event,selector)'), 'Product event targets use robust closest() lookup without realm-dependent Element checks');
  const delegated = store.slice(store.indexOf("document.addEventListener('click',e=>{const favoriteControl"), store.indexOf("document.addEventListener('keydown',e=>{", store.indexOf("document.addEventListener('click',e=>{const favoriteControl")));
  assert.ok(!delegated.includes("const productControl=eventElement(e,'[data-open-item]')"), 'The product flow no longer depends on the general document delegate');
  assert.ok(store.includes('nexa-catalog.js?v=20261102-02'), 'Updated product navigation helper bypasses stale browser assets');
});
