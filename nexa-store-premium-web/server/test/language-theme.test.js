import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,'../../');

test('storefront language engine translates static and dynamic text, attributes and digits',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'nexa-store-language.js'}));
 const sandbox={
  window:{addEventListener(){},dispatchEvent(){},requestAnimationFrame(){return 1}},
  document:{
   documentElement:{dataset:{},set lang(value){this.language=value},set dir(value){this.direction=value}},
   body:{nodeType:1,matches(){return false},querySelectorAll(){return []}},
   querySelector(){return null},
   createTreeWalker(){return {nextNode(){return null}}}
  },
  localStorage:{getItem(){return null},setItem(){}},
  MutationObserver:class{observe(){}},
  NodeFilter:{SHOW_TEXT:4,SHOW_ELEMENT:1},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}
 };
 vm.runInNewContext(source,sandbox,{filename:'nexa-store-language.js'});
 sandbox.window.NexaLocale.initialize();
 sandbox.window.NexaLocale.setLanguage('en');
 const translate=sandbox.window.NexaLocale.translate;
 assert.equal(translate('صفحة ٢ من ٥'),'Page 2 of 5');
 assert.equal(translate('إنشاء فاتورة شحن ١٢'),'Create top-up invoice 12');
 assert.equal(translate('لا توجد طلبات حتى الآن.'),'No orders yet.');
 assert.equal(sandbox.document.documentElement.direction,'ltr');
 sandbox.window.NexaLocale.setLanguage('ar');
 assert.equal(translate('Order 27'),'طلب ٢٧');
 assert.equal(translate('No orders yet.'),'لا توجد طلبات حتى الآن.');
 assert.equal(translate('Full name'),'الاسم الكامل');
 assert.equal(translate('Card number'),'رقم البطاقة');
 assert.equal(translate('Electronic payment receipt'),'وصل دفع إلكتروني');
 assert.equal(translate('3 folders'),'٣ مجلدات');
 assert.equal(translate('3 مجلدات'),'3 folders');
 assert.equal(translate('Search by product name...'),'ابحث باسم المنتج...');
 assert.equal(translate('Page 2 of 5'),'صفحة ٢ من ٥');
 assert.equal(sandbox.document.documentElement.direction,'rtl');
 assert.ok(source.includes("const excludedSelector = 'script,style,code,pre,[data-no-translate]'"),
  'Input and textarea placeholders must remain eligible for attribute translation');
 assert.ok(source.includes('translationLookup[key]'),'The extended translation dictionary must be consulted');
 assert.ok(source.includes('document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT)'),
  'Placeholder/title/alt/aria-label attributes are traversed incrementally in animation-frame batches');
 assert.ok(!source.includes('root.querySelectorAll(attributeSelector)'),
  'Locale changes must not synchronously query every attribute in a large dashboard or catalogue subtree');
});

test('all Arabic static storefront text nodes have exact English dictionary entries',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const keys=new Set([...source.matchAll(/^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:/gm)]
  .map(match=>(match[1]||match[2]).replace(/\\'/g,"'")));
 const beforeScripts=store.slice(0,store.indexOf('<script src="/assets/brand/nexa-catalog.js'));
 const nodes=[...beforeScripts.matchAll(/>([^<>]+)</g)]
  .map(match=>match[1].replace(/\s+/g,' ').trim())
  .filter(value=>/[\u0600-\u06FF]/.test(value)&&value.length>1);
 const missing=[...new Set(nodes)].filter(value=>!keys.has(value));
 assert.deepEqual(missing,[],'Every static Arabic interface text node must have a direct English translation');
});

test('language direction updates first, then closes the drawer on the new RTL/LTR side',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const clickStart=store.indexOf("$('sidebarLanguageToggle')?.addEventListener('click'");
 const clickEnd=store.indexOf("$('sidebarLogoutButton')",clickStart);
 const clickHandler=store.slice(clickStart,clickEnd);
 const langStart=store.indexOf("window.addEventListener('nexa:languagechange'");
 const langEnd=store.indexOf("window.addEventListener('storage'",langStart);
 const langHandler=store.slice(langStart,langEnd);
 assert.ok(!clickHandler.includes('closeMenu(true)'),'The click handler must not close the drawer before changing dir');
 assert.ok(clickHandler.indexOf('NexaLocale?.setLanguage(next)')>=0,'Document direction changes before the close event');
 assert.ok(langHandler.includes('drawer-direction-switching')&&langHandler.includes('closeMenu(true)'),'The drawer closes once after direction changes');
 assert.ok(css.includes(':root[dir="ltr"] .app-shell .sidebar{'),'English uses a left-side drawer');
 assert.ok(css.includes('transform:translate3d(-110%,0,0)!important'),'The left-side drawer moves off-canvas in English');
 assert.ok(css.includes(':root[dir="rtl"] .app-shell .sidebar{'),'Arabic retains a right-side drawer');
 assert.ok(css.includes('drawer-direction-switching .app-shell .sidebar'),'The direction swap avoids cross-screen animation');
});

test('theme switch is a moving sun/moon control and storefront panels use theme variables',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const start=store.indexOf('id="storeThemeToggle"');
 const markup=store.slice(start,start+1400);
 assert.ok(markup.includes('sidebar-theme-switch'),'Theme switch track exists');
 assert.ok(markup.includes('sidebar-theme-switch-knob'),'Theme switch has a moving knob');
 assert.ok(markup.includes('sidebar-theme-sun')&&markup.includes('sidebar-theme-moon'),'Sun and moon icons are included');
 assert.ok(css.includes(':root[data-theme="dark"] .app-shell .sidebar .sidebar-theme-switch-knob'),'Dark mode moves knob to the moon side');
 assert.ok(css.includes(':root[data-theme="light"] .app-shell .sidebar .sidebar-theme-switch-knob'),'Light mode moves knob to the sun side');
 assert.ok(css.includes('background:var(--surface)!important;color:var(--ink)!important'),'Panels use active theme variables');
 assert.ok(store.includes("setStoreColorMode(document.documentElement.dataset.theme||'dark',{persist:false})"),
  'Theme labels are synchronized when language changes');
});

test('date and time output use the selected storefront locale instead of a fixed Arabic locale',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(!/\.toLocaleDateString\('ar-SY'/.test(store),'Date-only values must follow the selected language');
 assert.ok(!/\.toLocaleString\('ar-SY'/.test(store),'Date/time values must follow the selected language');
 assert.ok(!/new Intl\.DateTimeFormat\('ar-SY'/.test(store),'Explicit date formatters must follow the selected language');
 assert.ok(store.includes("storeLocale()==='en'?'en-US':'ar-SY'"),'Both supported storefront locales are selected dynamically');
});

test('account orders and favourites stay isolated from guest storage',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(store.includes('nexa-store-client:account:'),'account storage is namespaced by customer id');
 assert.ok(store.includes('nexa-store-client:guest'),'guest storage has its own namespace');
 assert.ok(store.includes('function visibleOrders(){return customerAccount?accountOrders:(storageRead().guestOrders||[])}'),'signed-in order history comes from account API results');
 assert.ok(store.includes('accountOrders=(orderData.orders||[])'),'account orders are held separately in memory');
 assert.ok(!store.includes('const saved=storageRead();saved.orders=orders;storageSave(saved)'),'account orders are not copied to guest local storage');
 assert.ok(store.includes("fetch('/api/account/preferences'"),'account favourites and preferences sync through the server');
});

test('desktop drawer labels refresh in the selected language',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const start=store.indexOf("window.addEventListener('nexa:languagechange'");const end=store.indexOf("window.addEventListener('storage'",start);
 const handler=store.slice(start,end);
 assert.ok(handler.includes('setStoreMenuState(isStoreMenuOpen(),false)'),'desktop drawer preserves open state and localizes aria-label');
 assert.ok(handler.includes('closeMenu(true)'),'mobile drawer closes and restores focus on language change');
});

test('visible number formatting follows the storefront language',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(!store.includes(".toLocaleString('en-US')"),'counts do not hard-code English locale');
 assert.ok(!store.includes("Intl.NumberFormat('en-US'"),'currency formatter follows selected locale');
 assert.ok(store.includes("storeLocale()==='en'?'en-US':'ar-SY'"),'both Arabic and English formats are selected');
});

test('dark checkout and notice surfaces use dark theme tokens',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 for(const selector of ['.wallet-payment-form','.wallet-payment-result','.wallet-invoice-meta','.catalog-note','.wallet-api-note','.support-ticket-result','.reference-warning-panel'])assert.ok(css.includes(selector),'missing dark styling for '+selector);
 assert.ok(css.includes('select option')&&css.includes('background-color:var(--surface-2)!important'),'native select options use dark surfaces');
});

test('repeated language toggles preserve source text and dynamic attributes',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.ok(source.includes('const lastTranslatedText = new WeakMap();'),'The source text node is preserved after translation');
 assert.ok(source.includes('const lastTranslatedAttributes = new WeakMap();'),'Original placeholder and label attributes remain recoverable');
 assert.ok(source.includes('else if(lastTranslated!==undefined&&current!==lastTranslated)'),'App-rendered text changes are distinguished from translations');
 assert.ok(source.includes('aria-description')&&source.includes('data-tooltip'),'Dynamic accessibility labels and tooltips are translated');
});


test('locale transition disables drawer motion before changing document direction',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const setStart=source.indexOf('function setLanguage(next');
 const before=source.indexOf('nexa:languagechange:before',setStart);
 const direction=source.indexOf('updateDocumentLanguage();',setStart);
 assert.ok(before>setStart&&direction>before,'The pre-change event fires before html direction is updated');
 const guard=store.indexOf("window.addEventListener('nexa:languagechange:before'");
 const changed=store.indexOf("window.addEventListener('nexa:languagechange'",guard);
 assert.ok(guard>=0&&changed>guard,'The drawer motion guard is registered before the post-change handler');
 assert.ok(store.slice(guard,changed).includes("classList.add('drawer-direction-switching')"),
  'Drawer transitions are disabled while the old physical side is still active');
});

test('final drawer state rules preserve RTL and LTR open/closed states on desktop and mobile',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const final=css.slice(css.lastIndexOf('NEXA DRAWER STATE CONTRACT v4'));
 for(const token of [
  ':root[dir="rtl"] body.sidebar-closed .app-shell .sidebar',
  'transform:translate3d(110%,0,0)!important',
  ':root[dir="ltr"] body.sidebar-closed .app-shell .sidebar',
  'transform:translate3d(-110%,0,0)!important',
  'body.sidebar-open .app-shell .sidebar',
  'pointer-events:none!important'
 ])assert.ok(final.includes(token),'Missing final drawer state rule: '+token);
});

test('dark mode converts remaining legacy white panels and controls to dark theme surfaces',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const final=css.slice(css.lastIndexOf('NEXA DARK SURFACE COMPLETION v4'));
 for(const selector of [
  '.header-search:focus-within','.icon-button','.wallet-chip','.btn-soft','.assistant-launcher',
  '.assistant-head','.assistant-message','.wallet-placeholder','.back-button','.modal-product',
  '.catalog-steps','.catalog-count','.category-mark','.product-badge'
 ])assert.ok(final.includes(selector),'Missing dark theme coverage for '+selector);
 assert.ok(final.includes('background:var(--surface-2)!important'),'Legacy light surfaces use active dark tokens');
});
