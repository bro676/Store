import test from 'node:test';
import assert from 'node:assert/strict';
import { wamdaOrderDecision, classifyWamdaError } from '../src/wamda-fulfillment.js';

test('pending and processing Wamda orders are polled again',()=>{
  for(const status of ['pending','processing']){
    const decision=wamdaOrderDecision({orderId:'123',status,deliveredData:'waiting'});
    assert.equal(decision.action,'retry');
    assert.equal(decision.status,'waiting');
  }
});
test('only completed Wamda status is accepted as delivery',()=>{
  const decision=wamdaOrderDecision({orderId:'123',status:'completed',deliveredData:'voucher'});
  assert.equal(decision.action,'completed');
  assert.equal(decision.result.deliveredData,'voucher');
});
test('rejected orders go to manual review',()=>{
  const decision=wamdaOrderDecision({orderId:'123',status:'rejected',deliveredData:'invalid id'});
  assert.equal(decision.action,'manual_review');
});
test('transient errors retry with bounded backoff; business errors do not',()=>{
  assert.equal(classifyWamdaError({status:503,code:'WAMDA_NETWORK_ERROR'},1).action,'retry');
  assert.equal(classifyWamdaError({status:400,code:121},1).action,'manual_review');
});
