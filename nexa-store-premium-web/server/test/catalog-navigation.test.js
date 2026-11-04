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

test('internal catalog folders are sorted from the fewest products to the most', async () => {
  const catalog = await loadCatalogHelper();
  const rows = [
    { id:'large', name:'Large', items:[1,2,3] },
    { id:'small', name:'Small', items:[1] },
    { id:'empty', name:'Empty', items:[] },
    { id:'medium', name:'Medium', items:[1,2] },
  ];
  assert.deepEqual(
    catalog.sortCategoriesByProductCount(rows).map(row=>row.id),
    ['empty','small','medium','large']
  );
});
