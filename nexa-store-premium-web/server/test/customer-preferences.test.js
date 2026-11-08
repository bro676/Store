import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerPreferences, mergeCustomerPreferences } from '../src/customer-preferences.js';

test('normalizes stored preferences and removes invalid favourite ids',()=>{
 const result=normalizeCustomerPreferences({locale:'en',theme:'dark',displayCurrency:'TRY',favorites:['product-1',' product-1 ','',42,'bad\nvalue']});
 assert.deepEqual(result,{locale:'en',theme:'dark',displayCurrency:'SYP',favorites:['product-1']});
});

test('merges partial preferences and preserves all other account settings',()=>{
 const result=mergeCustomerPreferences({locale:'ar',theme:'light',displayCurrency:'TRY',favorites:['old-item']},{locale:'en',displayCurrency:'SYP',theme:'dark',favorites:['new-item','new-item']});
 assert.deepEqual(result,{locale:'en',theme:'dark',displayCurrency:'SYP',favorites:['new-item']});
});

test('rejects invalid preferences and oversized favourite lists',()=>{
 for(const patch of [{locale:'fr'},{locale:'tr'},{theme:'blue'},{displayCurrency:'EUR'},{displayCurrency:'TRY'},{favorites:'bad'},{favorites:['']},{favorites:['x\u0000y']},{favorites:new Array(201).fill('id')}])assert.throws(()=>mergeCustomerPreferences({},patch),{code:'INVALID_CUSTOMER_PREFERENCES'});
 assert.deepEqual(mergeCustomerPreferences({}, {favorites:[]}).favorites,[]);
 assert.deepEqual(normalizeCustomerPreferences({locale:'ar',displayCurrency:'TRY'}),{locale:'ar',displayCurrency:'SYP',favorites:[]},'Legacy SYP display preference migrates to USD');
 assert.throws(()=>mergeCustomerPreferences({}, {locale:'fr'}),{code:'INVALID_CUSTOMER_PREFERENCES'});
});
