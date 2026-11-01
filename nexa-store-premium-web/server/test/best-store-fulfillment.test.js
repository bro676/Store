import test from 'node:test';
import assert from 'node:assert/strict';
import { bestStoreOrderDecision, classifyBestStoreError } from '../src/best-store-fulfillment.js';

test('accepted Best Store orders complete and retain returned delivery payload',()=>{
  const result=bestStoreOrderDecision({status:'accept',order_id:'BS-17',price:0.10,replay_api:[{code:'PIN'}]});
  assert.equal(result.action,'completed');
  assert.equal(result.result.orderId,'BS-17');
  assert.deepEqual(result.result.data,[{code:'PIN'}]);
});

test('waiting orders retry status checks without changing their original UUID',()=>{
  const result=bestStoreOrderDecision({status:'wait',order_id:'BS-18'});
  assert.equal(result.action,'retry');
  assert.equal(result.delaySeconds,45);
});

test('rejected and unknown provider results go to manual review',()=>{
  assert.equal(bestStoreOrderDecision({status:'reject'}).action,'manual_review');
  assert.equal(bestStoreOrderDecision({status:'unexpected'}).action,'manual_review');
});

test('transient errors use bounded backoff and permanent errors stop',()=>{
  const retry=classifyBestStoreError({status:502,code:'BEST_STORE_NETWORK_ERROR'},0);
  assert.equal(retry.action,'retry');
  assert.equal(retry.delaySeconds,15);
  const stop=classifyBestStoreError({status:400,code:'BAD_REQUEST'},0);
  assert.equal(stop.action,'manual_review');
});
