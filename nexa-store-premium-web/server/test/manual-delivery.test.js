import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linkedSupplierForProduct,
  resolveProductFulfillment,
  buildManualDeliveryMessage,
  normalizeManualDeliveryDetails,
} from '../src/manual-delivery.js';

test('products linked to supplier APIs default to automatic fulfillment',()=>{
  const product={seagm:{provider:'seagm',typeId:22}};
  const config=resolveProductFulfillment(product);
  assert.equal(config.valid,true);
  assert.equal(config.mode,'automatic');
  assert.equal(config.supplier.provider,'seagm');
  assert.equal(linkedSupplierForProduct(product).typeId,22);
});

test('manual fulfillment can override a linked supplier and keeps the provider out of the worker path',()=>{
  const config=resolveProductFulfillment({
    wamda:{provider:'wamda',productId:10},
    fulfillmentMode:'manual',
    manualDeliveryHours:12,
    manualDeliveryMessage:'جهّزنا طلبك خلال {hours} ساعة.',
  });
  assert.equal(config.valid,true);
  assert.equal(config.mode,'manual');
  assert.equal(config.provider,'manual');
  assert.equal(config.supplier,null);
  assert.equal(buildManualDeliveryMessage(config.manualDeliveryMessage,config.manualDeliveryHours),'جهّزنا طلبك خلال 12 ساعة.');
});

test('products without a supplier default to manual fulfillment and reject invalid automatic mode',()=>{
  assert.equal(resolveProductFulfillment({}).mode,'manual');
  assert.equal(resolveProductFulfillment({fulfillmentMode:'automatic'}).error,'AUTOMATIC_FULFILLMENT_NOT_CONFIGURED');
});

test('manual delivery ETA and message settings are bounded and normalized',()=>{
  assert.equal(resolveProductFulfillment({manualDeliveryHours:720}).manualDeliveryHours,720);
  assert.equal(resolveProductFulfillment({manualDeliveryHours:721}).error,'INVALID_MANUAL_DELIVERY_HOURS');
  assert.equal(resolveProductFulfillment({manualDeliveryMessage:'x'.repeat(241)}).error,'INVALID_MANUAL_DELIVERY_MESSAGE');
  assert.match(buildManualDeliveryMessage('',8),/8 ساعة كحد أقصى/);
  assert.match(buildManualDeliveryMessage('التسليم قريب',3),/3 ساعة كحد أقصى/);
});

test('manual credentials/details are validated but can contain multi-line text',()=>{
  assert.equal(normalizeManualDeliveryDetails('البريد: user@example.com\nكلمة المرور: abc123'),'البريد: user@example.com\nكلمة المرور: abc123');
  assert.throws(()=>normalizeManualDeliveryDetails(''));
  assert.throws(()=>normalizeManualDeliveryDetails('x'.repeat(8001)));
});
