import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerPreferences, mergeCustomerPreferences } from '../src/customer-preferences.js';

test('normalizes stored preferences and removes invalid favourite ids',()=>{
 const result=normalizeCustomerPreferences({locale:'en',theme:'dark',displayCurrency:'USD',favorites:['product-1',' product-1 ','',42,'bad\nvalue']});
 assert.deepEqual(result,{locale:'en',theme:'dark',displayCurrency:'USD',favorites:['product-1']});
});

test('merges partial preferences and preserves all other account settings',()=>{
 const result=mergeCustomerPreferences({locale:'ar',theme:'light',displayCurrency:'SYP',favorites:['old-item']},{theme:'dark',favorites:['new-item','new-item']});
 assert.deepEqual(result,{locale:'ar',theme:'dark',displayCurrency:'SYP',favorites:['new-item']});
});

test('rejects invalid preferences and oversized favourite lists',()=>{
 for(const patch of [{locale:'fr'},{theme:'blue'},{displayCurrency:'EUR'},{favorites:'bad'},{favorites:['']},{favorites:['x\u0000y']},{favorites:new Array(201).fill('id')}])assert.throws(()=>mergeCustomerPreferences({},patch),{code:'INVALID_CUSTOMER_PREFERENCES'});
 assert.deepEqual(mergeCustomerPreferences({}, {favorites:[]}).favorites,[]);
});
