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
 assert.equal(translate('مرحباً بك في NEXA STORE'),'Welcome to NEXA STORE');
 assert.ok(source.includes('const fragmentPattern = fragmentEntries.length'),'Partial translations are compiled once rather than scanned in a long phrase loop');
 assert.ok(source.includes('raw.replace(fragmentPattern'),'Partial Arabic phrases are replaced in one pass');
 assert.equal(sandbox.document.documentElement.direction,'ltr');
 sandbox.window.NexaLocale.setLanguage('ar');
 assert.equal(translate('Order 27'),'Order ٢٧');
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

test('language direction moves the drawer rail and closes the mobile drawer before changing language',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 assert.ok(store.includes("if(window.matchMedia('(max-width: 1024px)').matches)closeMenu(true);"),
  'Language switching closes the mobile drawer before changing direction');
 assert.ok(css.includes(':root[dir="ltr"] .app-shell .sidebar{'),'English uses a left-side drawer');
 assert.ok(css.includes('transform:translate3d(-110%,0,0)!important'),'The left-side drawer moves off-canvas in English');
 assert.ok(css.includes(':root[dir="rtl"] .app-shell .sidebar{'),'Arabic retains a right-side drawer');
 assert.ok(css.includes('text-align:start!important'),'Text alignment follows active direction');
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
