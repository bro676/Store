import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminSession, verifyAdminSession, encryptSecret, decryptSecret,
  isSafeCatalogImage, validateCatalog, mergeCatalog, upsertCatalogProduct, getJsonPath, validateCatalogApiUrl, normalizeFxRate,
} from '../src/admin-core.js';

const secret = 'a-strong-admin-key-for-tests-only-2026';
const catalog = [{id:'games',name:'ألعاب',desc:'قسم',image:'assets/categories/games.svg',icon:'🎮',items:[{id:'freefire',name:'Free Fire',desc:'لعبة',image:'assets/products/freefire.svg',options:[{id:'mena',name:'MENA',desc:'منطقة',flag:'🌍',packs:[['100 جوهرة',180]]}]}]}];

test('admin sessions are signed and expire', () => {
  const token = createAdminSession(secret, 1_800_000_000_000, 60);
  assert.equal(verifyAdminSession(token, secret, 1_800_000_000_000), true);
  assert.equal(verifyAdminSession(token, secret + 'x', 1_800_000_000_000), false);
  assert.equal(verifyAdminSession(token, secret, 1_800_061_000_000), false);
});
test('admin secrets are encrypted and authenticated', () => {
  const token = encryptSecret('provider-secret', secret);
  assert.notEqual(token, 'provider-secret');
  assert.equal(decryptSecret(token, secret), 'provider-secret');
  assert.throws(() => decryptSecret(token, secret + 'x'));
});
test('validates nested catalogue and rejects active content images', () => {
  assert.equal(validateCatalog(catalog)[0].items[0].options[0].packs[0][1], 180);
  assert.equal(isSafeCatalogImage('data:image/png;base64,aGVsbG8='), true);
  assert.equal(isSafeCatalogImage('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.throws(() => validateCatalog([{...catalog[0],id:'bad id'}]));
  assert.throws(() => validateCatalog([{...catalog[0],image:'javascript:alert(1)'}]));
});
test('catalogue accepts exact decimal prices up to two fractional digits', () => {
  const decimal = [{...catalog[0],items:[{...catalog[0].items[0],options:[{...catalog[0].items[0].options[0],packs:[['نصف',1.5]]}]}]}];
  assert.equal(validateCatalog(decimal)[0].items[0].options[0].packs[0][1], 1.5);
  const tooPrecise = [{...catalog[0],items:[{...catalog[0].items[0],options:[{...catalog[0].items[0].options[0],packs:[['غير صالح',1.234]]}]}]}];
  assert.throws(() => validateCatalog(tooPrecise), /INVALID_PACK_PRICE/);
});
test('catalogue API URLs require public HTTPS hosts without credentials or custom ports', () => {
  assert.equal(validateCatalogApiUrl('https://catalog.vendor.net/v1/catalog').hostname,'catalog.vendor.net');
  for (const url of ['http://catalog.vendor.net/items','https://127.0.0.1/catalog','https://localhost/catalog',
    'https://service.local/catalog','https://catalog.vendor.net:8443/items','https://user:pass@catalog.vendor.net/items']) {
    assert.throws(() => validateCatalogApiUrl(url));
  }
});

test('product write API adds a valid product and upserts matching product IDs', () => {
  const product = {...catalog[0].items[0],id:'api-product',name:'API Product'};
  const added = upsertCatalogProduct(catalog,'games',product);
  assert.equal(added.created,true);
  assert.equal(added.catalog[0].items.at(-1).id,'api-product');
  const updated = upsertCatalogProduct(added.catalog,'games',{...product,name:'API Product Updated'});
  assert.equal(updated.created,false);
  assert.equal(updated.catalog[0].items.at(-1).name,'API Product Updated');
  assert.throws(() => upsertCatalogProduct(catalog,'missing',product),/CATEGORY_NOT_FOUND/);
});
test('reads configured FX response paths and converts legacy units', () => {
  assert.equal(getJsonPath({data:{usd:{buy:14500}}}, 'data.usd.buy'), 14500);
  assert.equal(normalizeFxRate(14500, 'old'), 145);
  assert.equal(normalizeFxRate('145', 'new'), 145);
  assert.throws(() => normalizeFxRate(0, 'new'));
});

test('catalog merge upserts matching products without deleting local-only products', () => {
  const original = validateCatalog(catalog);
  const incoming = [{...catalog[0],name:'ألعاب محدثة',items:[{...catalog[0].items[0],name:'Free Fire API'}]}];
  const merged = mergeCatalog(original,incoming);
  assert.equal(merged[0].name,'ألعاب محدثة');
  assert.equal(merged[0].items[0].name,'Free Fire API');
  assert.equal(merged[0].items.length,1);
});
test('catalog merge preserves existing products and appends products from incoming categories', () => {
  const original = [{...catalog[0],items:[catalog[0].items[0],{...catalog[0].items[0],id:'pubg',name:'PUBG'}]}];
  const incoming = [{...catalog[0],items:[{...catalog[0].items[0],name:'Free Fire API'},{...catalog[0].items[0],id:'roblox',name:'Roblox'}]}];
  const merged = mergeCatalog(original,incoming);
  assert.deepEqual(merged[0].items.map(item=>item.id),['freefire','roblox','pubg']);
});
test('catalog replace mode is explicit', () => {
  const replacement = [{...catalog[0],name:'Replaced'}];
  assert.equal(mergeCatalog(catalog,replacement,'replace')[0].name,'Replaced');
  assert.throws(() => mergeCatalog(catalog,replacement,'unknown'),/INVALID_CATALOG_SYNC_MODE/);
});
