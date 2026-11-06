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
 const source='/assets/brand/nexa-text-direction.js?v=20261106-incremental-direction-v1';
 assert.ok(store.includes(source),'Storefront loads the shared direction helper');
 assert.ok(admin.includes(source),'Dashboard loads the shared direction helper');
 assert.doesNotThrow(()=>new vm.Script(helper,{filename:'nexa-text-direction.js'}));
 assert.ok(helper.includes("element.setAttribute('dir', 'auto')"),'Text nodes inherit browser-managed natural direction');
 assert.ok(helper.includes("observer.observe(document.body, { childList: true, subtree: true })"),'Only inserted subtrees are observed');
 assert.ok(!helper.includes('characterData: true'),'Text mutations do not trigger repeated DOM scans');
 assert.ok(!helper.includes('document.querySelectorAll('),'The helper never scans the full document');
 assert.ok(!admin.includes('new MutationObserver(()=>markDirection())'),'The dashboard no longer runs a full-page direction rescan');
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
