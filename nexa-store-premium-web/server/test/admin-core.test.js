import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminSession, verifyAdminSession, encryptSecret, decryptSecret,
  isSafeCatalogImage, validateCatalog, getJsonPath, normalizeFxRate,
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
test('reads configured FX response paths and converts legacy units', () => {
  assert.equal(getJsonPath({data:{usd:{buy:14500}}}, 'data.usd.buy'), 14500);
  assert.equal(normalizeFxRate(14500, 'old'), 145);
  assert.equal(normalizeFxRate('145', 'new'), 145);
  assert.throws(() => normalizeFxRate(0, 'new'));
});
