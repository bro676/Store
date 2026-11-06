import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,'../../');

test('store and admin share a batched, incremental auto-direction helper',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 const helper=await fs.readFile(path.join(webRoot,'assets/brand/nexa-text-direction.js'),'utf8');
 const source='/assets/brand/nexa-text-direction.js?v=20261106-incremental-direction-v2';
 assert.ok(store.includes(source),'Storefront loads the shared direction helper');
 assert.ok(admin.includes(source),'Dashboard loads the shared direction helper');
 assert.doesNotThrow(()=>new vm.Script(helper,{filename:'nexa-text-direction.js'}));
 assert.ok(helper.includes("element.setAttribute('dir', 'auto')"),'Text nodes inherit browser-managed natural direction');
 assert.ok(helper.includes("observer.observe(document.body, { childList: true, subtree: true })"),'Only inserted subtrees are observed');
 assert.ok(!helper.includes('characterData: true'),'Text mutations do not trigger repeated DOM scans');
 assert.ok(!helper.includes('document.querySelectorAll('),'The helper never scans the full document');
 assert.ok(!admin.includes('new MutationObserver(()=>markDirection())'),'The dashboard no longer runs a full-page direction rescan');
});
test('auto direction works below an RTL document root and respects nested explicit directions',async()=>{
 const helper=await fs.readFile(path.join(webRoot,'assets/brand/nexa-text-direction.js'),'utf8');
 let scheduledFrame=null;
 const createElement=(tagName,parentElement=null,dir=null)=>{
  const attributes=new Map();
  if(dir)attributes.set('dir',dir);
  const element={
   nodeType:1,tagName:String(tagName).toUpperCase(),parentElement,children:[],childNodes:[],
   matches(selector){
    return selector.split(',').some(part=>part.trim().toUpperCase()===this.tagName);
   },
   hasAttribute(name){return attributes.has(name);},
   getAttribute(name){return attributes.get(name)??null;},
   setAttribute(name,value){attributes.set(name,String(value));},
   closest(selector){
    if(!selector.includes('[dir]:not([dir="auto"])'))return null;
    for(let current=this;current;current=current.parentElement){
     if(current.hasAttribute('dir')&&current.getAttribute('dir')!=='auto')return current;
    }
    return null;
   }
  };
  if(parentElement){parentElement.children.push(element);parentElement.childNodes.push(element);}
  return element;
 };
 const html=createElement('html',null,'rtl');
 const body=createElement('body',html);
 const paragraph=createElement('p',body);
 const explicitRegion=createElement('section',body,'rtl');
 const nestedSpan=createElement('span',explicitRegion);
 const input=createElement('input',body);
 const descendants=[];
 const visit=node=>{for(const child of node.children){descendants.push(child);visit(child);}};
 const document={
  body,documentElement:html,
  createTreeWalker(root){
   const nodes=[];const collect=node=>{for(const child of node.children){nodes.push(child);collect(child);}};collect(root);
   let index=0;return {nextNode:()=>nodes[index++]||null};
  },
  addEventListener(){}
 };
 const window={requestAnimationFrame(callback){scheduledFrame=callback;return 1;}};
 class MutationObserver{constructor(callback){this.callback=callback;}observe(){}}
 vm.runInNewContext(helper,{document,window,MutationObserver,NodeFilter:{SHOW_ELEMENT:1}});
 assert.equal(typeof scheduledFrame,'function','Initial direction work is scheduled');
 scheduledFrame();
 assert.equal(paragraph.getAttribute('dir'),'auto','A text block inherits auto direction even below the RTL html root');
 assert.equal(nestedSpan.hasAttribute('dir'),false,'A nested explicitly-directed region is not overwritten');
 assert.equal(input.getAttribute('dir'),'auto','Form controls receive auto direction too');
});

test('storefront and dashboard drawers have matching tablet and compact-device breakpoints',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(css.includes('@media(max-width:1024px){'),'Both drawers switch to off-canvas behavior on tablets and smaller screens');
 assert.ok(css.includes('body.sidebar-open .app-shell .sidebar{transform:translate3d(0,0,0)!important}'),'Store drawer has a visible open state');
 assert.ok(css.includes('body.admin-sidebar-open #app.shell .side{transform:translate3d(0,0,0)!important}'),'Admin drawer has a visible open state at the same breakpoint');
 assert.ok(css.includes('@media(max-width:860px){')&&css.includes('@media(max-width:600px){')&&css.includes('@media(max-width:380px){'),'Layouts provide additional tablet, phone and compact-phone rules');
 assert.ok(admin.includes("const drawerMedia = window.matchMedia('(max-width: 1024px)')"),'Admin navigation and CSS use the same tablet breakpoint');
 assert.ok(admin.includes("event.key === 'Escape'")&&admin.includes("event.key !== 'Tab'"),'Admin drawer supports Escape and keyboard focus containment');
 assert.ok(admin.includes('adminSidebarBackdrop')&&admin.includes('aria-expanded')&&admin.includes('setOpen(false, true)'),'Admin drawer has backdrop, state semantics and focus restoration');
 assert.ok(store.includes("window.matchMedia('(max-width: 1024px)')")&&store.includes('closeMenu(true);'),'Storefront closes its drawer after mobile route/language changes');
});

test('admin dashboard loads the overview first and fetches heavy sections only when opened',async()=>{
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 const loadAll=admin.match(/async function loadAll\(\)\{([\s\S]*?)\}/)?.[1]||'';
 const routerStart=admin.indexOf('function setPage(name){');
 const routerEnd=admin.indexOf('\\n',routerStart);
 const pageRouter=routerStart>=0?admin.slice(routerStart,routerEnd<0?admin.length:routerEnd):'';
 assert.match(loadAll,/loadSectionOnce\('overview',loadOverview\)/);
 for(const eagerLoader of ['loadCatalog(','loadSettings(','loadOrders(','loadWamdaCatalog(','loadSeagmCatalog(','loadBestStoreCatalog(']){
  assert.ok(!loadAll.includes(eagerLoader),eagerLoader+' must not block initial dashboard display');
 }
 assert.ok(pageRouter.includes("name==='catalog')loadSectionOnce('catalog',loadCatalog)"),'The product catalog loads when its section opens');
 assert.ok(pageRouter.includes("loadSectionOnce('wamda',loadWamdaCatalog)"),'Wamda products load only on the supplier API page');
 assert.ok(pageRouter.includes("loadSectionOnce('seagm',loadSeagmCatalog)"),'SEAGM products load only on the supplier API page');
 assert.ok(pageRouter.includes("loadSectionOnce('beststore',loadBestStoreCatalog)"),'Best Store products load only on the supplier API page');
});


test('public catalogue builds its folder index once instead of once per category',async()=>{
 const server=await fs.readFile(path.resolve(here,'../src/server.js'),'utf8');
 const predicateStart=server.indexOf('function isPublicCatalogCategory(');
 const publicStart=server.indexOf('function publicCatalog()',predicateStart);
 const publicEnd=server.indexOf('\nfunction ',publicStart+1);
 const predicate=server.slice(predicateStart,publicStart);
 const publicCatalog=server.slice(publicStart,publicEnd<0?server.length:publicEnd);
 assert.ok(predicate.includes('function isPublicCatalogCategory(category, byId)'));
 assert.ok(!predicate.includes('new Map('),'The category predicate reuses its caller-provided lookup map');
 assert.ok(publicCatalog.includes('const byId=new Map(catalog.map(row=>[String(row.id),row]));'),'One parent lookup index is built per public-catalog response');
 assert.ok(publicCatalog.includes('catalog.filter(category=>isPublicCatalogCategory(category,byId))'),'All category visibility checks reuse the same index');
});

test('storefront renders the catalog without waiting for slower storefront settings',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const initStart=store.indexOf('async function init(){');
 const initEnd=store.indexOf('\n}',initStart);
 const init=store.slice(initStart,initEnd<0?store.length:initEnd);
 const configStart=init.indexOf('const configPromise=loadStorefrontConfig();');
 const catalogStart=init.indexOf("const response=await fetch('/api/catalog',{cache:'no-store'})");
 const navigateAt=init.indexOf("navigate(resolveStoreLocation(),{historyMode:'replace'})");
 const configApplyAt=init.indexOf('configPromise.then(');
 assert.ok(configStart>=0&&catalogStart>configStart,'Storefront settings begin loading while the catalog request starts');
 assert.ok(navigateAt>catalogStart&&configApplyAt>navigateAt,'The initial route is rendered before slower settings finish');
 assert.ok(!init.includes('Promise.all(['),'The initial UI is not blocked by the slowest startup request');
 assert.ok(!init.includes('renderOrders();')&&!init.includes('renderPaymentHistory();')&&!init.includes('renderProfilePage();'),'Inactive pages are not rendered during startup');
 assert.ok(init.includes('refreshCustomerAccount().catch(()=>{});'),'Account refresh runs in the background without blocking first paint');
});


test('admin catalogue builds one reusable folder index and does not rescan every category for each tree row',async()=>{
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 assert.ok(admin.includes('function buildAdminCatalogTreeIndex()'),'The admin creates a single category lookup for the folder tree');
 assert.ok(admin.includes('childrenByParent'),'Child folders are retrieved from an indexed parent map');
 assert.ok(admin.includes('folderProductCountById'),'Visible product totals are precomputed instead of recursively rescanned per row');
 assert.ok(admin.includes('catalogTreeIndex.departmentById'),'Department membership is memoized for all folder rows');
 assert.ok(!admin.includes('NexaCatalog.getFolderProductCount('),'Rendering the tree and active folder do not recursively count against the full catalogue');
});

test('admin product editing renders a small searchable page and defers large move-folder option lists',async()=>{
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 assert.ok(admin.includes('const CATALOG_PRODUCTS_PAGE_SIZE=24'),'Only a bounded page of product editors is created at once');
 assert.ok(admin.includes('function renderCatalogProductResults()'),'The admin provides incremental product result rendering');
 assert.ok(admin.includes('filtered.slice(start,start+CATALOG_PRODUCTS_PAGE_SIZE)'),'Only the active page is inserted into the DOM');
 assert.ok(admin.includes('id="catalogProductsSearch"'),'The active folder can be searched without loading all product editors');
 assert.ok(admin.includes('data-lazy-move-options'),'Move destinations are not created for every product before its editor opens');
 assert.ok(admin.includes("addEventListener('toggle',e=>"),'Move destinations are populated on demand when a product editor opens');
 assert.ok(admin.includes('loading="lazy" decoding="async"'),'Product thumbnails defer decoding and off-screen loading');
});

test('storefront Drawer closes to the correct side and restores focus across navigation and viewport changes',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const polish=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 assert.ok(polish.includes(':root[dir="rtl"] body.sidebar-closed .app-shell .sidebar{')&&polish.includes('transform:translate3d(110%,0,0)!important}'),'Arabic desktop Drawer slides out to the right');
 assert.ok(polish.includes(':root[dir="ltr"] body.sidebar-closed .app-shell .sidebar{')&&polish.includes('transform:translate3d(-110%,0,0)!important}'),'English desktop Drawer slides out to the left');
 assert.ok(polish.includes(':root[dir="rtl"] body.sidebar-open .app-shell .sidebar')&&polish.includes(':root[dir="ltr"] body.sidebar-open .app-shell .sidebar'),'Both languages share a visible mobile open state');
 assert.ok(store.includes("if(window.matchMedia('(max-width: 1024px)').matches)closeMenu(true);"),'Navigation from the mobile Drawer restores focus to its opener');
 assert.ok(store.includes("const focusWasInside=$('sidebar')?.contains(document.activeElement);"),'Crossing the tablet breakpoint returns focus from the hidden Drawer');
 assert.ok(store.includes('else if(storeDrawerMedia.addListener)storeDrawerMedia.addListener(syncStoreMenuToViewport);'),'Older matchMedia implementations still synchronize Drawer state');
 assert.ok(polish.includes('env(safe-area-inset-top)')&&polish.includes('env(safe-area-inset-bottom)'),'Mobile safe areas keep the first and last controls clear');
 assert.ok(polish.includes('@media(max-width:1024px) and (max-height:560px)'),'Short landscape screens receive a compact Drawer layout');
 assert.ok(polish.includes('@media(hover:none) and (pointer:coarse)'),'Touch devices retain comfortable tap targets');
});

test('large catalogue mutations and low-core devices use bounded locale and direction work',async()=>{
 const locale=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const direction=await fs.readFile(path.join(webRoot,'assets/brand/nexa-text-direction.js'),'utf8');
 const server=await fs.readFile(path.join(webRoot,'server/src/server.js'),'utf8');
 const db=await fs.readFile(path.join(webRoot,'server/src/db-startup.js'),'utf8');
 assert.ok(locale.includes('const TRANSLATION_BATCH_SIZE = DEVICE_CONCURRENCY <= 4 ? 120 : 220'),'Translation work is smaller on low-core devices');
 assert.ok(direction.includes('const BATCH_SIZE = DEVICE_CONCURRENCY <= 4 ? 120 : 220'),'Direction work is smaller on low-core devices');
 assert.ok(locale.includes('record.addedNodes.length>1&&record.target?.nodeType===1'),'Large catalogue inserts are coalesced into one translation root');
 assert.ok(direction.includes('record.addedNodes.length>1&&record.target?.nodeType===1'),'Large catalogue inserts are coalesced into one direction root');
 assert.ok(locale.includes('new RegExp(fragmentEntries.map(([phrase])=>phrase)'),'Partial translation phrases are precompiled once');
 assert.ok(server.includes('attempts: 10')&&server.includes('monitorPostgresClientErrors(pool'),'Transient PostgreSQL faults receive bounded retries and client monitoring');
 assert.ok(db.includes("client.on('error', error => onClientError(error, client))"),'Checked-out PostgreSQL clients receive an error listener');
});
