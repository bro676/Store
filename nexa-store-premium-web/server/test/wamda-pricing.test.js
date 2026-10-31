import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWamdaMargin,
  normalizeWamdaPricingRule,
  resolveWamdaPricingRule,
  calculateWamdaSellPriceSyp,
  updateWamdaPublishedProduct,
  markWamdaProductUnavailable,
} from '../src/wamda-pricing.js';

test('calculates percentage profit over USD API cost converted with the store FX rate',()=>{
  assert.equal(calculateWamdaSellPriceSyp({unitPriceUsd:10,fxRate:145,marginPercent:20}),1740);
});
test('calculates a fixed SYP profit amount over the converted API cost',()=>{
  assert.equal(calculateWamdaSellPriceSyp({unitPriceUsd:10,fxRate:145,pricingRule:{mode:'fixed_profit',value:500}}),1950);
});
test('rounds automatic sell prices to two decimals',()=>{
  assert.equal(calculateWamdaSellPriceSyp({unitPriceUsd:1.234,fxRate:145,marginPercent:10}),196.82);
});
test('validates fixed price and pricing rule bounds',()=>{
  assert.equal(normalizeWamdaPricingRule({mode:'fixed_profit',value:0}).value,0);
  assert.throws(()=>normalizeWamdaPricingRule({mode:'fixed_price',value:0}));
  assert.throws(()=>normalizeWamdaPricingRule({mode:'percent',value:1001}));
  assert.throws(()=>normalizeWamdaMargin(-1),error=>error.status===400);
  assert.throws(()=>calculateWamdaSellPriceSyp({unitPriceUsd:1,fxRate:0,marginPercent:10}),error=>error.status===422);
});
test('product rule takes precedence over category and global policies',()=>{
  assert.deepEqual(resolveWamdaPricingRule({
    globalRule:{mode:'percent',value:10},
    categoryRule:{mode:'fixed_profit',value:250},
    productRule:{mode:'percent',value:20},
  }),{rule:{mode:'percent',value:20},source:'product'});
});
test('category rule takes precedence over the global policy when product inherits',()=>{
  assert.deepEqual(resolveWamdaPricingRule({
    globalRule:{mode:'percent',value:10},
    categoryRule:{mode:'fixed_profit',value:250},
    productRule:{mode:'inherit'},
  }),{rule:{mode:'fixed_profit',value:250},source:'category'});
});
test('published products update automatically when supplier cost changes',()=>{
  const existing={id:'wamda-15',name:'Old',options:[{id:'x',packs:[['Price',100]]}],wamda:{provider:'wamda',priceMode:'auto',pricingOverride:{mode:'inherit'}}};
  const first=updateWamdaPublishedProduct(existing,{id:15,categoryId:4,name:'A',unitPrice:2,available:true,fields:[]},{fxRate:145,globalRule:{mode:'fixed_profit',value:100}});
  const second=updateWamdaPublishedProduct(first,{id:15,categoryId:4,name:'A',unitPrice:3,available:true,fields:[]},{fxRate:145,globalRule:{mode:'fixed_profit',value:100}});
  assert.equal(first.options[0].packs[0][1],390);
  assert.equal(second.options[0].packs[0][1],535);
});
test('product fixed selling price remains unchanged through API cost refreshes',()=>{
  const existing={id:'wamda-15',name:'Old',options:[{id:'x',packs:[['Price',777]]}],wamda:{provider:'wamda',priceMode:'manual',manualPriceSyp:777}};
  const first=updateWamdaPublishedProduct(existing,{id:15,categoryId:4,name:'A',unitPrice:2,available:true,fields:[]},{fxRate:145,globalRule:{mode:'percent',value:20}});
  const second=updateWamdaPublishedProduct(first,{id:15,categoryId:4,name:'A',unitPrice:9,available:true,fields:[]},{fxRate:200,globalRule:{mode:'fixed_profit',value:900}});
  assert.equal(first.options[0].packs[0][1],777);
  assert.equal(second.options[0].packs[0][1],777);
  assert.equal(second.wamda.priceMode,'manual');
});
test('an explicit product override can use its own automatic fixed profit rule',()=>{
  const existing={id:'wamda-15',options:[{id:'x',packs:[['Price',777]]}],wamda:{provider:'wamda'}};
  const product=updateWamdaPublishedProduct(existing,{id:15,categoryId:4,name:'A',unitPrice:3,available:true,fields:[],pricingOverride:{mode:'fixed_profit',value:50}},
    {fxRate:200,globalRule:{mode:'percent',value:20},categoryRule:{mode:'fixed_profit',value:600}});
  assert.equal(product.options[0].packs[0][1],650);
  assert.equal(product.wamda.pricingSource,'product');
  assert.equal(product.wamda.priceMode,'auto');
});
test('resetting a product override returns it to inherited automatic pricing',()=>{
  const existing={id:'wamda-15',options:[{id:'x',packs:[['Price',777]]}],wamda:{provider:'wamda',priceMode:'manual',manualPriceSyp:777}};
  const product=updateWamdaPublishedProduct(existing,{id:15,categoryId:4,name:'A',unitPrice:3,available:true,fields:[]},
    {fxRate:200,globalRule:{mode:'percent',value:40},forceAutomatic:true});
  assert.equal(product.options[0].packs[0][1],840);
  assert.equal(product.wamda.priceMode,'auto');
  assert.deepEqual(product.wamda.pricingOverride,{mode:'inherit'});
});
test('products missing from the latest API snapshot are marked unavailable without deleting price data',()=>{
  const existing={id:'wamda-15',options:[{packs:[['Price',777]]}],wamda:{provider:'wamda',available:true}};
  const product=markWamdaProductUnavailable(existing,'2026-10-31T12:00:00.000Z');
  assert.equal(product.wamda.available,false);
  assert.equal(product.wamda.missingFromLatestSync,true);
  assert.equal(product.options[0].packs[0][1],777);
});
