import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSeagmSignature } from '../src/seagm-api.js';
import {
  mergeSeagmCallbackParams,
  parseSeagmCallbackBody,
  verifySeagmCallbackSignature,
  SEAGM_CALLBACK_LIMITS,
} from '../src/seagm-webhook.js';

const SECRET = 'test-seagm-secret-key-with-enough-entropy-for-unit-tests';
const ORDER_ID = 'NX-0123456789ABCDEF0123';

function signedPayload(nowMs = Date.now(), overrides = {}) {
  const payload = {
    id: '17401657',
    trade_id: '11055829',
    mch_order_id: ORDER_ID,
    status_code: '10003',
    pay_status_code: '2',
    send_status_code: '3',
    timestamp: String(Math.floor(nowMs / 1000)),
    ...overrides,
  };
  payload.signature = buildSeagmSignature(payload, SECRET);
  return payload;
}

test('SEAGM callback JSON is parsed as a flat scalar payload', () => {
  const result = parseSeagmCallbackBody(
    JSON.stringify({ mch_order_id: ORDER_ID, status_code: 10003, send_status: 'Done' }),
    'application/json; charset=utf-8',
  );
  assert.equal(result.mch_order_id, ORDER_ID);
  assert.equal(result.status_code, '10003');
  assert.equal(result.send_status, 'Done');
});

test('SEAGM callback form data is parsed and duplicate keys are rejected', () => {
  const result = parseSeagmCallbackBody(
    'mch_order_id=' + ORDER_ID + '&status=Wait+send',
    'application/x-www-form-urlencoded',
  );
  assert.equal(result.mch_order_id, ORDER_ID);
  assert.equal(result.status, 'Wait send');
  assert.throws(
    () => parseSeagmCallbackBody('uid=10001&uid=10002', 'application/x-www-form-urlencoded'),
    /DUPLICATE_SEAGM_CALLBACK_FIELD/,
  );
});

test('callback query and body fields merge without ambiguous duplicate parameters', () => {
  const query = new URLSearchParams('source=seagm');
  const body = parseSeagmCallbackBody('mch_order_id=' + ORDER_ID, 'application/x-www-form-urlencoded');
  const merged = mergeSeagmCallbackParams(query, body);
  assert.equal(merged.source, 'seagm');
  assert.equal(merged.mch_order_id, ORDER_ID);
  assert.throws(
    () => mergeSeagmCallbackParams(new URLSearchParams('uid=10001'), { uid: '10001' }),
    /DUPLICATE_SEAGM_CALLBACK_FIELD/,
  );
});

test('valid callback signatures are accepted with the configured clock window', () => {
  const nowMs = Date.now();
  const payload = signedPayload(nowMs, { uid: '10001' });
  assert.equal(verifySeagmCallbackSignature(payload, SECRET, { expectedUid: '10001', nowMs }), true);
  assert.equal(verifySeagmCallbackSignature(payload, SECRET, { expectedUid: '10002', nowMs }), false);
});

test('callback signature changes, stale timestamps and malformed signatures are rejected', () => {
  const nowMs = Date.now();
  const payload = signedPayload(nowMs);
  assert.equal(verifySeagmCallbackSignature(payload, SECRET, { nowMs }), true);
  assert.equal(verifySeagmCallbackSignature({ ...payload, send_status_code: '1' }, SECRET, { nowMs }), false);
  assert.equal(verifySeagmCallbackSignature(payload, SECRET, { nowMs: nowMs + 180_000 }), false);
  assert.equal(verifySeagmCallbackSignature({ ...payload, signature: 'not-a-signature' }, SECRET, { nowMs }), false);
});

test('callback parsers enforce payload and field limits', () => {
  assert.equal(SEAGM_CALLBACK_LIMITS.maxClockSkewSeconds, 120);
  assert.throws(
    () => parseSeagmCallbackBody('x'.repeat(SEAGM_CALLBACK_LIMITS.maxBytes + 1), 'application/json'),
    error => error.status === 413,
  );
  assert.throws(
    () => parseSeagmCallbackBody(JSON.stringify({ nested: { bad: true } }), 'application/json'),
    /INVALID_SEAGM_CALLBACK_VALUE/,
  );
});

test('HTTP callback route authenticates and only wakes the existing paid-order reconciliation worker', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = server.indexOf("if (req.method === 'POST' && url.pathname === '/api/webhooks/seagm')");
  const end = server.indexOf("if (req.method === 'POST' && url.pathname === '/api/admin/session')", start);
  assert.ok(start >= 0 && end > start, 'public SEAGM callback route must exist before admin routes');
  const route = server.slice(start, end);
  assert.match(route, /verifySeagmCallbackSignature/);
  assert.match(route, /mch_order_id/);
  assert.match(route, /supplier_mch_order_id=\$1/);
  assert.match(route, /o\.status/);
  assert.match(route, /runSeagmFulfillmentWorker\(\)/);
  assert.match(route, /sendText\(res,200,'success'\)/);
  assert.doesNotMatch(route, /SET\s+supplier_status\s*=\s*'completed'/i);
  assert.doesNotMatch(route, /supplier_result_encrypted\s*=/i);
});
