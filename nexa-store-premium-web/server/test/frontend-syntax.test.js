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
  assert.ok(store.includes("document.addEventListener('click',e=>{const favoriteControl=eventElement(e,'[data-favorite]')"), 'All dynamic product-card regions use one document-level click delegate');
  assert.ok(store.includes("const productControl=NexaCatalog.findProductControl(e)"), 'Nested product-card clicks resolve through the canonical event-path helper');
  assert.ok(store.includes("openItem(productControl.getAttribute('data-open-item'),productControl.getAttribute('data-open-category')||null)"), 'The document delegate passes both canonical identifiers into product navigation');
  assert.ok(store.includes("document.addEventListener('keydown',e=>"), 'Product cards support keyboard activation');
  assert.ok(store.includes("const productControl=NexaCatalog.findProductControl(e)"), 'Keyboard activation resolves product cards, tiles, and featured calls to action');
  assert.ok(!store.includes("root?.addEventListener('click',handleStoreProductActivation,true)"), 'Product activation no longer depends on per-root listeners');
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
  assert.ok(!store.includes('nexa-luxury.css') && !admin.includes('nexa-luxury.css'), 'The old luxury theme is no longer loaded by either live interface');
  assert.ok(store.includes('nexa-wamda-blue.css?v=20261105-wamda-full-shell-v4'), 'Storefront loads the new full-shell theme');
  assert.ok(admin.includes('nexa-wamda-blue.css?v=20261105-wamda-full-shell-v4'), 'Admin loads the same new full-shell theme');
  assert.ok(server.includes("const cacheControl = extension === '.html' ? 'no-store'"), 'HTML responses are not cached');
  assert.ok(server.includes("'Cache-Control':cacheControl"), 'Static files send explicit cache policy');
});


test('admin catalog exposes a recursive folder tree and safe manual organization controls', async () => {
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  assert.ok(admin.includes('nexa-catalog.js?v=20261104-folder-tree-v1'), 'Admin loads the same folder hierarchy helper as storefront');
  assert.ok(admin.includes('function renderFolderBranch(parentId,departmentId,depth=0)'), 'Admin renders nested folders recursively');
  assert.ok(admin.includes('data-move-product='), 'Products can be moved between folders');
  assert.ok(admin.includes("data-path=\"'+ci+'.parentId\""), 'A folder can be moved under another folder');
  assert.ok(admin.includes('إظهار هذا المجلد في المتجر'), 'Folders can be hidden without deleting their source records');
  assert.ok(admin.includes('إظهار المنتج في المتجر'), 'Products can be hidden individually');
  assert.ok(admin.includes('folderManual:true'), 'Manually created folders are marked to survive supplier replace sync');
  assert.ok(server.includes("url.pathname==='/api/admin/catalog/move-product'"), 'The server moves products without recreating their supplier records');
  assert.ok(admin.includes('id="deleteFolderDestination"'), 'Non-empty folder deletion requires an explicit destination');
  assert.ok(server.includes("url.pathname==='/api/admin/catalog/delete-folder'"), 'The server deletes folders by safely rehoming their contents');
});

test('storefront renders child folders and products together inside each folder', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes('NexaCatalog.getChildFolders(categories,cat.id)'), 'A folder can contain recursively nested folders');
  assert.ok(store.includes('المنتجات داخل'), 'Products are rendered alongside child folders');
  assert.ok(store.includes('NexaCatalog.getCategoryDepartmentId(getCategory(el.dataset.browseCategory),categories)'), 'Nested navigation inherits the original root department');
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
  assert.ok(store.includes("document.addEventListener('click',e=>{const favoriteControl=eventElement(e,'[data-favorite]')"), 'Home, catalogue/search, and favourites share document-level product click delegation');
  assert.ok(store.includes('const productControl=NexaCatalog.findProductControl(e)'), 'Product clicks use the canonical composed-path activation helper');
  assert.ok(store.includes("openItem(productControl.getAttribute('data-open-item'),productControl.getAttribute('data-open-category')||null)"), 'The product handler passes both identifiers into the detail route');
  const openItem = store.slice(store.indexOf('function openItem'), store.indexOf('function closestStoreTarget'));
  assert.ok(openItem.includes('NexaCatalog.resolveProductNavigation(categories,itemId,categoryId)'), 'Product selection uses the canonical API resolver');
  assert.ok(openItem.includes('state.category=resolved.categoryId;'), 'Product selection stores the canonical category identifier');
  assert.ok(openItem.includes('state.item=resolved.itemId;'), 'Product selection stores the canonical product identifier');
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
  assert.ok(store.includes("const steps=['القسم الرئيسي','المجلدات المتداخلة','المنتج','الخيار / المنطقة','الباقة والسعر']"), 'Breadcrumb progress identifies all five steps');
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
  assert.ok(store.includes('/assets/brand/nexa-catalog.js?v=20261104-folder-tree-v1'), 'Updated image and hierarchy helper loads before page scripts');
  assert.ok(store.includes('NexaCatalog.categoryImage(folder,categories)'), 'Homepage and catalog use department/category covers');
  assert.ok(store.includes('NexaCatalog.productImage(product,cat,categories)'), 'Product tiles use product-specific images');
  assert.ok(store.includes('NexaCatalog.optionImage(o,it,cat,categories)'), 'Option tiles use option artwork or the product fallback');
  assert.ok(store.includes('NexaCatalog.productImage(it,getCategory(state.category),categories)'), 'Order modal receives the selected product image');
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
  assert.ok(store.includes('state.option=resolved.optionId;'), 'One-option products automatically open the option/pack step');
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

test('storefront product cards use robust document-level delegated click and keyboard handling', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const helper = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-catalog.js'), 'utf8');
  assert.ok(helper.includes('function resolveProductNavigation(categories,productId,categoryId=null)'), 'Catalog helper resolves the selected product and its canonical step state');
  assert.ok(helper.includes('function findProductControl(event)'), 'Catalog helper resolves nested card elements through composedPath and closest');
  assert.ok(store.includes('NexaCatalog.resolveProductNavigation(categories,itemId,categoryId)'), 'Storefront uses the canonical product resolver');
  assert.ok(store.includes("document.addEventListener('click',e=>{const favoriteControl=eventElement(e,'[data-favorite]')"), 'Home, catalogue/search, and favourites share the document click delegate');
  assert.ok(store.includes('const productControl=NexaCatalog.findProductControl(e)'), 'Dynamic product cards are found through the canonical event-path helper');
  assert.ok(store.includes("openItem(productControl.getAttribute('data-open-item'),productControl.getAttribute('data-open-category')||null)"), 'Product navigation forwards the exact product and category IDs');
  assert.ok(!store.includes("root?.addEventListener('click',handleStoreProductActivation,true)"), 'The click flow no longer depends on stable rendering roots');
  assert.ok(store.includes('document.addEventListener(\'keydown\',e=>'), 'Keyboard activation remains supported');
  assert.ok(store.includes('nexa-catalog.js?v=20261104-folder-tree-v1'), 'Updated product navigation helper bypasses stale browser assets');
});


test('Wamda-style sky-blue redesign preserves store flows and adds reference account pages', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const theme = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');

  const customerRoutes = [
    'home','store','orders','favorites','wallet','support','payments','profile','about',
    'login','forgot','notifications','vip','bot','affiliate','security','verify','apiSettings','install'
  ];
  for (const id of customerRoutes) {
    assert.ok(store.includes('data-view="' + id + '"'), 'Missing storefront page view: ' + id);
    assert.ok(store.includes('data-page="' + id + '"'), 'Missing storefront navigation target: ' + id);
  }

  for (const id of [
    'sidebarProfileButton','sidebarProfileAvatar','sidebarCustomerName','sidebarCustomerMeta',
    'sidebarBalanceValue','globalSearchRow','globalSearch','homeSearchForm','paymentsTable',
    'accountLoginPhone','accountLoginPassword','accountAuthMessage','loginPageForm',
    'loginPagePhone','loginPagePassword','loginPageMessage','registerView','forgotPasswordView','notificationsView','vipView',
    'botView','affiliateView','securityView','verifyView','apiSettingsView','installView',
    'orderModal','walletTopupForm','walletLedgerList','supportForm','assistantPanel'
  ]) {
    assert.ok(store.includes('id="' + id + '"'), 'Missing preserved or newly designed customer element: ' + id);
  }

  assert.ok(store.includes('class="reference-search-row"'), 'The catalogue search is separated from the cyan header');
  assert.ok(store.includes("searchRow.classList.toggle('hidden',view!=='store')"), 'The global search is reserved for the catalogue while the homepage uses its post-hero search');
  assert.ok(store.indexOf('<div class="promo">')>store.indexOf('data-view="home"'), 'The announcement strip is part of the homepage, not every route');
  assert.ok(store.indexOf('data-view="store"')<store.indexOf('id="globalSearchRow"') && store.indexOf('id="globalSearchRow"')<store.indexOf('class="catalog-shell"'), 'Catalogue search follows the catalogue page heading');
  assert.ok(store.includes('document.documentElement.dataset.currentPage=view'), 'The active view controls page-specific header affordances');
  assert.equal((store.match(/\$\('menuToggle'\)\.addEventListener\('click'/g)||[]).length,1, 'Mobile sidebar toggle has exactly one click handler');
  assert.ok(store.includes('function renderLoginPage()'), 'The dedicated login page reflects the current customer session');
  assert.ok(store.includes("fetch('/api/account/login'"), 'The dedicated login page uses the existing phone/password API');
  assert.ok(store.includes("'/api/account/orders'"), 'Customer order history retains its existing API');
  assert.ok(store.includes("'/api/account/me'"), 'Customer profile retains its existing authenticated API');
  assert.ok(store.includes("'/api/account/login'"), 'The original customer login route remains intact');
  assert.ok(!store.includes('accountRegisterForm') && !store.includes('accountAuthSwitch'), 'No public registration form or switch is present in the customer interface');
  assert.ok(store.includes('id="accountLoginForm"') && store.includes('id="loginPageForm"'), 'Existing customers can still log in using phone and password');
  assert.ok(!store.includes('/api/account/register') && !store.includes('data-page="register"'), 'No public customer registration action is exposed in the storefront');
  assert.ok(store.includes('data-view="register"') && store.includes('التسجيل غير متاح حالياً'), 'The direct registration route clearly states that registration remains disabled');
  assert.ok(store.includes('data-view="forgot"') && store.includes('استعادة كلمة المرور غير مفعّلة حالياً'), 'Password recovery stays unavailable until a verified SMS/OTP provider exists');
  assert.ok(store.includes('data-page="forgot"'), 'The login form provides a route to the password-recovery explanation');
  assert.ok(server.includes("if(req.method==='POST'&&url.pathname==='/api/account/register')return send(res,403,{ok:false,error:'REGISTRATION_DISABLED'"), 'The backend unconditionally rejects public registration');
  assert.ok(!server.includes('CUSTOMER_REGISTRATION_ENABLED') && !server.includes('customerRegistrationEnabled'), 'Registration cannot be turned on by an environment variable');

  for (const id of ['overview','catalog','catalog-api','orders','payments','exchange']) {
    assert.ok(admin.includes('data-page="' + id + '"'), 'Existing admin section was removed: ' + id);
  }
  assert.ok(admin.includes('admin-rail-summary'), 'The existing admin workspace summary remains in place');
  assert.ok(admin.includes('adminThemeToggle'), 'The admin keeps its independent theme control');

  const themeRef = 'nexa-wamda-blue.css?v=20261105-wamda-full-shell-v4';
  assert.ok(store.includes(themeRef), 'Storefront uses the rebuilt structural theme revision');
  assert.ok(admin.includes(themeRef), 'Admin uses the same rebuilt structural theme revision');
  assert.ok(theme.includes('.app-shell .sidebar{') && theme.includes('position:fixed!important;'), 'The customer account rail is fixed on desktop');
  assert.ok(theme.includes('.app-shell .sidebar-profile'), 'The customer account rail has a dedicated visual system');
  assert.ok(theme.includes('.app-shell .sidebar-nav'), 'The account rail has its own scrollable reference navigation');
  assert.ok(theme.includes('.app-shell .reference-search-row'), 'The horizontal search row has a dedicated layout');
  assert.ok(theme.includes('.app-shell .home-intro{') && theme.includes('.app-shell .department-card-art{'), 'Homepage hero and category artwork use the rebuilt reference composition');
  assert.ok(theme.includes('.app-shell .catalog-grid{'), 'Nested catalog folders and products have explicit grid rules');
  assert.ok(theme.includes('.app-shell .option-list{'), 'The options/region stage retains its own layout');
  assert.ok(theme.includes('.app-shell .pack-grid{'), 'The pack/price stage retains its own layout');
  assert.ok(theme.includes('grid-template-columns:repeat(4,minmax(0,1fr))'), 'Wide catalog/category grids use four columns');
  assert.ok(theme.includes('--rail-width:clamp(360px,26.6vw,512px)'), 'The desktop account rail matches the full-width Wamda reference rail');
  assert.ok(theme.includes('--topbar-height:66px'), 'The storefront topbar matches the Wamda screenshot height');
  assert.ok(theme.includes('margin:0 var(--rail-width) 0 0!important'), 'The content area reserves the full fixed desktop rail');
  assert.ok(theme.includes('body.sidebar-open .app-shell .sidebar{transform:translateX(0)!important}'), 'On mobile the account rail is an off-canvas drawer');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .side{transform:translateX(0)!important}'), 'The admin rail becomes an off-canvas drawer on mobile');
  assert.ok(theme.includes("url('/assets/brand/nexa-hero-banner.svg')"), 'The homepage uses the existing sky-blue visual banner');
  assert.ok(theme.includes('.app-shell .nexa-marquee{') && theme.includes('.app-shell .nexa-home-search{'), 'The homepage ticker and dedicated search appear after the hero');
  assert.ok(theme.includes('.app-shell .sidebar-account-balance'), 'The account rail shows the authenticated wallet balance');
  assert.ok(theme.includes('#app.shell .side{'), 'The admin rail participates in the separate light and dark themes');
  assert.ok(theme.includes('#app.shell .topbar{') && theme.includes('min-height:var(--topbar-height)!important;height:var(--topbar-height)!important;'), 'The admin topbar shares the full-shell reference height');
  assert.ok(theme.includes('.app-shell .header{') && theme.includes('position:sticky!important;top:0!important;z-index:70!important;'), 'The customer topbar remains horizontal and fixed to the top');
  assert.ok(theme.includes('#62c8f2'), 'The rebuilt topbar uses the requested sky-blue brand color');
  assert.ok(theme.includes('--red:var(--sky-2)') && theme.includes('--green:var(--sky-3)'), 'Legacy primary/green aliases resolve to the sky-blue brand');
  assert.ok(theme.includes('.app-shell .step.active span{background:var(--sky-2)!important'), 'Active product-flow steps use the sky-blue accent');
  assert.ok(theme.includes('.app-shell .tabs button.active,.app-shell .tab.active{'), 'Active tab states use the same sky-blue accent');
  assert.ok(theme.includes(':root[data-theme="light"]'), 'Light theme is explicitly supported');
  assert.ok(theme.includes(':root[data-theme="dark"]'), 'Dark theme is explicitly supported');
  assert.ok(theme.includes('@media(max-width:860px)'), 'The account rail has a mobile drawer layout');
  assert.ok(theme.includes('#app.shell .side'), 'The existing admin dashboard keeps its own rail');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .side'), 'Admin mobile rail follows its existing open-state class');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .admin-sidebar-backdrop'), 'Admin mobile backdrop follows the real body state');
  assert.ok(theme.includes('.reference-empty-panel'), 'Reference account-only pages have a truthful unavailable state');
  assert.ok(store.includes('data-open-assistant'), 'The existing assistant remains reachable from the account rail');
  assert.ok(store.includes('class="home-intro-brand-mark"'), 'The Nexa brand mark remains on the homepage');
});


test('Wamda reference paths load the storefront shell and resolve to the intended customer views', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');

  const serverRoutes = server.slice(server.indexOf('const CUSTOMER_APP_ROUTES'), server.indexOf('async function serveStatic'));
  const routeCode = store.slice(store.indexOf('const STORE_VIEW_PATHS'), store.indexOf('function closeMenu'));
  const expectedRoutes = [
    '/home','/index','/category','/add_funds','/my_payments','/my_wallet','/my_orders',
    '/bot','/affiliate','/security','/verify_id','/api_settings','/about','/favorites',
    '/profile','/notifications','/vip_levels','/login','/register','/forgot_password'
  ];
  for (const route of expectedRoutes) {
    assert.ok(serverRoutes.includes("'" + route + "'"), 'Server must serve reference route: ' + route);
  }
  for (const [route,view] of [
    ['/home','home'],['/index','home'],['/my_orders','orders'],['/my_payments','payments'],
    ['/my_wallet','wallet'],['/add_funds','wallet'],['/bot','bot'],['/affiliate','affiliate'],
    ['/security','security'],['/verify_id','verify'],['/api_settings','apiSettings'],
    ['/about','about'],['/favorites','favorites'],['/profile','profile'],
    ['/notifications','notifications'],['/vip_levels','vip'],['/login','login'],
    ['/register','register'],['/forgot_password','forgot']
  ]) {
    assert.ok(routeCode.includes("'" + route + "':'" + view + "'"), 'Customer path must resolve to ' + view + ': ' + route);
  }
  assert.ok(routeCode.includes("if(pathname==='/category')"), 'Category route has a dedicated query-aware resolver');
  assert.ok(routeCode.includes("url.searchParams.get('id')"), 'Category deep links restore their requested category ID');
  assert.ok(routeCode.includes("NexaCatalog.getCategoryDepartmentId(category,categories)"), 'Category deep links restore the parent department');
  assert.ok(routeCode.includes("window.addEventListener('popstate'"), 'Browser back and forward navigation is wired to the current URL');
  assert.ok(server.includes('customerAppRoute || pathname.startsWith(\'/assets/\')'), 'Only known customer paths and static assets are served through the app shell');
  assert.ok(server.includes("return send(res,404,{error:'NOT_FOUND'})"), 'Unknown paths remain 404 instead of silently displaying the storefront');
});
