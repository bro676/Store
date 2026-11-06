import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../');

async function loadCatalogHelper() {
  const source = await fs.readFile(path.join(webRoot, 'assets/brand/nexa-catalog.js'), 'utf8');
  const context = { window: {}, URL };
  vm.runInNewContext(source, context, { filename:'nexa-catalog.js' });
  return context.window.NexaCatalog;
}

test('product resolver keeps category context for numeric and string IDs', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'games-1', items:[{ id:101, name:'Numeric product' }] },
    { id:'apps-2', items:[{ id:'product-2', name:'String product' }] },
  ];
  const numeric = catalog.findProduct(categories, '101', 'games-1');
  assert.equal(numeric.category.id, 'games-1');
  assert.equal(numeric.item.name, 'Numeric product');
  const string = catalog.findProduct(categories, ' product-2 ', 'apps-2');
  assert.equal(string.category.id, 'apps-2');
  assert.equal(string.item.name, 'String product');
});

test('product resolver recovers when the supplied category is stale', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'games-1', items:[{ id:'pubg-global', name:'PUBG Global' }] },
    { id:'apps-2', items:[{ id:'spotify-premium', name:'Spotify Premium' }] },
  ];
  const recovered = catalog.findProduct(categories, 'spotify-premium', 'deleted-category');
  assert.equal(recovered.category.id, 'apps-2');
  assert.equal(recovered.item.name, 'Spotify Premium');
});

test('product resolver returns null for empty and unknown IDs', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [{ id:'games-1', items:[{ id:'pubg-global', name:'PUBG Global' }] }];
  assert.equal(catalog.findProduct(categories, null), null);
  assert.equal(catalog.findProduct(categories, ''), null);
  assert.equal(catalog.findProduct(categories, 'missing-product'), null);
});

test('single-option products advance directly to the pack step and invalid options are hidden', async () => {
  const catalog = await loadCatalogHelper();
  const single = { options:[{ id:'default', name:'الخيار الأساسي', packs:[['باقة واحدة',2]] }] };
  const multi = { options:[
    { id:'global', packs:[['باقة',1]] },
    { id:'region', packs:[['باقة',2]] },
  ] };
  const empty = { options:[{ id:'broken', packs:[] }, { name:'missing option id', packs:[['باقة',3]] }] };
  assert.equal(catalog.initialOptionId(single), 'default');
  assert.equal(catalog.initialOptionId(multi), null);
  assert.equal(catalog.initialOptionId(empty), null);
  assert.equal(catalog.getProductOptions(empty).length, 0);
  assert.equal(catalog.isValidPack(['باقة', 3]), true);
  assert.equal(catalog.isValidPack(['باقة', 0]), false);
});

test('product navigation resolver returns canonical identifiers and skips the redundant single-option step', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'games-1', name:'قسم الألعاب', items:[
      { id:'single-product', name:'Single pack', options:[{id:'default',packs:[['باقة',5]]}] },
      { id:'multi-product', name:'Multi option', options:[
        {id:'global',packs:[['Global',3]]},
        {id:'turkey',packs:[['Turkey',4]]},
      ] },
      { id:'invalid-product', name:'No valid pack', options:[{id:'broken',packs:[['باقة',0]]}] },
    ]},
  ];
  const single = catalog.resolveProductNavigation(categories, 'single-product', 'stale-category');
  assert.equal(single.categoryId, 'games-1');
  assert.equal(single.itemId, 'single-product');
  assert.equal(single.departmentId, 'games');
  assert.equal(single.optionId, 'default');
  assert.equal(single.optionCount, 1);
  assert.equal(single.packCount, 1);

  const multi = catalog.resolveProductNavigation(categories, 'multi-product', 'games-1');
  assert.equal(multi.optionId, null);
  assert.equal(multi.optionCount, 2);
  assert.equal(multi.packCount, 2);

  const invalid = catalog.resolveProductNavigation(categories, 'invalid-product', 'games-1');
  assert.equal(invalid.optionId, null);
  assert.equal(invalid.optionCount, 0);
  assert.equal(invalid.packCount, 0);
  assert.equal(catalog.resolveProductNavigation(categories, 'unknown-product'), null);
});

test('product resolver recovers a unique product when its old category still exists but no longer contains it', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'old-games-category', name:'Old category', items:[] },
    { id:'new-apps-category', name:'New category', items:[{ id:'moved-product', name:'Moved product' }] },
  ];
  const resolved = catalog.resolveProductNavigation(categories, 'moved-product', 'old-games-category');
  assert.equal(resolved.categoryId, 'new-apps-category');
  assert.equal(resolved.itemId, 'moved-product');
});

test('product resolver does not guess between duplicate IDs when the supplied existing category has no match', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'old-category', items:[] },
    { id:'first', items:[{ id:'duplicate', name:'First' }] },
    { id:'second', items:[{ id:'duplicate', name:'Second' }] },
  ];
  assert.equal(catalog.findProduct(categories, 'duplicate', 'old-category'), null);
});

test('folder display follows explicit dashboard order, then preserves the original dashboard sequence', async () => {
  const catalog = await loadCatalogHelper();
  const rows = [
    { id:'popular', name:'Zulu popular', sortOrder:0, items:Array.from({length:20},(_,i)=>i) },
    { id:'second', name:'Second', sortOrder:2, items:[] },
    { id:'first', name:'First', sortOrder:1, items:Array.from({length:12},(_,i)=>i) },
    { id:'automatic-small', name:'A small', sortOrder:0, items:[1] },
    { id:'automatic-empty', name:'Empty', sortOrder:0, items:[] },
  ];
  assert.deepEqual(catalog.sortCategoriesByProductCount(rows).map(row=>row.id),
    ['first','second','popular','automatic-small','automatic-empty']);
  assert.equal(catalog.compareDisplayOrder({sortOrder:1},{sortOrder:2}),-1);
  assert.equal(catalog.compareDisplayOrder({sortOrder:1},{sortOrder:0}),-1);
});

test('products keep dashboard order rather than being sorted by product name', async () => {
  const catalog = await loadCatalogHelper();
  const products = [
    {id:'z-first',name:'Zulu',sortOrder:0},
    {id:'b-second',name:'Second',sortOrder:2},
    {id:'a-first',name:'Alpha',sortOrder:1},
    {id:'a-auto',name:'Aardvark',sortOrder:0},
  ];
  assert.deepEqual(catalog.getOrderedProducts(products).map(row=>row.id),
    ['a-first','b-second','z-first','a-auto']);
});

test('nested storefront order is a dashboard-order depth-first folder tree', async () => {
  const catalog = await loadCatalogHelper();
  const rows = [
    {id:'games-b',name:'Games B',departmentId:'games',sortOrder:2,items:[]},
    {id:'games-a',name:'Games A',departmentId:'games',sortOrder:1,items:[]},
    {id:'child-b',name:'Child B',parentId:'games-a',sortOrder:2,items:[]},
    {id:'child-a',name:'Child A',parentId:'games-a',sortOrder:1,items:[]},
    {id:'grandchild',name:'Grandchild',parentId:'child-a',items:[]},
    {id:'nested-b',name:'Nested B',parentId:'games-b',items:[]},
  ];
  assert.deepEqual(catalog.getOrderedCategories(rows,'games').map(row=>row.id),
    ['games-a','child-a','grandchild','child-b','games-b','nested-b']);
  const summary=catalog.getDepartmentSummaries(rows).find(row=>row.id==='games');
  assert.deepEqual(summary.categories.map(row=>row.id),
    ['games-a','child-a','grandchild','child-b','games-b','nested-b']);
});

test('nested folder helpers inherit the root department and count products recursively', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'games-root', name:'ألعاب', departmentId:'games', items:[{id:'game-a',visible:true},{id:'game-hidden',visible:false}] },
    { id:'pubg-folder', name:'PUBG', parentId:'games-root', items:[{id:'pubg-1'}] },
    { id:'pubg-uc-folder', name:'UC packs', parentId:'pubg-folder', items:[{id:'pubg-uc-60'},{id:'pubg-uc-325'}] },
    { id:'apps-root', name:'Applications', departmentId:'apps', items:[{id:'spotify'}] },
  ];
  assert.equal(catalog.getCategoryDepartmentId(categories[2],categories),'games');
  assert.equal(catalog.categoryAncestors(categories[2],categories).map(row=>row.id).join(','),'games-root,pubg-folder,pubg-uc-folder');
  assert.equal(catalog.getChildFolders(categories,'games-root').map(row=>row.id).join(','),'pubg-folder');
  assert.equal(catalog.getChildFolders(categories,null,'apps').map(row=>row.id).join(','),'apps-root');
  assert.equal(catalog.getFolderProductCount(categories[0],categories),4);
  const product=catalog.resolveProductNavigation(categories,'pubg-uc-325','pubg-uc-folder');
  assert.equal(product.departmentId,'games');
  assert.equal(product.categoryId,'pubg-uc-folder');
});

test('hidden folder descendants are excluded from storefront folder navigation', async () => {
  const catalog = await loadCatalogHelper();
  const categories = [
    { id:'games-root', name:'Games', departmentId:'games', items:[] },
    { id:'hidden-folder', name:'Hidden', parentId:'games-root', visible:false, items:[{id:'hidden-product'}] },
    { id:'hidden-child', name:'Child', parentId:'hidden-folder', items:[{id:'hidden-child-product'}] },
    { id:'visible-folder', name:'Visible', parentId:'games-root', items:[{id:'visible-product'}] },
  ];
  assert.equal(catalog.getChildFolders(categories,'games-root').map(row=>row.id).join(','),'visible-folder');
  assert.equal(catalog.isCategoryVisible(categories[2],categories),false);
  assert.equal(catalog.getFolderProductCount(categories[0],categories),1);
});

test('explicit folder display priority is applied before automatic product-count ordering',async()=>{
  const catalog=await loadCatalogHelper();
  const rows=[
    {id:'popular',name:'Popular',sortOrder:0,items:Array.from({length:20},(_,i)=>i)},
    {id:'second',name:'Second',sortOrder:2,items:[]},
    {id:'first',name:'First',sortOrder:1,items:Array.from({length:12},(_,i)=>i)},
    {id:'automatic-small',name:'Automatic small',sortOrder:0,items:[1]},
  ];
  assert.deepEqual(catalog.sortCategoriesByProductCount(rows).map(row=>row.id),
    ['first','second','automatic-small','popular']);
  assert.equal(catalog.compareDisplayOrder({sortOrder:1},{sortOrder:2}),-1);
  assert.equal(catalog.compareDisplayOrder({sortOrder:1},{sortOrder:0}),-1);
});
