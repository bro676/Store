import test from 'node:test';
import assert from 'node:assert/strict';
import { convertSypMinorToUsdMinor, SYP_PER_USD } from '../src/exchange-rate.js';
test('store uses the fixed 145 new SYP per USD rate', () => {
  assert.equal(SYP_PER_USD, 145);
});
test('converts exact multiples from new SYP to USD', () => {
  assert.equal(convertSypMinorToUsdMinor(14500n), 100n);
  assert.equal(convertSypMinorToUsdMinor(29000n), 200n);
});
test('rounds converted USD to the nearest cent', () => {
  assert.equal(convertSypMinorToUsdMinor(7250n), 50n);
  assert.equal(convertSypMinorToUsdMinor(7175n), 49n);
});
test('rejects negative SYP amounts', () => {
  assert.throws(() => convertSypMinorToUsdMinor(-1n), RangeError);
});
