import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('manual fulfillment is isolated from the automatic supplier purchase queue',async()=>{
  const server=await read('../src/server.js');
  assert.match(server,/o\.delivery_mode='automatic'/);
  assert.match(server,/order\.delivery_mode!=='manual'\s*&&\s*\['seagm','wamda','beststore'\]/);
  assert.match(server,/deliveryPolicy\.mode==='manual'\?'manual_pending'/);
  assert.match(server,/CASE WHEN delivery_mode='manual' THEN 'manual_pending'/);
});

test('manual delivery is admin-only, locked, encrypted, and idempotent',async()=>{
  const server=await read('../src/server.js');
  const routeAt=server.indexOf('const adminManualDeliveryMatch');
  assert.ok(routeAt>0,'Manual completion route exists');
  const route=server.slice(routeAt,server.indexOf('const adminOrderMatch',routeAt));
  assert.match(server,/url\.pathname\.startsWith\('\/api\/admin\/'\)\s*&&\s*!adminAuthorized\(req\)/);
  assert.match(route,/SELECT status,delivery_mode,supplier_status FROM nexa_orders WHERE id=\$1 FOR UPDATE/);
  assert.match(route,/found\.rows\[0\]\.status!==\s*'paid'/);
  assert.match(route,/found\.rows\[0\]\.delivery_mode!==\s*'manual'/);
  assert.match(route,/found\.rows\[0\]\.supplier_status==='completed'/);
  assert.match(route,/encryptSecret\(JSON\.stringify\(\{deliveredData,deliveredAt\}\)/);
  assert.match(route,/supplier_result_encrypted=\$3/);
});

test('customer APIs expose delivery only after payment and return decrypted data to the order owner',async()=>{
  const server=await read('../src/server.js');
  const accountRoute=server.slice(server.indexOf("url.pathname==='/api/account/orders'"),server.indexOf("url.pathname==='/api/wallet/transactions'"));
  const lookupRoute=server.slice(server.indexOf('const orderLookup ='),server.indexOf("if (req.method === 'POST' && url.pathname === '/api/orders')"));
  assert.match(accountRoute,/WHERE o\.customer_id=\$1/);
  assert.match(accountRoute,/item\.status==='paid'\?supplierDeliveryForOrder/);
  assert.match(lookupRoute,/o\.status==='paid'\?supplierDeliveryForOrder/);
  assert.match(server,/if \(order\.supplier_status === 'completed' && order\.supplier_result_encrypted\)/);
});

test('customer delivery credentials are not persisted in local browser storage',async()=>{
  const store=await read('../../index.html');
  assert.match(store,/accountOrderRecords=\(data\.orders\|\|\[\]\)\.map/);
  assert.doesNotMatch(store,/saved\.orders=orders;storageSave\(saved\)/);
  assert.match(store,/data-refresh-order/);
  assert.match(store,/delivery\.deliveredData\?\?delivery\.data/);
});

test('admin has product delivery policy settings and manual delivery action',async()=>{
  const admin=await read('../../admin.html');
  assert.match(admin,/data-path="\$\{base\}\.deliveryMode"/);
  assert.match(admin,/deliveryEtaHours/);
  assert.match(admin,/manual-complete/);
  assert.match(admin,/data-manual-delivery/);
});
