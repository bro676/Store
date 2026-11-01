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
