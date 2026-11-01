import test from 'node:test';
import assert from 'node:assert/strict';
import { expirePendingOrders, EXPIRE_PENDING_ORDERS_SQL } from '../src/order-expiry.js';

test('expiry sweep only transitions unpaid orders whose invoice has expired', async () => {
  assert.match(EXPIRE_PENDING_ORDERS_SQL, /WHERE status='pending_payment'/);
  assert.match(EXPIRE_PENDING_ORDERS_SQL, /expires_at<=NOW\(\)/);
  assert.match(EXPIRE_PENDING_ORDERS_SQL, /SET status='expired'/);
  assert.match(EXPIRE_PENDING_ORDERS_SQL, /RETURNING id/);
  assert.doesNotMatch(EXPIRE_PENDING_ORDERS_SQL, /DELETE FROM/i);
  let called = 0;
  const count = await expirePendingOrders({
    async query(sql) {
      called += 1;
      assert.equal(sql, EXPIRE_PENDING_ORDERS_SQL);
      return { rowCount: 3, rows: [{ id: 'NX-A' }, { id: 'NX-B' }, { id: 'NX-C' }] };
    },
  });
  assert.equal(called, 1);
  assert.equal(count, 3);
});

test('expiry sweep is safe without a configured database', async () => {
  assert.equal(await expirePendingOrders(null), 0);
  assert.equal(await expirePendingOrders(undefined), 0);
});

test('expiry sweep reports zero when no orders need transition', async () => {
  const count = await expirePendingOrders({ async query() { return { rowCount: 0, rows: [] }; } });
  assert.equal(count, 0);
});
