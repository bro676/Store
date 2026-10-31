import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCustomerPhone, hashCustomerPassword, verifyCustomerPassword,
  createCustomerSessionToken, hashCustomerSessionToken,
} from '../src/customer-wallet.js';

test('customer phone numbers are normalized without changing digits',()=>{
  assert.equal(normalizeCustomerPhone(' +963 933-123-456 '),'+963933123456');
  assert.equal(normalizeCustomerPhone('00963933123456'),'00963933123456');
  assert.equal(normalizeCustomerPhone('abc'),'');
  assert.equal(normalizeCustomerPhone('123'),'');
  assert.equal(normalizeCustomerPhone('+12+3456789'),'');
});

test('customer passwords use salted scrypt hashes and verify safely',()=>{
  const hash=hashCustomerPassword('strong-pass-2026');
  assert.match(hash,/^scrypt\$/);
  assert.notEqual(hash,'strong-pass-2026');
  assert.equal(verifyCustomerPassword('strong-pass-2026',hash),true);
  assert.equal(verifyCustomerPassword('wrong-pass',hash),false);
  assert.throws(()=>hashCustomerPassword('short'),/كلمة المرور/);
});

test('customer session tokens are random and stored as one-way hashes',()=>{
  const token=createCustomerSessionToken();
  assert.match(token,/^[A-Za-z0-9_-]{40,60}$/);
  const hash=hashCustomerSessionToken(token);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.notEqual(hash,token);
  assert.equal(hashCustomerSessionToken('bad-token'),'');
});
