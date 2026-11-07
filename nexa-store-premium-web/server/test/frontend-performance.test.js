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
 const source='/assets/brand/nexa-text-direction.js?v=20261107-locale-layout-v3';
 assert.ok(store.includes(source),'Storefront loads the shared direction helper');
 assert.ok(admin.includes(source),'Dashboard loads the shared direction helper');
 assert.doesNotThrow(()=>new vm.Script(helper,{filename:'nexa-text-direction.js'}));
 assert.ok(helper.includes("element.setAttribute('dir', 'auto')"),'Editable controls inherit browser-managed natural direction');
 assert.ok(helper.includes("const CONTROL_SELECTOR = 'input,textarea'"),'Only editable text controls receive automatic direction');
 assert.ok(!helper.includes('TEXT_SELECTOR'),'Visible layout and text nodes inherit the document direction');
 assert.ok(helper.includes("observer.observe(document.body, {childList:true, subtree:true})"),'Only inserted subtrees are observed');
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
 assert.equal(paragraph.getAttribute('dir'),null,'Visible text inherits the active document direction without flipping individual flex children');
 assert.equal(nestedSpan.hasAttribute('dir'),false,'A nested explicitly-directed region is not overwritten');
 assert.equal(input.getAttribute('dir'),'auto','Editable text controls receive auto direction');
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


test('store drawer locks background scroll and restores focus and accessibility across locale and viewport changes',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const start=store.indexOf('let storeDrawerScrollPosition=0;');
 const end=store.indexOf('\nfunction renderDepartmentCard',start);
 assert.ok(start>=0&&end>start,'The drawer controller has a dedicated state boundary');
 const controller=store.slice(start,end);
 let locale='en',changeHandler=null,scrollY=360,restoredY=null,activeElement=null;
 const makeClassList=()=>{
  const classes=new Set();
  return {
   add(name){classes.add(name)},
   remove(name){classes.delete(name)},
   contains(name){return classes.has(name)},
   toggle(name,force){if(force===undefined)force=!classes.has(name);if(force)classes.add(name);else classes.delete(name);return force}
  };
 };
 const attributes=new Map();
 const makeElement=()=>({
  style:{values:new Map(),setProperty(name,value){this.values.set(name,value)},removeProperty(name){this.values.delete(name)},getPropertyValue(name){return this.values.get(name)||''},getPropertyPriority(){return ''}},
  classList:makeClassList(),
  setAttribute(name,value){attributes.set(name,String(value))},
  getAttribute(name){return attributes.get(name)??null},
  removeAttribute(name){attributes.delete(name)},
  hasAttribute(name){return attributes.has(name)},
  focus(){this.focused=true;activeElement=this},
  getClientRects(){return [1]}
 });
 const body=makeElement(),root=makeElement(),sidebar=makeElement(),toggle=makeElement(),close=makeElement(),firstLink=makeElement();
 sidebar.contains=element=>element===close||element===firstLink;
 sidebar.querySelector=selector=>selector==='.sidebar-nav .side-link'?firstLink:null;
 const elements={menuToggle:toggle,sidebar,sidebarClose:close};
 const media={matches:true,addEventListener(type,callback){if(type==='change')changeHandler=callback},addListener(callback){changeHandler=callback}};
 const sandbox={
  storeDrawerMedia:media,
  document:{body,documentElement:root,get activeElement(){return activeElement}},
  window:{get scrollY(){return scrollY},scrollTo(_x,y){restoredY=y;scrollY=y}},
  $:id=>elements[id]||null,
  storeLocale:()=>locale
 };
 vm.runInNewContext(controller,sandbox);
 sandbox.openMenu();
 assert.ok(body.classList.contains('sidebar-open'),'Mobile drawer opens');
 assert.ok(root.classList.contains('store-drawer-scroll-locked'),'Opening drawer locks the page behind it');
 assert.equal(body.style.getPropertyValue('--store-drawer-scroll-top'),'-360px','Background scroll position is preserved while locked');
 assert.equal(sidebar.getAttribute('role'),'dialog','Open mobile drawer is exposed as a dialog');
 assert.equal(sidebar.getAttribute('aria-modal'),'true','Open mobile drawer is modal');
 assert.equal(sidebar.getAttribute('aria-hidden'),'false','Open drawer is available to assistive technology');
 assert.equal(toggle.getAttribute('aria-expanded'),'true','Toggle reports expanded state');
 assert.equal(toggle.getAttribute('aria-label'),'Close sidebar','English toggle label is correct');
 assert.equal(close.focused,true,'Focus moves into the drawer on open');
 sandbox.closeMenu(true);
 assert.ok(!body.classList.contains('sidebar-open'),'Mobile drawer closes');
 assert.ok(!root.classList.contains('store-drawer-scroll-locked'),'Closing drawer unlocks the page');
 assert.equal(restoredY,360,'Page scroll returns to its original position');
 assert.equal(sidebar.getAttribute('aria-hidden'),'true','Closed drawer is hidden from assistive technology');
 assert.ok(sidebar.hasAttribute('inert'),'Closed drawer cannot receive focus');
 assert.equal(sidebar.getAttribute('role'),null,'Closed drawer is no longer exposed as a dialog');
 assert.equal(toggle.getAttribute('aria-expanded'),'false','Toggle reports collapsed state');
 assert.equal(toggle.focused,true,'Focus returns to the menu toggle after close');
 locale='ar';sandbox.openMenu();
 assert.equal(toggle.getAttribute('aria-label'),'إغلاق القائمة الجانبية','Arabic toggle label follows the active locale');
 media.matches=false;changeHandler();
 assert.ok(!body.classList.contains('sidebar-open')&&!body.classList.contains('sidebar-closed'),'Desktop breakpoint restores the permanent side rail');
 assert.ok(!root.classList.contains('store-drawer-scroll-locked'),'Desktop rail does not lock page scrolling');
 assert.equal(sidebar.getAttribute('aria-hidden'),'false','Desktop rail remains available');
 assert.equal(sidebar.getAttribute('role'),null,'Desktop rail is not announced as a modal dialog');
 assert.equal(toggle.getAttribute('aria-expanded'),'true','Desktop rail reports its visible state');
 assert.equal(activeElement,firstLink,'Focus moves to a visible navigation item when the mobile close control disappears on desktop');
 media.matches=true;changeHandler();
 assert.ok(!body.classList.contains('sidebar-open'),'Changing back to mobile starts with the drawer closed');
 assert.ok(sidebar.hasAttribute('inert'),'The mobile drawer is inert after crossing back to mobile');
 assert.ok(!root.classList.contains('store-drawer-scroll-locked'),'Viewport changes do not leave page scroll locked');
 assert.equal(activeElement,toggle,'Focus moves to the visible menu toggle when returning to mobile');
});

test('responsive drawer has a bounded viewport width, safe-area padding and a compact landscape layout',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-polish.css'),'utf8');
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(css.includes('--nexa-mobile-drawer-width:min(88vw,340px)')&&css.includes('width:var(--nexa-mobile-drawer-width)!important')&&css.includes('max-width:calc(100vw - 24px)!important'),'Drawer stays within small viewport widths');
 assert.ok(css.includes('env(safe-area-inset-top,0px)')&&css.includes('env(safe-area-inset-bottom,0px)'),'Drawer respects device cutouts and safe areas');
 assert.ok(css.includes('@media(max-height:520px) and (orientation:landscape) and (max-width:1024px)'),'Short landscape screens receive a dedicated compact layout');
 assert.ok(css.includes('body.sidebar-open .app-shell .sidebar-backdrop{')&&css.includes('pointer-events:auto!important'),'The backdrop becomes interactive only while the mobile drawer is open');
 assert.ok(css.includes('.app-shell .sidebar-drawer-head{')&&css.includes('display:flex!important'),'Mobile drawer close control and heading remain visible');
 assert.ok(css.includes('overscroll-behavior:contain!important')&&css.includes('-webkit-overflow-scrolling:touch!important'),'Long drawer content scrolls independently without scroll chaining');
 assert.ok(css.includes('html.store-drawer-scroll-locked body'),'Background document scroll is locked while the drawer is modal');
 assert.ok(css.includes(':root[dir="rtl"] .app-shell .sidebar')&&css.includes('transform:translate3d(100%,0,0)!important'),'Arabic drawer exits from the right');
 assert.ok(css.includes(':root[dir="ltr"] .app-shell .sidebar')&&css.includes('transform:translate3d(-100%,0,0)!important'),'English drawer exits from the left');
 assert.ok(store.includes('nexa-store-polish.css?v=20261107-package-modal-dark-v5'),'Responsive drawer CSS receives a fresh cache version');
});


test('storefront catalog indexes are reused for tree visibility, folder counts and department summaries',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-catalog.js'),'utf8');
 const window={};
 vm.runInNewContext(source,{window,URL,Set,Map,WeakMap});
 const api=window.NexaCatalog;
 const products=[
  {id:'root-visible',name:'Root product'},
  {id:'root-hidden',name:'Hidden root product',visible:false}
 ];
 const childProducts=[
  {id:'child-late',name:'Late product',sortOrder:20},
  {id:'child-first',name:'First product',sortOrder:1}
 ];
 const categories=[
  {id:'games-root',name:'قسم الألعاب',departmentId:'games',items:products},
  {id:'games-child',name:'PUBG',parentId:'games-root',items:childProducts},
  {id:'games-hidden',name:'Hidden folder',parentId:'games-root',visible:false,items:[{id:'private'}]},
  {id:'apps-root',name:'قسم التطبيقات',departmentId:'apps',items:[{id:'app-1'}]}
 ];
 const summaries=api.getDepartmentSummaries(categories);
 const sameSummaries=api.getDepartmentSummaries(categories);
 assert.strictEqual(sameSummaries,summaries,'Repeated home/catalog renders reuse the same department summary index');
 const games=summaries.find(row=>row.id==='games');
 assert.equal(games.categoryCount,2,'Visible folders remain counted in their department');
 assert.equal(games.productCount,3,'Only visible products in visible categories contribute to department totals');
 assert.deepEqual(Array.from(api.getChildFolders(categories,'games-root'),row=>row.id),['games-child'],'Hidden folders are omitted from the indexed child list');
 assert.equal(api.getFolderProductCount(categories[0],categories),3,'Folder totals include visible descendants but ignore hidden items and folders');
 assert.equal(api.getFolderProductCount(categories[1],categories),2,'A child folder total is computed from its own visible products');
 const ordered=api.getOrderedProducts(childProducts);
 assert.deepEqual(ordered.map(row=>row.id),['child-first','child-late'],'Product display order is preserved');
 assert.strictEqual(api.getOrderedProducts(childProducts),ordered,'Pagination reuses the cached product ordering');
 api.setDepartments([{id:'games',name:'Games updated'}]);
 const refreshed=api.getDepartmentSummaries(categories);
 assert.notStrictEqual(refreshed,summaries,'Changing department settings invalidates the summary cache');
 assert.equal(refreshed.find(row=>row.id==='games').name,'Games updated','Updated department names are reflected after invalidation');
});

test('catalog index handles hidden ancestors and malformed parent cycles without looping',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-catalog.js'),'utf8');
 const window={};
 vm.runInNewContext(source,{window,URL,Set,Map,WeakMap});
 const api=window.NexaCatalog;
 const rows=[
  {id:'hidden-parent',name:'Hidden',visible:false,items:[{id:'private'}]},
  {id:'hidden-child',name:'Hidden child',parentId:'hidden-parent',items:[{id:'private-child'}]},
  {id:'cycle-a',name:'Cycle A',parentId:'cycle-b',items:[{id:'a'}]},
  {id:'cycle-b',name:'Cycle B',parentId:'cycle-a',items:[{id:'b'}]}
 ];
 assert.equal(api.isCategoryVisible(rows[1],rows),false,'Descendants of a hidden folder remain hidden');
 assert.equal(api.getChildFolders(rows,'hidden-parent').length,0,'Hidden ancestors do not leak descendants into the storefront');
 assert.equal(api.isCategoryVisible(rows[2],rows),false,'Malformed parent cycles are not shown');
 assert.equal(api.getFolderProductCount(rows[2],rows),1,'Cycle protection still counts the current folder and does not recurse forever');
});

test('supplier comparison aggregates invalid-price diagnostics instead of logging one record per product',async()=>{
 const server=await fs.readFile(path.resolve(here,'../src/server.js'),'utf8');
 assert.ok(server.includes('const unpriceableCandidateSummaries=new Map();'),'The sync run collects a summary by supplier and category');
 assert.ok(server.includes('summary.count++;')&&server.includes('summary.productIds.length<5'),'Only a small sample of product IDs is retained for diagnostics');
 assert.ok(server.includes("console.warn('supplier candidates skipped: invalid calculated selling prices'"),'One compact summary is logged per supplier/category group');
 assert.ok(!server.includes("console.warn('supplier candidate skipped: invalid calculated supplier selling price'"),'The sync no longer emits a separate warning for every rejected product');
});


test('catalog search rendering is debounced, cancellable and preserves only the latest query',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-catalog.js'),'utf8');
 const window={};
 vm.runInNewContext(source,{window,URL,Set,Map,WeakMap});
 const api=window.NexaCatalog;
 let nextId=0;
 const pending=new Map(),callbacks=new Map(),delays=new Map();
 const scheduler={
  setTimeout(callback,delay){const id=++nextId;pending.set(id,callback);callbacks.set(id,callback);delays.set(id,delay);return id;},
  clearTimeout(id){pending.delete(id);}
 };
 const rendered=[];
 const task=api.createDebouncedTask(value=>rendered.push(value),140,scheduler);
 task.schedule('p');
 const stale=[...pending.values()][0];
 task.schedule('pu');
 assert.equal(pending.size,1,'Typing again cancels the previous pending render');
 assert.equal(delays.get(nextId),140,'Search uses a short fixed debounce interval');
 stale();
 assert.deepEqual(rendered,[],'A stale callback cannot render after a newer query was scheduled');
 const latest=pending.get(nextId);
 pending.delete(nextId);
 latest();
 assert.deepEqual(rendered,['pu'],'Only the final query renders once');
 task.schedule('cancelled route query');
 const cancelled=[...pending.values()][0];
 task.cancel();
 assert.equal(task.pending,false,'Navigation cancels pending search rendering');
 cancelled();
 assert.deepEqual(rendered,['pu'],'A cancelled search cannot redraw a different route');

 task.schedule('next');
 const next=[...pending.values()][0];
 pending.clear();
 next();
 assert.deepEqual(rendered,['pu','next'],'The scheduler remains reusable after cancellation');
});

test('storefront debounces expensive catalog search renders and cancels stale work on navigation and clicks',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const navigateStart=store.indexOf('function navigate(view,');
 const navigateEnd=store.indexOf('\n}',navigateStart);
 const navigate=store.slice(navigateStart,navigateEnd<0?store.length:navigateEnd);
 const clickStart=store.indexOf("document.addEventListener('click',e=>{const favoriteControl");
 const clickEnd=store.indexOf('},true);',clickStart);
 const click=store.slice(clickStart,clickEnd<0?store.length:clickEnd+8);
 const inputStart=store.indexOf("document.addEventListener('input',event=>{");
 const inputEnd=store.indexOf("\n});",inputStart);
 const input=store.slice(inputStart,inputEnd<0?store.length:inputEnd);
 assert.ok(store.includes('const catalogSearchRender=NexaCatalog.createDebouncedTask('),'The storefront uses the shared cancellable debouncer');
 assert.ok(navigate.includes('catalogSearchRender.cancel();'),'Route changes cannot receive a stale catalog search render');
 assert.ok(click.includes('catalogSearchRender.cancel()'),'Folder, product and pager clicks cancel a pending input render');
 assert.ok(input.includes('catalogSearchRender.schedule(id,selectionStart,selectionEnd,selectionDirection)'),'Typing schedules one render after the latest input');
 assert.ok(!input.includes('renderCatalog();'),'The input event does not synchronously rebuild the entire catalog on each keystroke');
 assert.ok(input.includes('state.productQuery=value;state.productPage=1;'),'The search state still updates immediately for paging and navigation');
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

test('mobile route navigation unlocks the drawer before scrolling to the new page',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const start=store.indexOf('function navigate(view,');
 const end=store.indexOf('\n}',start);
 const navigate=store.slice(start,end<0?store.length:end);
 const closeAt=navigate.indexOf('closeMenu(true)');
 const scrollAt=navigate.indexOf("window.scrollTo({top:0,behavior:'smooth'})");
 assert.ok(closeAt>=0&&scrollAt>closeAt,'The drawer restores its saved page scroll before route navigation moves to the top');
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
