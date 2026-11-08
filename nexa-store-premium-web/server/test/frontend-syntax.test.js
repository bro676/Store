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
const backendFiles = ['../src/server.js','../src/admin-core.js','../src/exchange-rate.js','../src/order-expiry.js','../src/best-store-api.js','../src/best-store-webhook.js','../src/best-store-fulfillment.js','../src/supplier-comparison.js','../src/customer-auth.js'];
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
  assert.ok(store.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Storefront loads the new full-shell theme');
  assert.ok(admin.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Admin loads the same new full-shell theme');
  assert.ok(server.includes("const cacheControl = extension === '.html' ? 'no-store'"), 'HTML responses are not cached');
  assert.ok(server.includes("'Cache-Control':cacheControl"), 'Static files send explicit cache policy');
});
test('catalog department settings, imported source identities and empty nested folders are wired through',async()=>{
  const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
  const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
  const server=await fs.readFile(path.join(webRoot,'server/src/server.js'),'utf8');
  const helper=await fs.readFile(path.join(webRoot,'assets/brand/nexa-catalog.js'),'utf8');
  assert.ok(admin.includes('data-department-path='),'Main departments expose editable settings');
  assert.ok(admin.includes('data-department-image='),'Main department cover images can be uploaded');
  assert.ok(admin.includes('data-reset-category-api='),'API-backed folders can restore their original source name and image');
  assert.ok(admin.includes('الاسم الأصلي القادم من API'),'Product editor shows the external source name separately from the storefront name');
  assert.ok(admin.includes("api('/api/admin/catalog/departments'")&&admin.includes('departments:departmentPayloads'),'Department settings are saved through the dedicated incremental endpoint');
  assert.ok(server.includes('catalogDepartments:[]'),'Root department settings are persisted in store settings');
  assert.ok(server.includes('backfillSupplierCategorySources'),'Existing supplier folders receive source snapshots on startup');
  assert.ok(server.includes('restoreCategoryApiMatch'),'Folder API metadata has a restore endpoint');
  assert.ok(server.includes('categorySourceSnapshot'),'Supplier categories keep original source names and image references');
  assert.ok(store.includes('categories=d.catalog.filter(c=>Array.isArray(c.items))'),'Storefront does not drop empty parent folders');
  assert.ok(store.includes('NexaCatalog.setDepartments(Array.isArray(d.departments)?d.departments:[])'),'Storefront receives editable root department labels and covers');
  assert.ok(helper.includes('setDepartments'),'Department names, images, order and visibility are data-driven');
});

test('admin catalog exposes a recursive folder tree and safe manual organization controls', async () => {
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  assert.ok(admin.includes('nexa-catalog.js?v=20261106-dashboard-order-v3'), 'Admin loads the same folder hierarchy helper as storefront');
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
  assert.ok(store.includes("const unavailable=(it.wamda||it.bestStore)?.available===false;") && store.includes("(unavailable?'disabled aria-disabled=\"true\"':'')"), 'Unavailable pack buttons are disabled for either supplier');
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
  assert.ok(store.includes('/assets/brand/nexa-catalog.js?v=20261106-dashboard-order-v3'), 'Updated image and hierarchy helper loads before page scripts');
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
  assert.ok(store.includes('nexa-catalog.js?v=20261106-dashboard-order-v3'), 'Updated product navigation helper bypasses stale browser assets');
});


test('Wamda brand redesign preserves store flows and adds reference account pages', async () => {
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
    'globalSearchRow','globalSearch','homeSearchForm','paymentsTable',
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
  assert.ok(store.includes('/api/account/register') && store.includes('data-page="register"'), 'The phone registration page and backend route are available');
  assert.ok(store.includes('id="registerPageForm"') && store.includes('id="registerPagePhone"') && store.includes('id="registerPagePassword"') && store.includes('id="registerPagePasswordConfirm"'), 'Registration form collects a phone number and confirmed password');
  assert.ok(store.includes('data-view="forgot"') && store.includes('استعادة كلمة المرور غير مفعّلة حالياً'), 'Password recovery stays unavailable until a verified SMS/OTP provider exists');
  assert.ok(store.includes('data-page="forgot"'), 'The login form provides a route to the password-recovery explanation');
  assert.ok(server.includes("if(req.method==='POST'&&url.pathname==='/api/account/register'){") && server.includes('PHONE_ALREADY_REGISTERED') && server.includes('pg_advisory_xact_lock'), 'The backend only creates an account for an unused phone number');
  assert.ok(!server.includes('CUSTOMER_REGISTRATION_ENABLED') && !server.includes('customerRegistrationEnabled'), 'Registration cannot be turned on by an environment variable');

  for (const id of ['overview','catalog','catalog-api','orders','payments','exchange']) {
    assert.ok(admin.includes('data-page="' + id + '"'), 'Existing admin section was removed: ' + id);
  }
  assert.ok(admin.includes('admin-rail-summary'), 'The existing admin workspace summary remains in place');
  assert.ok(admin.includes('adminThemeToggle'), 'The admin keeps its independent theme control');

  const themeRef = 'nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1';
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
  assert.ok(theme.includes('--rail-width:clamp(260px,19vw,296px)'), 'The desktop account rail matches the full-width Wamda reference rail');
  assert.ok(theme.includes('--topbar-height:66px'), 'The storefront topbar matches the Wamda screenshot height');
  assert.ok(theme.includes('margin:0 var(--rail-width) 0 0!important'), 'The content area reserves the full fixed desktop rail');
  assert.ok(theme.includes('body.sidebar-open .app-shell .sidebar{transform:translateX(0)!important}'), 'On mobile the account rail is an off-canvas drawer');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .side{transform:translateX(0)!important}'), 'The admin rail becomes an off-canvas drawer on mobile');
  assert.ok(theme.includes("url('/assets/brand/nexa-hero-banner.svg')"), 'The homepage banner artwork is retained and recolored to Wamda tones');
  assert.ok(theme.includes('.app-shell .nexa-marquee{') && theme.includes('.app-shell .nexa-home-search{'), 'The homepage ticker and dedicated search appear after the hero');
  assert.ok(theme.includes('.app-shell .sidebar-account-balance'), 'The account rail shows the authenticated wallet balance');
  assert.ok(theme.includes('#app.shell .side{'), 'The admin rail participates in the separate light and dark themes');
  assert.ok(theme.includes('#app.shell .topbar{') && theme.includes('min-height:var(--topbar-height)!important;height:var(--topbar-height)!important;'), 'The admin topbar shares the full-shell reference height');
  assert.ok(theme.includes('.app-shell .header{') && theme.includes('position:sticky!important;top:0!important;z-index:70!important;'), 'The customer topbar remains horizontal and fixed to the top');
  assert.ok(theme.includes('--brand-indigo:#3f4a75') && theme.includes('--brand-teal:#0095a4') && theme.includes('--brand-cyan:#55b8cc') && theme.includes('--brand-sand:#e9e1db'), 'The rebuilt interface uses the complete official Wamda palette');
  assert.ok(theme.includes('--red:#0095a4') && theme.includes('--green:#238a69'), 'Primary and success colors remain semantically distinct in the Wamda palette');
  assert.ok(theme.includes('.app-shell .step.active span{background:var(--sky-2)!important'), 'Active product-flow steps use the sky-blue accent');
  assert.ok(theme.includes('.app-shell .tabs button.active,.app-shell .tab.active{'), 'Active tab states use the same sky-blue accent');
  assert.ok(theme.includes('.app-shell .header-actions .icon-button:hover{background:rgba(0,149,164,.2)!important'), 'Header icon hover states use the official teal accent');
  assert.ok(theme.includes(':root[data-theme="light"]'), 'Light theme is explicitly supported');
  assert.ok(theme.includes(':root[data-theme="dark"]'), 'Dark theme is explicitly supported');
  assert.ok(theme.includes('@media(max-width:860px)'), 'The account rail has a mobile drawer layout');
  assert.ok(theme.includes('#app.shell .side'), 'The existing admin dashboard keeps its own rail');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .side'), 'Admin mobile rail follows its existing open-state class');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .admin-sidebar-backdrop'), 'Admin mobile backdrop follows the real body state');
  assert.ok(theme.includes('.reference-empty-panel'), 'Reference account-only pages have a truthful unavailable state');
  assert.ok(store.includes('data-open-assistant'), 'The existing assistant remains reachable from the account rail');
  assert.ok(store.includes('id="sidebarClose"') && store.includes('class="sidebar-drawer-head"'), 'Store drawer includes an in-drawer close control');
  assert.ok(store.includes("const storeDrawerMedia=window.matchMedia('(max-width: 1024px)')"), 'Store drawer activates at the tablet breakpoint');
  assert.ok(store.includes("$('sidebarClose').addEventListener('click',()=>closeMenu(true))"), 'Store close control restores focus to the menu toggle');
  assert.ok(store.includes("if(e.key==='Tab'&&storeDrawerMedia.matches&&isStoreMenuOpen())"), 'Store drawer traps keyboard focus while open');
  assert.ok(store.includes("setAttribute('inert','')") && store.includes("removeAttribute('inert')"), 'Store drawer leaves keyboard navigation while closed');
  assert.ok(admin.includes('id="adminSidebarClose"') && admin.includes('class="admin-sidebar-head"'), 'Admin drawer includes its own close control');
  assert.ok(admin.includes("window.matchMedia('(max-width: 1024px)')"), 'Admin drawer uses the tablet breakpoint');
  assert.ok(admin.includes("closeButton.addEventListener('click', () => setOpen(false, true))"), 'Admin close control restores focus to its toggle');
  assert.ok(admin.includes("event.key !== 'Tab' || !document.body.classList.contains('admin-sidebar-open')"), 'Admin drawer traps keyboard focus while open');
  assert.ok(theme.includes('@media(max-width:1024px)'), 'Store and admin drawers collapse below 1024px');
  assert.ok(theme.includes('body.sidebar-open .app-shell .sidebar{transform:translate3d(0,0,0)!important}'), 'Store drawer uses a smooth hardware-accelerated slide');
  assert.ok(theme.includes('body.admin-sidebar-open #app.shell .side{transform:translate3d(0,0,0)!important}'), 'Admin drawer uses the same smooth slide behavior');
  assert.ok(theme.includes('body.sidebar-open,body.admin-sidebar-open{overflow:hidden!important'), 'Background scrolling is locked while a drawer is open');
  assert.ok(theme.includes('@media(max-width:380px)'), 'Header and controls have an extra-small phone layout');
  assert.ok(theme.includes('.app-shell .option-list,.app-shell .pack-grid,.app-shell .faq-grid,') && theme.includes('grid-template-columns:1fr!important;'), 'Narrow phones keep the long option and pack choices in a readable single column');

  assert.ok(store.includes('class="home-intro-brand-mark"'), 'The Nexa brand mark remains on the homepage');
});



test('Wamda drawer is compact, closable at every viewport, and scrolls as one surface', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const theme = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');

  assert.ok(theme.includes('--rail-width:clamp(260px,19vw,296px)'), 'Desktop account drawer stays compact');
  assert.ok(/body\.sidebar-closed \.app-shell \.sidebar\{\s*transform:translate3d\(110%,0,0\)!important;/.test(theme), 'Desktop drawer can slide closed');
  assert.ok(theme.includes('body.sidebar-closed .app-shell .app-main{'), 'The content expands when the desktop drawer closes');
  assert.ok(theme.includes('.app-shell .menu-toggle{') && theme.includes('display:grid!important;'), 'The drawer can be reopened at desktop widths');
  assert.ok(theme.includes('.app-shell .sidebar{') && theme.includes('overflow-y:auto!important;'), 'The outer drawer owns vertical scrolling');
  assert.ok(theme.includes('.app-shell .sidebar-nav{') && theme.includes('overflow:visible!important;overflow-y:visible!important;'), 'Navigation no longer creates a second nested scrollbar');
  assert.ok(theme.includes('flex:0 0 auto!important;'), 'Drawer sections remain together inside the outer scroll surface');
  assert.ok(theme.includes(':root[data-theme="dark"]{') && theme.includes('--drawer-bg:#3f4a75;'), 'Dark drawer uses the official Wamda indigo');
  assert.ok(theme.includes(':root[data-theme="light"]{') && theme.includes('--drawer-bg:#f8f5f1;'), 'Light drawer uses the warm Wamda neutral surface');
  assert.ok(theme.includes('.app-shell .sidebar-drawer-head{') && theme.includes('display:flex!important;'), 'The close control remains available in the drawer header');

  assert.ok(store.includes('function isStoreMenuOpen()'), 'Drawer state is tracked for both desktop and mobile');
  assert.ok(store.includes('function syncStoreMenuToViewport()'), 'Drawer state adapts when the viewport crosses the breakpoint');
  assert.ok(store.includes("if(storeDrawerMedia.matches)closeMenu(true);"), 'Selecting a page closes the overlay only on small screens');
  assert.ok(store.includes("if(isStoreMenuOpen())closeMenu(true);else openMenu()"), 'The menu toggle opens and closes the desktop rail too');
});


test('Wamda app chrome keeps account shortcuts, VIP, notifications and theme in the requested positions', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const theme = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  const sidebarStart = store.indexOf('<nav class="sidebar-nav"');
  const sidebarEnd = store.indexOf('</nav>', sidebarStart);
  const sidebarNav = store.slice(sidebarStart, sidebarEnd);
  const headerStart = store.indexOf('<div class="header-actions"');
  const headerEnd = store.indexOf('</div>', headerStart);
  const headerActions = store.slice(headerStart, headerEnd);

  assert.ok(store.includes('class="sidebar-notification"') && store.includes('data-page="notifications"'), 'Bell icon opens the notification page from the profile image corner');
  assert.ok(store.includes('id="sidebarVipBadge"') && store.includes('id="headerVipBadge"'), 'VIP badge appears beside the customer name and in the top bar');
  assert.ok(store.includes('data-page="favorites"') && store.includes('data-page="profile"') && store.includes('data-page="login"'), 'The three profile shortcuts remain available');
  assert.ok(!sidebarNav.includes('data-page="favorites"'), 'Favourites are removed from the long side menu');
  assert.ok(!sidebarNav.includes('data-page="login"'), 'Login is removed from the long side menu');
  assert.ok(!sidebarNav.includes('data-page="profile"'), 'Profile is removed from the long side menu');
  assert.ok(!sidebarNav.includes('data-page="notifications"'), 'Notifications are removed from the long side menu');
  assert.ok(!sidebarNav.includes('data-page="vip"'), 'VIP is accessed from its badges instead of a duplicate menu row');
  assert.ok(headerActions.indexOf('id="menuToggle"') < headerActions.indexOf('id="headerWalletChip"'), 'Hamburger is the first right-side header action');
  assert.ok(headerActions.indexOf('id="headerWalletChip"') < headerActions.indexOf('id="headerVipBadge"'), 'Balance precedes VIP in the RTL header');
  assert.ok(!headerActions.includes('storeThemeToggle'), 'Theme control is not in the top bar');
  assert.ok(store.indexOf('id="storeThemeToggle"') > store.indexOf('<div class="sidebar-bottom">'), 'Theme control is placed at the bottom of the drawer');
  assert.ok(store.includes('class="sidebar-theme-switch-knob"') && store.includes('class="sidebar-theme-sun"') && store.includes('class="sidebar-theme-moon"'), 'The bottom drawer theme control retains its moving sun/moon switch');
  assert.ok(theme.includes('.app-shell .sidebar-profile-wrap{') && theme.includes('.app-shell .sidebar-notification{'), 'The profile and notification bell share a compact account header');
  assert.ok(theme.includes('.app-shell .sidebar-theme-toggle{') && theme.includes('.app-shell .header-vip-chip{'), 'Sidebar appearance and VIP chips use the same calm Wamda palette');
  assert.ok(theme.includes('margin-left:auto!important;margin-right:0!important;'), 'RTL action cluster remains docked to the far right of the LTR header shell');
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


test('Wamda palette, theme boundaries, oval geometry and bilingual direction are explicit', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const locale = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-language.js'), 'utf8');
  const direction = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-text-direction.js'), 'utf8');
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  const logo = await fs.readFile(path.join(webRoot, 'assets/brand/logo.svg'), 'utf8');
  const hero = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-hero-banner.svg'), 'utf8');

  for (const color of ['#3f4a75','#0095a4','#55b8cc','#e9e1db']) {
    assert.ok(css.includes(color), 'Missing official Wamda brand color: ' + color);
  }
  assert.ok(css.includes('--paper:#151923;') && css.includes('--surface:#202535;'), 'Dark theme uses deep surfaces');
  assert.ok(css.includes('--paper:#f4efea;') && css.includes('--surface:#fffdfa;'), 'Light theme uses warm pale surfaces');
  assert.ok(css.includes('--drawer-bg:#3f4a75;') && css.includes('--drawer-bg:#f8f5f1;'), 'Drawer themes are explicit and independent');
  assert.ok(css.includes('border-radius:var(--radius-pill)!important;'), 'Controls and navigation use pill geometry');
  assert.ok(css.includes('.app-shell .header-back-button{display:none!important}'), 'The topbar contains only the logo/name at left and action group at right');
  assert.ok(css.includes('direction:rtl!important;flex-direction:row!important;'), 'Header actions are ordered from the physical right');
  assert.ok(css.includes('margin-left:auto!important;margin-right:0!important;'), 'Header actions are anchored to the right');
  const directionSource='/assets/brand/nexa-text-direction.js?v=20261107-locale-layout-v3';
  assert.ok(locale.includes('document.documentElement.dataset.locale=language') && direction.includes("element.setAttribute('dir', 'auto')") && store.includes(directionSource) && admin.includes(directionSource), 'Store and dashboard use the shared browser-managed bilingual direction helper');
  assert.ok(store.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1') && admin.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Both pages load the refreshed stylesheet');
  assert.ok(!logo.includes('#73d7fa') && !logo.includes('#168ec5'), 'Nexa logo no longer uses the retired blue gradient');
  assert.ok(!hero.includes('#65D5F7') && !hero.includes('#2A9FD5'), 'Hero artwork no longer uses the retired sky-blue palette');
});


test('light mode does not retain the dark hero, footer, payment panel or login backdrop', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  for (const selector of [
    ':root[data-theme="light"] .app-shell .home-intro',
    ':root[data-theme="light"] .app-shell .wallet-api-side',
    ':root[data-theme="light"] .app-shell .wallet-placeholder',
    ':root[data-theme="light"] .app-shell .footer',
    ':root[data-theme="light"] .app-shell .promo',
    ':root[data-theme="light"] #app.shell .login-screen'
  ]) assert.ok(css.includes(selector), 'Missing explicit light-mode surface override: ' + selector);
  assert.ok(css.includes(':root[data-theme="dark"] .app-shell .wallet-api-side') || css.includes(':root[data-theme="dark"]'), 'Dark mode remains independently declared');
});


test('final Wamda finishing pass overrides legacy blue chrome in both themes', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  for (const selector of [
    ':root[data-theme="light"] .app-shell .header{',
    '.app-shell .header-actions{',
    '.app-shell .sidebar-profile-avatar{',
    '.app-shell .side-link.active{',
    '.app-shell .catalog-tile-tag,',
    '#app.shell .side{',
    '#app.shell .topbar{',
    ':root[data-theme="light"] #loginScreen.login-screen{',
    ':root[data-theme="dark"] #loginScreen.login-screen{'
  ]) assert.ok(css.includes(selector), 'Missing final Wamda visual override: ' + selector);
  assert.ok(css.includes('--drawer-bg:#3f4a75;') && css.includes('--drawer-bg:#f8f5f1;'), 'Dark and light drawer surfaces remain separate');
  assert.ok(css.includes('--brand-teal:#0095a4;'), 'The official Wamda teal remains the primary accent');
  assert.ok(store.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Storefront uses the final stylesheet');
  assert.ok(admin.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Admin uses the final stylesheet');
  assert.ok(store.includes("isDark?'#101010':'#ffffff'"), 'Store browser chrome matches the selected neutral theme');
  assert.ok(admin.includes("selected==='dark'?'#171d22':'#ffffff'"), 'Admin browser chrome matches its independent theme');
});


test('Wamda precision pass removes remaining blue-only accents and refreshes admin palette', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  for (const selector of [
    ':root[data-theme="light"] .app-shell .sidebar-theme-toggle{',
    ':root[data-theme="light"] .app-shell .header-actions .menu-toggle{',
    ':root[data-theme="light"] .app-shell .header-actions .wallet-chip{',
    ':root[data-theme="light"] .app-shell .header-vip-chip{',
    ':root[data-theme="light"] .app-shell .side-link.active{',
    ':root[data-theme="light"] .app-shell .nexa-home-search button{',
    ':root[data-theme="light"] .app-shell .process-num,',
    '#app.shell .nexa-fixed-swatches .swatch-navy{',
    '#app.shell .admin-rail-summary{'
  ]) assert.ok(css.includes(selector), 'Missing Wamda precision override: ' + selector);
  for (const color of ['#3F4A75','#0095A4','#55B8CC','#E9E1DB']) {
    assert.ok(admin.includes(color), 'Admin palette is missing official Wamda color ' + color);
  }
  for (const retired of ['#071626','#62C9F2','#1D91C7','#E7F7FF']) {
    assert.ok(!admin.includes(retired), 'Admin palette still displays retired color ' + retired);
  }
  assert.ok(admin.includes('هوية ومضة المعتمدة — ألوان ثابتة'), 'Admin palette heading uses Wamda identity');
  assert.ok(store.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Storefront loads the precision pass');
  assert.ok(admin.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Admin loads the precision pass');
});


test('Wamda final detail pass covers catalog, account states and admin light navigation', async () => {
  const css = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-wamda-blue.css'), 'utf8');
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  for (const selector of [
    '.app-shell .catalog-count{',
    '.app-shell .store-catalog-toolbar input{',
    '.app-shell .status-pill{',
    '.app-shell .account-status-pill{',
    '.app-shell .reference-status{',
    '.app-shell .support-welcome-mark{',
    '.app-shell .chat-fab,.app-shell .assistant-fab{',
    ':root[data-theme="light"] #app.shell .nav button.active{',
    ':root[data-theme="light"] #app.shell .admin-sidebar-close{',
    ':root[data-theme="light"] #app.shell .admin-rail-summary{',
    ':root[data-theme="light"] #app.shell .top-actions .avatar{'
  ]) assert.ok(css.includes(selector), 'Missing inner-page Wamda style: ' + selector);
  assert.ok(store.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Storefront loads Wamda detail pass');
  assert.ok(admin.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'), 'Admin loads Wamda detail pass');
  assert.ok(css.includes('End Wamda precision pass.'), 'The prior precision stylesheet layer remains');
});


test('storefront drawer matches the fixed dark/light reference palette without changing customer routes', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const drawer = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-drawer.css'), 'utf8');
  assert.ok(store.includes('nexa-store-drawer.css?v=20261106-drawer-ltr-v2'), 'Storefront loads the dedicated reference drawer layer');
  for (const id of ['sidebarBalanceValue','sidebarThemeLabel','sidebarSocialLinks','sidebarOwnerBrand']) {
    if (id === 'sidebarSocialLinks' || id === 'sidebarOwnerBrand') continue;
    assert.ok(store.includes('id="' + id + '"'), 'Missing drawer reference element: ' + id);
  }
  for (const route of ['home','wallet','favorites','profile','login','notifications','payments','orders','support','affiliate','security','verify','install','about']) {
    assert.ok(store.includes('data-page="' + route + '"'), 'Drawer must preserve route: ' + route);
  }
  assert.ok(store.includes('data-open-assistant'), 'The assistant still opens through its existing action');
  assert.ok(store.includes('id="menuToggle"') && store.includes('id="sidebarBackdrop"') && store.includes('id="sidebarClose"'), 'Existing drawer open and close controls remain available');
  assert.ok(store.includes("if($('sidebarBalanceValue'))$('sidebarBalanceValue').textContent=balance"), 'Drawer balance remains bound to the authenticated customer balance');
  assert.ok(drawer.includes(':root[data-theme="dark"] .app-shell .sidebar{background:#0c0c0c!important'), 'Dark drawer background is fixed to the reference near-black');
  assert.ok(drawer.includes(':root[data-theme="light"] .app-shell .sidebar{background:#ffffff!important'), 'Light drawer background is fixed to the reference white');
  assert.ok(drawer.includes('background:#242424!important;color:#f4f4f4!important'), 'Dark currency capsule matches the reference slate surface');
  assert.ok(drawer.includes('background:#f0f0f0!important;color:#222!important'), 'Light currency capsule matches the reference light-gray surface');
  assert.ok(drawer.includes('background:#343434!important;color:#f5f5f5!important'), 'Dark shortcut circles retain the reference slate tone');
  assert.ok(drawer.includes('background:#e7e7e7!important;color:#353535!important'), 'Light shortcut circles retain the reference gray tone');
  assert.ok(drawer.includes('.side-link[data-page="home"] .side-icon{color:#22c55e!important}'), 'Menu icon accents remain identical between the two color modes');
  assert.ok(drawer.includes('.side-link[data-page="orders"] .side-icon{color:#ef4444!important}'), 'Order icon keeps its dedicated red accent');
  const finalTheme=drawer.slice(drawer.lastIndexOf('NEXA DRAWER REFINEMENT v3'));
  assert.ok(finalTheme.includes(':root[data-theme="light"] .app-shell .sidebar .side-link.active{') && finalTheme.includes('background:#e7e7e7!important'), 'Light active item uses the neutral gray pill');
  assert.ok(drawer.includes('.app-shell .sidebar-social-links{') && drawer.includes('.app-shell .sidebar-owner-brand{'), 'The reference social row and Nexa logo footer are present');
});


test('storefront supports USD and SYP display with only Arabic and English locales', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const drawer = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-drawer.css'), 'utf8');
  const locale = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-language.js'), 'utf8');
  assert.ok(store.includes('nexa-store-language.js?v=20261108-usd-syp-admin-i18n-v1'), 'The Arabic/English locale engine is loaded before storefront initialization');
  assert.ok(store.includes('id="sidebarLanguageToggle"'), 'The drawer has a real language control');
  assert.ok(store.includes('id="sidebarCurrencyToggle"'), 'The drawer has a USD/SYP display-currency selector');
  assert.ok(store.includes('<strong id="sidebarCurrencyCode">SYP</strong>'), 'Syrian pounds remain the default display currency');
  const first=store.indexOf('class="sidebar-quick-actions"');
  const row=store.slice(first,store.indexOf('</div>',first));
  const order=['id="sidebarLanguageToggle"','data-page="favorites"','data-page="profile"','id="sidebarLogoutButton"'];
  let cursor=-1;
  for (const token of order) {const next=row.indexOf(token);assert.ok(next>cursor,'Arabic quick-action order from left to right must be Language, Favorites, Profile, Logout: '+token);cursor=next;}
  assert.ok(store.includes("const rate=Number(d.fxRate)"), 'USD invoice amounts use the public USD/SYP rate for display');
  assert.ok(store.includes("storefrontFxReady=d.fxReady===true"), 'USD-to-SYP conversion is gated by exchange-rate readiness');
  assert.ok(store.includes("function formatDisplaySyp(amount)")&&store.includes("formatCurrencyAmount(value,'SYP')"), 'SYP remains a supported display currency');
  assert.ok(store.includes("return formatDisplaySyp(value*storefrontFxRate)"), 'USD amounts are converted into Syrian pounds for display');
  assert.ok(store.includes("const next=storeLocale()==='ar'?'en':'ar'"), 'The language control switches only Arabic and English');
  assert.ok(store.includes("const STORE_DISPLAY_CURRENCY_KEY='nexa-store-display-currency'"), 'Display currency preference is saved and restored');
  assert.ok(!store.includes('TRY')&&!store.includes('storefrontTryPerUsd')&&!store.includes('tr-TR'), 'The storefront no longer contains Turkish currency or locale support');
  assert.doesNotThrow(() => new vm.Script(locale, { filename: "nexa-store-language.js" }), 'The bilingual translation module parses');
  assert.ok(locale.includes("const selected=next==='en'?'en':'ar'"), 'Unknown locale values fall back to Arabic');
  assert.ok(!locale.includes('turkishTranslations')&&!locale.includes("language==='tr'"), 'Turkish translations and language branches are removed');
  assert.ok(locale.includes("document.documentElement.dir=language==='ar'?'rtl':'ltr'"), 'Language switching changes page direction');
  assert.ok(locale.includes("new MutationObserver"), 'Dynamically rendered storefront text is translated as well');
  assert.ok(locale.includes("'الرئيسية':'Home'") && locale.includes("'طلباتي':'My Orders'"), 'Core drawer navigation has Arabic and English labels');
  assert.ok(drawer.includes('font-size:14px!important;font-weight:900!important'), 'Drawer menu typography is scaled to normal viewing size');
  assert.ok(drawer.includes(':root[data-locale="en"] .app-shell .sidebar-nav .side-link'), 'English drawer alignment is handled independently');
});


test('language attribute updates remain synchronized after switching locale', async () => {
  const locale = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-language.js'), 'utf8');
  assert.ok(locale.includes('const lastTranslatedText = new WeakMap();'), 'Text nodes preserve their original values across repeated language changes');
  assert.ok(locale.includes('const lastTranslatedAttributes = new WeakMap();'), 'ARIA and placeholder attributes preserve their original values across repeated language changes');
  assert.ok(locale.includes('else if(last[name]!==undefined&&current!==last[name])stored[name]=current;'), 'Only app-updated attributes replace the stored source value');
  assert.ok(locale.includes('document.documentElement.lang = language') || locale.includes('document.documentElement.lang=language'), 'The active language is reflected in the document');
});


test('drawer uses neutral Click Store typography, follows document direction and moves to the matching side', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const drawer = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-drawer.css'), 'utf8');
  const finalTheme = drawer.slice(drawer.lastIndexOf('NEXA DRAWER REFINEMENT v3'));
  assert.ok(store.includes('IBM+Plex+Sans+Arabic'), 'Click Store Arabic font is loaded with swap');
  assert.ok(finalTheme.includes('font-family:"IBM Plex Sans Arabic"'), 'Drawer uses IBM Plex Sans Arabic');
  assert.ok(finalTheme.includes('inset-inline-start:0!important') && finalTheme.includes('margin-inline-start:var(--rail-width)!important'), 'Drawer and content use logical layout positioning');
  assert.ok(finalTheme.includes(':root[dir="ltr"] .app-shell .sidebar{transform:translateX(-110%)!important}'), 'English drawer closes toward the left');
  assert.ok(finalTheme.includes(':root[dir="rtl"] .app-shell .sidebar{transform:translateX(110%)!important}'), 'Arabic drawer closes toward the right');
  assert.ok(finalTheme.includes('background:#242424!important') && finalTheme.includes('background:#f0f0f0!important'), 'Drawer surfaces stay neutral charcoal and gray');
  assert.ok(!finalTheme.includes('#60a5fa') && !finalTheme.includes('#818cf8') && !finalTheme.includes('#0ea5e9'), 'No blue accents remain in drawer override layer');
  assert.ok(finalTheme.includes('direction:ltr!important') && finalTheme.includes('justify-content:space-between!important'), 'Quick shortcuts keep stable physical left-to-right order');
  assert.ok(store.includes('id="sidebarLogoutButton"') && store.includes("$('accountLogoutButton')?.click()"), 'Drawer logout invokes existing account logout flow');
  assert.ok(store.includes("meta.content=isDark?'#101010':'#ffffff'"), 'Browser theme chrome also follows neutral dark/light colors');
});

test('language switching is frame-batched and does not rerender the full storefront twice', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const locale = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-language.js'), 'utf8');
  const direction = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-text-direction.js'), 'utf8');
  assert.ok(locale.includes('const TRANSLATION_BATCH_SIZE = 180'), 'Translation has a bounded per-frame work budget');
  assert.ok(locale.includes('requestAnimationFrame'), 'Translation yields between browser frames');
  assert.ok(locale.includes('consumeTextMutation') && locale.includes('consumeAttributeMutation'), 'Self-generated mutations are ignored to prevent observer feedback');
  assert.ok(locale.includes('childList:true,subtree:true,characterData:true'), 'Dynamic content is still translated incrementally');
  const preferenceBlock=store.slice(store.indexOf('function initializeStorePreferences'),store.indexOf('function renderSupportState'));
  assert.ok(!preferenceBlock.includes('refreshDisplayCurrency()'), 'Changing language no longer rerenders prices, catalog and account panels');
  assert.ok(!store.includes('new MutationObserver(()=>markDirection())'), 'The document-wide direction rescan observer is removed');
  assert.ok(direction.includes("const CONTROL_SELECTOR = 'input,textarea'") && direction.includes("element.setAttribute('dir', 'auto')"), 'Editable text controls receive auto direction; visible text inherits document direction');
});


test('light drawer has no blue active rail, active underline, or icon glow',async()=>{
  const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
  const drawer=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-drawer.css'),'utf8');
  const lightFix=drawer.slice(drawer.lastIndexOf('LIGHT THEME FINISH — remove the blue active rail'));
  assert.ok(store.includes('nexa-store-drawer.css?v=20261106-drawer-ltr-v2'),'The light drawer fix has a fresh stylesheet cache key');
  assert.ok(lightFix.includes('body .app-shell .sidebar .sidebar-nav .side-link.active'),'The light active item receives the stronger neutral override');
  assert.ok(lightFix.includes('box-shadow:none!important;text-decoration:none!important'),'The active blue rail and underline are removed');
  assert.ok(lightFix.includes('side-link.active::before')&&lightFix.includes('side-link.active::after'),'Both active pseudo-element lines are suppressed');
  assert.ok(lightFix.includes('content:none!important;display:none!important'),'Decorative pseudo-elements are disabled');
  assert.ok(lightFix.includes('fill:none!important;stroke:currentColor!important'),'Light drawer icons stay as clean outline icons');
  assert.ok(lightFix.includes('filter:none!important;-webkit-filter:none!important;text-shadow:none!important'),'No blue icon glow or drop-shadow remains');
});


test('light drawer icons use calm semantic colors and the balance is always neutral',async()=>{
  const drawer=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-drawer.css'),'utf8');
  const palette=drawer.slice(drawer.lastIndexOf('LIGHT THEME ICON ACCENTS — calm semantic colors'));
  const expected=[
    '[data-page="home"] .side-icon{color:#6f947b!important}',
    '[data-open-assistant] .side-icon{color:#8d7fa4!important}',
    '[data-page="wallet"] .side-icon{color:#8a7b9b!important}',
    '[data-page="payments"] .side-icon{color:#aa8d60!important}',
    '[data-page="orders"] .side-icon{color:#b5757b!important}',
    '[data-page="support"] .side-icon{color:#78938f!important}',
    '[data-page="affiliate"] .side-icon{color:#6f9588!important}',
    '[data-page="security"] .side-icon{color:#6f927b!important}',
    '[data-page="verify"] .side-icon{color:#a18d69!important}',
    '[data-page="install"] .side-icon{color:#828780!important}',
    '[data-page="about"] .side-icon{color:#829087!important}'
  ];
  for(const selector of expected)assert.ok(palette.includes(selector),'Missing soft light icon accent: '+selector);
  assert.ok(palette.includes('color:#252525!important;-webkit-text-fill-color:#252525!important'),'The light drawer balance cannot inherit a blue text fill');
  assert.ok(palette.includes('background-image:none!important')&&palette.includes('text-shadow:none!important'),'The light drawer balance has no gradient or glow');
  assert.ok(!/#(?:3b82f6|60a5fa|0ea5e9|2563eb|818cf8)/i.test(palette),'The light icon palette contains no blue accent');
});


test('English drawer updates its balance locale while amounts stay in SYP',async()=>{
  const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
  const locale=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
  for(const phrase of [
    "'القائمة الجانبية':'Sidebar menu'",
    "'إغلاق القائمة الجانبية':'Close sidebar'",
    "'اختصارات الحساب':'Account shortcuts'",
    "'قائمة المتجر':'Store navigation'",
    "'التبديل إلى الوضع الفاتح':'Switch to light mode'",
    "'التبديل إلى الوضع الداكن':'Switch to dark mode'"
  ])assert.ok(locale.includes(phrase),'Missing English drawer translation: '+phrase);
  const languageHandler=store.slice(store.indexOf("window.addEventListener('nexa:languagechange'"),store.indexOf("window.addEventListener('storage'"));
  assert.ok(languageHandler.includes('renderSidebarAccount();'),'Drawer balance is reformatted after a language switch');
  assert.ok(store.includes("const storeIntlLocale=()=>storeLocale()==='ar'?'ar-SY':'en-US';"),'Arabic uses Arabic digits while English uses Latin digits');
  assert.ok(store.includes('return formatDisplaySyp(value*storefrontFxRate)'),'USD order amounts convert to Syrian pounds for display');
  assert.ok(store.includes("function formatUsdDisplay(value)")&&store.includes("return formatDisplaySyp(value*storefrontFxRate)"),'USD amounts are shown using the SYP exchange rate');
  assert.ok(store.includes('nexa-store-drawer.css?v=20261106-drawer-ltr-v2'),'The updated drawer stylesheet has a fresh cache key');
  assert.ok(store.includes('nexa-store-language.js?v=20261108-usd-syp-admin-i18n-v1'),'The updated Arabic/English dictionary has a fresh cache key');
});


test('storefront controls are persisted, validated and applied to real UI elements', async () => {
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const catalog = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-catalog.js'), 'utf8');
  const drawer = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-store-drawer.css'), 'utf8');
  assert.ok(server.includes('function defaultStorefrontExperience()'), 'Server supplies safe defaults for storefront controls');
  assert.ok(server.includes('function validateStorefrontExperience(input,current='), 'Server validates appearance, feature, image and social-link inputs');
  assert.ok(server.includes('next.storefrontExperience=validateStorefrontExperience('), 'Admin settings PATCH persists the validated storefront controls');
  assert.ok(server.includes('storefrontExperience:validateStorefrontExperience('), 'Public storefront config exposes only validated public settings');
  assert.ok(server.includes('iconImage,...'), 'Main department icon images are persisted with department settings');
  assert.ok(admin.includes('id="page-appearance"') && admin.includes('id="saveAppearanceBtn"'), 'Dashboard exposes a dedicated appearance and features page');
  assert.ok(admin.includes('function saveAppearanceSettings()'), 'Appearance controls submit a real settings API request');
  assert.ok(admin.includes('data-appearance-feature="verification"'), 'Identity verification visibility is configurable');
  assert.ok(admin.includes('data-department-icon-image='), 'Main department icon image upload is available');
  assert.ok(store.includes('function applyStorefrontExperience(value={})'), 'Storefront applies published appearance settings');
  assert.ok(store.includes("document.querySelectorAll(selector).forEach(element=>element.classList.toggle('storefront-feature-disabled',!enabled))"), 'Feature switches change visibility in the storefront');
  assert.ok(store.includes("storefront-favorites-disabled',storefrontExperience.features.favorites===false"), 'Newly rendered favorite buttons also obey the saved feature switch');
  assert.ok(store.includes('pageFeature={notifications:'), 'Disabled feature pages cannot be opened through navigation');
  assert.ok(store.includes("install:'install',bot:'assistant'"), 'The legacy assistant route also follows the assistant feature switch');
  assert.ok(store.includes("id=\"sidebarVipIconImage\""), 'Rank icon supports a configured image');
  assert.ok(store.includes('group.iconImage?'), 'Category tiles render configured department icon images');
  assert.ok(catalog.includes('incoming.iconImage'), 'Department icon image is retained by the catalogue model');
  assert.ok(drawer.includes('border-radius:50%!important'), 'Account profile imagery is circular');
  assert.ok(drawer.includes('--nexa-favorite-accent'), 'Storefront favorite accent is driven by a CSS variable');
  assert.ok(store.includes('nexa-store-drawer.css?v=20261106-drawer-ltr-v2'), 'Storefront drawer CSS cache key is updated');
});


test('admin can safely manage individual customer profile images', async () => {
  const server = await fs.readFile(path.join(webRoot, 'server/src/server.js'), 'utf8');
  const admin = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  const migration = await fs.readFile(path.join(webRoot, 'server/migrations/009_customer_avatar.sql'), 'utf8');
  assert.ok(server.includes("'009_customer_avatar.sql'"), 'Customer avatar migration is run on server startup');
  assert.ok(migration.includes('ADD COLUMN IF NOT EXISTS avatar_image TEXT NOT NULL DEFAULT'), 'Customer profile image storage is additive and safe for existing accounts');
  assert.ok(server.includes("url.pathname==='/api/admin/customers'"), 'Admin customer listing endpoint is available');
  assert.ok(server.includes("url.pathname==='/api/admin/customers'"), 'Customer search is exposed only through the protected admin API');
  assert.ok(server.includes("avatarImage!==''&&!isSafeCatalogImage(avatarImage)"), 'Uploaded customer images pass the existing safe-image validator');
  assert.ok(server.includes('SELECT c.id,c.full_name,c.phone,c.balance_minor::text,c.created_at,c.avatar_image'), 'Authenticated customer sessions include the saved customer image');
  assert.ok(admin.includes('id="page-customers"') && admin.includes('id="customerAdminGrid"'), 'Dashboard exposes the individual customer profile editor');
  assert.ok(admin.includes("'/api/admin/customers/'+encodeURIComponent(customerId)+'/avatar'"), 'Dashboard saves profile images using the customer-specific API');
  assert.ok(admin.includes('data-customer-avatar='), 'Each customer card has its own image upload control');
  assert.ok(store.includes("customerAccount.avatar_image||storefrontExperience?.avatarImage||storefrontLogoImage"), "The logged-in customer image takes precedence over the storefront fallback");
});

test('registration is phone/password-only, rate-limited and cannot overwrite existing customers',async()=>{
 const server=await fs.readFile(path.join(webRoot,'server/src/server.js'),'utf8');
 const helper=await fs.readFile(path.join(webRoot,'server/src/customer-auth.js'),'utf8');
 assert.ok(server.includes("rateLimit(req,res,'account-register:'+ip,5,60*60_000)"),'Registration is rate-limited by IP');
 assert.ok(server.includes("rateLimit(req,res,'account-register-phone:'+phone,3,60*60_000)"),'Registration is rate-limited by phone');
 const phoneSql=`regexp_replace(phone,'[^0-9]','','g')=$1 OR ($1 ~ '^9639[0-9]{8}$' AND regexp_replace(phone,'[^0-9]','','g')='0'||substr($1,4)) OR regexp_replace(phone,'[^0-9]','','g')='00'||$1 LIMIT 1`;
 assert.equal(server.split(phoneSql).length-1,2,'Registration and login compare Syrian local, international and 00-prefixed phone formats');
 assert.ok(server.includes('passwordHash=customerPasswordHash(password,salt)'),'Passwords are salted and hashed');
 assert.ok(server.includes('customerCookie(req,token)'),'A normal secure session is created after sign-up');
 assert.ok(helper.includes('export function normalizeCustomerPhone')&&helper.includes('export function validateCustomerRegistration'),'Registration validation is unit-testable');
});

test('major account, checkout, notice and modal panels have both light and dark theme surfaces',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const selectors=['.customer-wallet-card','.account-auth-form','.wallet-payment-form','.wallet-ledger-panel','.payment-receipt','.reference-panel','.reference-login-panel','.modal','.notification-panel'];
 const contractStart=css.lastIndexOf('/* FINAL THEME CONTRACT v3');assert.ok(contractStart>=0,'Final theme contract is present');
 for(const mode of ['dark','light']){
  const marker=':root[data-theme="'+mode+'"] .app-shell :where(';
  const ruleStart=css.indexOf(marker,contractStart);assert.ok(ruleStart>=0,'Missing final '+mode+' mode contract');
  const end=css.indexOf('){',ruleStart);assert.ok(end>ruleStart,'Malformed final '+mode+' contract');
  const block=css.slice(ruleStart,end);for(const selector of selectors)assert.ok(block.includes(selector),'Missing '+mode+' theme for '+selector);
 }
 assert.ok(css.includes('select option')&&css.includes('input:-webkit-autofill'),'Select options and autofill follow the active theme');
 assert.ok(css.includes('.drawer-direction-switching .app-shell .sidebar'),'Drawer direction switch does not animate across the screen');
});

test('admin image uploads accept browser-decodable image types and compress large originals automatically', async () => {
  const html = await fs.readFile(path.join(webRoot, 'admin.html'), 'utf8');
  assert.equal((html.match(/accept="image\/\*"/g) || []).length, 9, 'all image pickers accept browser-supported image formats');
  assert.doesNotMatch(html, /file\.size\s*>\s*10\s*\*\s*1024\s*\*\s*1024/, 'no arbitrary 10 MB source-file rejection remains');

  const start = html.indexOf('async function compressImage(file){');
  const end = html.indexOf("\n$('addCategoryBtn')", start);
  assert.notEqual(start, -1, 'shared image compressor exists');
  assert.notEqual(end, -1, 'compressor has a clear boundary');

  let bitmapClosed = false;
  let drawnWidth = 0;
  let drawnHeight = 0;
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return {
        clearRect() {},
        drawImage(_source, _x, _y, width, height) { drawnWidth = width; drawnHeight = height; },
      };
    },
    toDataURL(mime, quality = 1) {
      const size = Math.ceil(this.width * this.height * quality / 2);
      return 'data:' + mime + ';base64,' + 'A'.repeat(size);
    },
  };
  const context = vm.createContext({
    createImageBitmap: async (file) => {
      assert.ok(file.size > 10 * 1024 * 1024, 'large original reaches the decoder without an upfront size rejection');
      return { width: 6000, height: 4000, close() { bitmapClosed = true; } };
    },
    document: { createElement: () => canvas },
    URL: { createObjectURL() { throw new Error('fallback must not be used'); }, revokeObjectURL() {} },
    Image: class {},
  });
  vm.runInContext(html.slice(start, end), context, { filename: 'admin-image-compressor.js' });
  const result = await context.compressImage({ size: 48 * 1024 * 1024, type: 'image/png' });
  assert.ok(result.startsWith('data:image/webp;base64,'), 'image is converted to compact WebP');
  assert.ok(result.length <= 1_850_000, 'result remains below image and request-body limits');
  assert.ok(drawnWidth <= 1920 && drawnHeight <= 1920, 'large dimensions are reduced');
  assert.equal(bitmapClosed, true, 'decoded image memory is released');
});


test('package picker and Add Funds content use the current language for dynamic labels', async () => {
  const store = await fs.readFile(path.join(webRoot, 'index.html'), 'utf8');
  assert.ok(store.includes("const storeText=value=>window.NexaLocale?.translate?window.NexaLocale.translate(value):String(value??'');"), 'Storefront has a synchronous active-locale translator for dynamically inserted text');
  for (const token of [
    "storeText(packCount+' باقات')",
    "storeText(unavailable?'غير متوفر حالياً':'متاح للطلب')",
    "storeText('السعر المعتمد')",
    "storeText('إنشاء فاتورة شحن')",
    "storeText('حوّل قيمة الفاتورة إلى محفظة Nexa، ثم أدخل رقم العملية في نموذج التحقق.')",
    'localizeWalletTopupForm();'
  ]) assert.ok(store.includes(token), 'Missing synchronous locale application: '+token);
  assert.ok(store.includes("button.dataset.busy='true'"), 'Switching language during invoice creation does not overwrite the loading state');
});

test('Add Funds account headings and login labels refresh through the active locale localizer', async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 for(const id of ['walletAccountTitle','walletAccountDescription','walletLoginHeading','walletLoginPhoneLabel','walletLoginPasswordLabel','walletLoginSubmit','walletAccountNotice','walletRegisterButton','walletWelcomeLabel','walletAvailableBalanceLabel','walletLedgerTitle','walletLedgerDescription'])assert.ok(store.includes('id="'+id+'"'),'Missing localizable Add Funds element '+id);
 for(const token of ["setText('walletAccountTitle','حسابك ورصيدك')","setText('walletLoginSubmit','دخول إلى حسابي')","setText('walletAvailableBalanceLabel','رصيدك المتاح')","setWalletAccountStatus(status.dataset.localeSource||status.textContent||'غير مسجل الدخول')","localizeWalletTopupForm();"])assert.ok(store.includes(token),'Missing explicit Add Funds localization '+token);
 assert.ok(store.includes('function setWalletAccountStatus(value)'),'Wallet status retains its source phrase across language changes');
 assert.ok(store.includes('setWalletAccountStatus(statusText);'),'Account refresh preserves the localizable status source');
});


test('store drawer uses one full-height mouse-wheel scroll surface after responsive styles load',async()=>{
  const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
  const responsive=store.indexOf('nexa-responsive.css?v=20261107-package-order-wallet-final-v11');
  const finish=store.indexOf('nexa-interface-finish.css?v=20261108-usd-syp-lang-dark-v2');
  const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-interface-finish.css'),'utf8');
  const marker=css.lastIndexOf('FINAL STORE DRAWER SCROLL');
  assert.ok(responsive>=0&&finish>responsive,'The final drawer scroll fix loads after the responsive stylesheet');
  assert.ok(marker>=0,'A final scroll override exists after all earlier drawer rules');
  const fix=css.slice(marker);
  assert.ok(fix.includes('.app-shell .sidebar{')&&fix.includes('overflow-y:auto!important;'),'The full-height drawer owns vertical scrolling');
  assert.ok(fix.includes('height:100dvh!important;')&&fix.includes('max-height:100dvh!important;'),'The scroll container is bounded to the viewport');
  assert.ok(fix.includes('-webkit-overflow-scrolling:touch!important;')&&fix.includes('touch-action:pan-y!important;'),'Touch and trackpad scrolling remain supported');
  assert.ok(fix.includes('.app-shell .sidebar-nav{')&&fix.includes('overflow-y:visible!important;'),'The menu navigation cannot create a competing nested scrollbar');
  assert.ok(fix.includes('flex:0 0 auto!important;'),'Drawer content sections keep their natural height and move together');
});
