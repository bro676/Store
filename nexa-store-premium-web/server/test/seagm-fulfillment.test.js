import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySeagmFulfillmentError,
  evaluateSeagmOrder,
  nextSeagmPollDelay,
  SEAGM_FULFILLMENT_LIMITS,
} from '../src/seagm-fulfillment.js';

const base = {
  kind: 'card',
  merchantOrderId: 'NX-0123456789ABCDEF0123',
  typeId: 49,
  quantity: 2,
};
const cardOrder = (overrides = {}) => ({
  id: 17401657,
  mch_order_id: base.merchantOrderId,
  type_id: base.typeId,
  buy_amount: base.quantity,
  status_code: 10003,
  pay_status_code: 2,
  send_status_code: 3,
  cards: [
    { card_number: 'CARD-001', card_pin: 'PIN-001', expired: '2028-12' },
    { card_number: 'CARD-002', card_pin: 'PIN-002', expired: '2028-12' },
  ],
  ...overrides,
});

test('completed card orders require matching merchant id, type, quantity and paid delivery state', () => {
  const result = evaluateSeagmOrder({ ...base, providerOrder: cardOrder() });
  assert.equal(result.action, 'completed');
  assert.equal(result.metadata.id, '17401657');
  assert.equal(result.result.cards.length, 2);
  assert.equal(result.result.cards[0].cardNumber, 'CARD-001');
  assert.equal(result.result.cards[1].cardPin, 'PIN-002');
});

test('card order is not marked completed if a card serial or PIN is missing', () => {
  const result = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ cards: [{ card_number: 'CARD-001', card_pin: 'PIN-001' }] }),
  });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_CARD_DATA_INCOMPLETE');
});

test('direct recharge completion stores the amount and a normalized sent time', () => {
  const result = evaluateSeagmOrder({
    ...base,
    kind: 'recharge',
    quantity: 1,
    providerOrder: {
      id: 88, mch_order_id: base.merchantOrderId, type_id: base.typeId, buy_amount: 1,
      status_code: 10003, pay_status_code: 2, send_status_code: 3,
      sent_amount: '100', sent_time: 1799999999,
    },
  });
  assert.equal(result.action, 'completed');
  assert.equal(result.result.deliveredAmount, '100');
  assert.equal(result.result.sentAt, new Date(1799999999 * 1000).toISOString());
});

test('supplier merchant order id mismatch never delivers a purchase', () => {
  const result = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ mch_order_id: 'OTHER-ORDER' }),
  });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_ORDER_DETAILS_MISMATCH');
});

test('supplier product type mismatch never delivers a purchase', () => {
  const result = evaluateSeagmOrder({ ...base, providerOrder: cardOrder({ type_id: 999 }) });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_ORDER_DETAILS_MISMATCH');
});

test('supplier quantity mismatch never delivers a purchase', () => {
  const result = evaluateSeagmOrder({ ...base, providerOrder: cardOrder({ buy_amount: 1 }) });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_ORDER_DETAILS_MISMATCH');
});

test('pending and processing supplier orders are polled, not re-purchased', () => {
  const pending = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ status_code: 10001, send_status_code: 1 }),
    attemptCount: 1,
  });
  const processing = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ status_code: 10002, send_status_code: 2 }),
    attemptCount: 2,
  });
  assert.equal(pending.action, 'retry');
  assert.equal(pending.delaySeconds, 30);
  assert.equal(processing.action, 'retry');
  assert.equal(processing.delaySeconds, 30);
});

test('pending supplier order with unconfirmed provider-side payment goes to manual review', () => {
  const result = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ status_code: 10001, pay_status_code: 1 }),
  });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_SUPPLIER_PAYMENT_NOT_CONFIRMED');
});

test('supplier polling stops after the configured pending-check limit', () => {
  assert.equal(nextSeagmPollDelay(1), 30);
  assert.equal(nextSeagmPollDelay(2), 30);
  assert.equal(nextSeagmPollDelay(20), 300);
  assert.equal(SEAGM_FULFILLMENT_LIMITS.maxPendingChecks, 120);
  const result = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ status_code: 10002, send_status_code: 2 }),
    attemptCount: SEAGM_FULFILLMENT_LIMITS.maxPendingChecks,
  });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_PENDING_TIMEOUT');
});

test('refund and unknown provider states require manual review', () => {
  const refunded = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ status_code: 10004, pay_status_code: 3 }),
  });
  const unknown = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ status_code: 77777, pay_status_code: 2 }),
  });
  assert.equal(refunded.action, 'manual_review');
  assert.equal(refunded.errorText, 'SEAGM_ORDER_REFUNDED');
  assert.equal(unknown.action, 'manual_review');
  assert.equal(unknown.errorText, 'SEAGM_UNEXPECTED_ORDER_STATUS');
});

test('provider 429 honours Retry-After and schedules a bounded retry', () => {
  const result = classifySeagmFulfillmentError(
    { status: 429, code: 'SEAGM_RATE_LIMITED', retryAfter: 90, message: 'rate limited' },
    0,
  );
  assert.equal(result.action, 'retry');
  assert.equal(result.failureCount, 1);
  assert.equal(result.delaySeconds, 90);
});

test('provider 418 never retries after its IP-block response', () => {
  const result = classifySeagmFulfillmentError(
    { status: 418, code: 'SEAGM_IP_BLOCKED', message: 'blocked' },
    0,
  );
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_IP_BLOCKED');
});

test('transient network and server errors use exponential backoff', () => {
  const network = classifySeagmFulfillmentError(new TypeError('network failed'), 0);
  const server = classifySeagmFulfillmentError({ status: 503, code: 'PROVIDER_ERROR' }, 2);
  assert.equal(network.action, 'retry');
  assert.equal(network.delaySeconds, 10);
  assert.equal(server.action, 'retry');
  assert.equal(server.failureCount, 3);
  assert.equal(server.delaySeconds, 40);
});

test('duplicate merchant-order response is retried for lookup recovery', () => {
  const result = classifySeagmFulfillmentError({ code: 20135, message: 'Duplicate merchant order id' }, 0);
  assert.equal(result.action, 'retry');
});

test('non-retryable provider validation and insufficient-credit errors go to manual review', () => {
  const validation = classifySeagmFulfillmentError({ status: 400, code: 20133, message: 'Invalid account' }, 0);
  const credits = classifySeagmFulfillmentError({ status: 400, code: 20129, message: 'Insufficient credits' }, 0);
  assert.equal(validation.action, 'manual_review');
  assert.equal(credits.action, 'manual_review');
});

test('transient errors stop retrying after the retry limit', () => {
  const result = classifySeagmFulfillmentError({ status: 503, code: 'UPSTREAM' }, 12);
  assert.equal(result.action, 'manual_review');
  assert.equal(result.failureCount, 12);
});

test('SEAGM fulfilment is queued only after Sham Cash invoice and transaction verification succeeds', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const paidUpdate = server.indexOf("UPDATE nexa_orders SET status='paid'");
  const enqueue = server.indexOf('INSERT INTO nexa_fulfillment_jobs(order_id,status,next_attempt_at)', paidUpdate);
  const commit = server.indexOf("await client.query('COMMIT')", enqueue);
  assert.ok(paidUpdate >= 0, 'payment state must be updated');
  assert.ok(enqueue > paidUpdate, 'supplier job must be enqueued after payment is marked paid');
  assert.ok(commit > enqueue, 'supplier job must be committed in the same payment transaction');
  assert.match(server.slice(enqueue, commit), /ON CONFLICT\(order_id\) DO NOTHING/);
});

test('supplier order is reconciled by the same merchant order ID before any create call', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const start = server.indexOf('async function processSeagmFulfillmentJob(job)');
  const end = server.indexOf('async function runSeagmFulfillmentWorker()', start);
  const worker = server.slice(start, end);
  const lookup = worker.indexOf('client.getOrderByMerchantId(job.supplier_kind,merchantOrderId)');
  const create = worker.indexOf('client.createCardOrder');
  assert.ok(start >= 0 && end > start, 'fulfilment worker must exist');
  assert.ok(lookup >= 0 && create > lookup, 'existing supplier order must be checked before a new purchase');
  assert.match(worker, /if\(!providerOrder\)/);
  assert.match(worker, /client.getOrderByMerchantId\(job.supplier_kind,merchantOrderId\)/);
});

test('delivered card data is encrypted at rest and only decrypted for the order receipt', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /resultEncrypted:encryptSecret\(JSON\.stringify\(decision\.result\),cfg\.settingsEncryptionKey\)/);
  assert.match(server, /decryptSecret\(order\.supplier_result_encrypted,cfg\.settingsEncryptionKey\)/);
  assert.match(server, /supplier_result_encrypted=CASE WHEN \$5<>'' THEN \$5 ELSE supplier_result_encrypted END/);
});

test('SEAGM retry failure counter is persisted separately from provider status polling', async () => {
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../migrations/005_seagm_fulfillment_reliability.sql', import.meta.url), 'utf8');
  assert.match(migration, /failure_count INTEGER NOT NULL DEFAULT 0/);
  assert.match(server, /failure_count=COALESCE\(\$9,failure_count\)/);
  assert.match(server, /classifySeagmFulfillmentError\(error,Number\(job\.failure_count\|\|0\)\)/);
  assert.match(server, /failure_count=0,next_attempt_at=NOW\(\)/);
});

test('SEAGM delivery is not marked complete for a non-documented send status', () => {
  const result = evaluateSeagmOrder({
    ...base,
    providerOrder: cardOrder({ send_status_code: 4 }),
  });
  assert.equal(result.action, 'manual_review');
  assert.equal(result.errorText, 'SEAGM_UNEXPECTED_ORDER_STATUS');
});
