import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerPreferences, mergeCustomerPreferences } from '../src/customer-preferences.js';

test('normalizes stored preferences, supports USD and safely handles unsupported legacy currencies',()=>{
 const usd=normalizeCustomerPreferences({locale:'en',theme:'dark',displayCurrency:'USD',favorites:['product-1',' product-1 ','',42,'bad\\nvalue']});
 assert.deepEqual(usd,{locale:'en',theme:'dark',displayCurrency:'USD',favorites:['product-1']});
 const legacy=normalizeCustomerPreferences({locale:'ar',displayCurrency:'TRY'});
 assert.deepEqual(legacy,{locale:'ar',displayCurrency:'SYP',favorites:[]});
});

test('merges USD and SYP display preferences while preserving other account settings',()=>{
 const usd=mergeCustomerPreferences({locale:'ar',theme:'light',displayCurrency:'SYP',favorites:['old-item']},{locale:'en',displayCurrency:'USD',theme:'dark',favorites:['new-item','new-item']});
 assert.deepEqual(usd,{locale:'en',theme:'dark',displayCurrency:'USD',favorites:['new-item']});
 const syp=mergeCustomerPreferences(usd,{displayCurrency:'SYP'});
 assert.equal(syp.displayCurrency,'SYP');
});

test('rejects invalid preferences and oversized favourite lists',()=>{
 for(const patch of [{locale:'fr'},{locale:'tr'},{theme:'blue'},{displayCurrency:'EUR'},{displayCurrency:'TRY'},{favorites:'bad'},{favorites:['']},{favorites:['x\\u0000y']},{favorites:new Array(201).fill('id')}])assert.throws(()=>mergeCustomerPreferences({},patch),{code:'INVALID_CUSTOMER_PREFERENCES'});
 assert.deepEqual(mergeCustomerPreferences({}, {favorites:[]}).favorites,[]);
 assert.deepEqual(normalizeCustomerPreferences({locale:'ar',displayCurrency:'TRY'}),{locale:'ar',displayCurrency:'SYP',favorites:[]},'Legacy unsupported currency falls back to SYP');
 assert.equal(normalizeCustomerPreferences({displayCurrency:'USD'}).displayCurrency,'USD');
 assert.throws(()=>mergeCustomerPreferences({}, {locale:'fr'}),{code:'INVALID_CUSTOMER_PREFERENCES'});
});
