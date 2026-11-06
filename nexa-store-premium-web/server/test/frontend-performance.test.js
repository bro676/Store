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

test('storefront starts the catalog and storefront configuration requests concurrently',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const initStart=store.indexOf('async function init(){');
 const initEnd=store.indexOf('\n',initStart);
 const init=store.slice(initStart,initEnd<0?store.length:initEnd);
 assert.ok(init.includes('Promise.all(['),'The initial catalog and storefront settings are fetched together');
 assert.ok(init.includes("fetch('/api/catalog',{cache:'no-store'})"),'The public catalogue request remains intact');
 assert.ok(init.includes('loadStorefrontConfig()'),'Storefront settings are loaded in the same startup batch');
 assert.ok(!init.includes('await loadStorefrontConfig()'),'Settings no longer wait behind the catalogue response');
});
