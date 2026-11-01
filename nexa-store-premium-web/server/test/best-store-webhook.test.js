import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyBestStoreWebhookSecret,
  parseBestStoreWebhookBody,
  isBestStoreWebhookTest,
  resolveBestStoreWebhookReference,
} from '../src/best-store-webhook.js';

const ORDER_UUID = '123e4567-e89b-42d3-a456-426614174000';

test('Best Store webhook path secret is compared in constant time and requires a strong configured secret', () => {
  const secret = 'a'.repeat(48);
  assert.equal(verifyBestStoreWebhookSecret(secret, secret), true);
  assert.equal(verifyBestStoreWebhookSecret(secret.slice(1), secret), false);
  assert.equal(verifyBestStoreWebhookSecret('short', 'short'), false);
  assert.equal(verifyBestStoreWebhookSecret(secret, ''), false);
});

test('Best Store webhook accepts JSON and form-encoded payloads without trusting their status', () => {
  assert.deepEqual(parseBestStoreWebhookBody(JSON.stringify({ order_uuid:ORDER_UUID }), 'application/json'), { order_uuid:ORDER_UUID });
  assert.deepEqual(parseBestStoreWebhookBody('order_id=ID_123&status=accept', 'application/x-www-form-urlencoded'), { order_id:'ID_123', status:'accept' });
  assert.throws(() => parseBestStoreWebhookBody('{broken', 'application/json'), /INVALID_JSON/);
  assert.throws(() => parseBestStoreWebhookBody('x=1&x=2', 'application/x-www-form-urlencoded'), /DUPLICATE_FIELD/);
});

test('Best Store test callbacks are acknowledged separately from real orders', () => {
  assert.equal(isBestStoreWebhookTest({ test:true, event:'callback.test' }), true);
  assert.equal(isBestStoreWebhookTest({ type:'test' }), true);
  assert.equal(isBestStoreWebhookTest({ status:'accept', order_uuid:ORDER_UUID }), false);
});

test('Best Store webhook resolves UUID, provider order ID and Nexa order ID from common payload shapes', () => {
  assert.deepEqual(resolveBestStoreWebhookReference({ data:{ order_uuid:ORDER_UUID } }), { kind:'uuid', value:ORDER_UUID });
  assert.deepEqual(resolveBestStoreWebhookReference({ order_id:'ID_ABC123' }), { kind:'provider', value:'ID_ABC123' });
  assert.deepEqual(resolveBestStoreWebhookReference({ merchant_order_id:'NX-123ABC' }), { kind:'merchant', value:'NX-123ABC' });
  assert.deepEqual(resolveBestStoreWebhookReference({}, new URLSearchParams('uuid='+ORDER_UUID)), { kind:'uuid', value:ORDER_UUID });
  assert.equal(resolveBestStoreWebhookReference({ status:'accept' }), null);
});

test('Best Store webhook rejects invalid or conflicting order references', () => {
  assert.throws(() => resolveBestStoreWebhookReference({ order_uuid:'not-a-uuid' }), /INVALID_ORDER_UUID/);
  assert.throws(() => resolveBestStoreWebhookReference({ order_uuid:ORDER_UUID, data:{ order_uuid:'423e4567-e89b-42d3-a456-426614174000' } }), /INVALID_ORDER_UUID/);
  assert.throws(() => resolveBestStoreWebhookReference({ order_id:'unsafe/id' }), /INVALID_PROVIDER_ORDER_ID/);
});
