import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeWamdaMargin,
  calculateWamdaSellPriceSyp,
  updateWamdaPublishedProduct,
  markWamdaProductUnavailable,
} from '../src/wamda-pricing.js';

test('calculates one shared percentage over USD API cost converted with the store FX rate',()=>{
  assert.equal(calculateWamdaSellPriceSyp({unitPriceUsd:10,fxRate:145,marginPercent:20}),1740);
});
test('rounds the retail price to two decimals',()=>{
  assert.equal(calculateWamdaSellPriceSyp({unitPriceUsd:1.234,fxRate:145,marginPercent:10}),196.82);
});
test('rejects invalid profit margin and exchange rate',()=>{
  assert.throws(()=>normalizeWamdaMargin(-1),error=>error.status===400);
  assert.throws(()=>calculateWamdaSellPriceSyp({unitPriceUsd:1,fxRate:0,marginPercent:10}),error=>error.status===422);
});
test('published products use automatic price derived from API cost',()=>{
  const product=updateWamdaPublishedProduct({
    id:'wamda-15',name:'Old name',desc:'Old desc',
    options:[{id:'wamda-default',name:'Default',desc:'',packs:[['Price',100]]}],
    wamda:{provider:'wamda',priceMode:'auto'},
  },{id:15,categoryId:4,name:'Updated',description:'Fresh',unitPrice:2,sourcePrice:2,pricePerQuantity:1,minQuantity:1,maxQuantity:3,available:true,fields:[]},
  {fxRate:145,marginPercent:25,syncedAt:'2026-10-31T12:00:00.000Z'});
  assert.equal(product.name,'Updated');
  assert.equal(product.options[0].packs[0][1],362.5);
  assert.equal(product.wamda.priceMode,'auto');
  assert.equal(product.wamda.available,true);
});
test('manual override survives source price and profit margin refreshes',()=>{
  const existing={
    id:'wamda-15',name:'Old',
    options:[{id:'wamda-default',name:'Default',desc:'',packs:[['Price',777]]}],
    wamda:{provider:'wamda',priceMode:'manual',manualPriceSyp:777},
  };
  const product=updateWamdaPublishedProduct(existing,
    {id:15,categoryId:4,name:'New',unitPrice:3,sourcePrice:3,available:true,fields:[]},
    {fxRate:200,marginPercent:40});
  assert.equal(product.options[0].packs[0][1],777);
  assert.equal(product.wamda.priceMode,'manual');
  assert.equal(product.wamda.calculatedPriceSyp,840);
});
test('resetting manual pricing returns the product to automatic margin pricing',()=>{
  const existing={id:'wamda-15',options:[{id:'x',packs:[['Price',777]]}],wamda:{provider:'wamda',priceMode:'manual',manualPriceSyp:777}};
  const product=updateWamdaPublishedProduct(existing,
    {id:15,categoryId:4,name:'New',unitPrice:3,sourcePrice:3,available:true,fields:[]},
    {fxRate:200,marginPercent:40,forceAutomatic:true});
  assert.equal(product.options[0].packs[0][1],840);
  assert.equal(product.wamda.priceMode,'auto');
  assert.equal(product.wamda.manualPriceSyp,null);
});
test('products missing from the latest API snapshot are marked unavailable without deleting price data',()=>{
  const existing={id:'wamda-15',options:[{packs:[['Price',777]]}],wamda:{provider:'wamda',available:true}};
  const product=markWamdaProductUnavailable(existing,'2026-10-31T12:00:00.000Z');
  assert.equal(product.wamda.available,false);
  assert.equal(product.wamda.missingFromLatestSync,true);
  assert.equal(product.options[0].packs[0][1],777);
});
