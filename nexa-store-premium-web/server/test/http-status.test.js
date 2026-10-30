import test from 'node:test';
import assert from 'node:assert/strict';
import { httpStatusForResult, isHttpErrorResult, safeHttpStatus } from '../src/http-status.js';

test('order success state is JSON data, not an HTTP code', () => {
  assert.equal(httpStatusForResult({ok:true,status:'pending_payment'},201),201);
});
test('payment success state remains HTTP 200', () => {
  assert.equal(httpStatusForResult({ok:true,status:'paid'},200),200);
});
test('real HTTP errors preserve their numeric status', () => {
  assert.equal(httpStatusForResult({error:'ORDER_EXPIRED',status:410},201),410);
  assert.equal(httpStatusForResult({error:'RATE_LIMIT',status:429},200),429);
});
test('invalid business status cannot be passed to writeHead', () => {
  assert.equal(isHttpErrorResult({error:'FAILED',status:'pending_payment'}),false);
  assert.equal(httpStatusForResult({error:'FAILED',status:'pending_payment'},201),201);
  assert.equal(safeHttpStatus('paid'),500);
  assert.equal(safeHttpStatus(700),500);
});
test('valid HTTP statuses pass through safely', () => {
  assert.equal(safeHttpStatus(201),201);
  assert.equal(safeHttpStatus(503),503);
});
