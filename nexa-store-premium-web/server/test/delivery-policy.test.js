import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELIVERY_POLICY_LIMITS,
  manualPendingMessage,
  resolveDeliveryPolicy,
  validateManualDeliveryInput,
} from '../src/delivery-policy.js';

test('SEAGM products respect the supplier automatic-delivery capability by default', () => {
  assert.equal(resolveDeliveryPolicy({ seagm:{provider:'seagm',autoDelivery:true} }).mode,'automatic');
  assert.equal(resolveDeliveryPolicy({ seagm:{provider:'seagm',autoDelivery:false} }).mode,'manual');
});

test('Wamda and Best Store integrations default to automatic fulfillment', () => {
  assert.equal(resolveDeliveryPolicy({ wamda:{provider:'wamda'} }).mode,'automatic');
  assert.equal(resolveDeliveryPolicy({ bestStore:{provider:'beststore'} }).mode,'automatic');
});

test('manual products default to store fulfillment and cannot be forced to auto without a supplier', () => {
  assert.equal(resolveDeliveryPolicy({}).mode,'manual');
  assert.equal(resolveDeliveryPolicy({deliveryMode:'automatic'}).mode,'manual');
});

test('product-level settings override supplier defaults and sanitize eta/message values', () => {
  const policy=resolveDeliveryPolicy({
    seagm:{provider:'seagm',autoDelivery:true},
    deliveryMode:'manual',
    deliveryEtaHours:6,
    deliveryMessage:'سيتم إرسال طلبك خلال ست ساعات.',
  });
  assert.equal(policy.mode,'manual');
  assert.equal(policy.etaHours,6);
  assert.equal(policy.message,'سيتم إرسال طلبك خلال ست ساعات.');
  assert.equal(resolveDeliveryPolicy({deliveryEtaHours:0}).etaHours,24);
  assert.equal(DELIVERY_POLICY_LIMITS.maxEtaHours,720);
});

test('manual pending message clearly includes the configured deadline', () => {
  assert.match(manualPendingMessage({etaHours:4}),/4 ساعة/);
  assert.equal(manualPendingMessage({etaHours:2,message:'رسالة خاصة'}),'رسالة خاصة');
});

test('manual delivery accepts bounded non-empty text only', () => {
  assert.deepEqual(validateManualDeliveryInput({deliveryData:'Code: ABC-123\nActivation: XYZ',customerMessage:'تم تجهيز طلبك.'}),{
    deliveryData:'Code: ABC-123\nActivation: XYZ',
    customerMessage:'تم تجهيز طلبك.',
  });
  assert.throws(()=>validateManualDeliveryInput({deliveryData:'   '}),{status:400});
  assert.throws(()=>validateManualDeliveryInput({deliveryData: 'x'.repeat(8001)}),{status:400});
  assert.throws(()=>validateManualDeliveryInput({deliveryData:'ok',customerMessage:'x'.repeat(501)}),{status:400});
});
