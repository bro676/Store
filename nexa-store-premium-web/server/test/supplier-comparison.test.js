import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSupplierCandidates, supplierProductMatchKey, supplierCategoryMatchKey, supplierCostInSyp } from '../src/supplier-comparison.js';

test('same named product in the same game family compares across suppliers',()=>{
  const a={name:'PUBG UC 60'},b={name:'PUBG UC 60'};
  const keyA=supplierProductMatchKey(a,'PUBG Mobile');
  const keyB=supplierProductMatchKey(b,'PUBG Global');
  assert.equal(keyA,keyB);
  assert.equal(supplierProductMatchKey({name:'PUBG UC 60'},'PUBG Mobile'),supplierProductMatchKey({name:'يوسي 60'},'PUBG Global'));
  assert.equal(supplierProductMatchKey({name:'PUBG UC 60'},'PUBG Mobile'),supplierProductMatchKey({name:'UC 60'},'PUBG Global'));
  assert.notEqual(supplierProductMatchKey({name:'PUBG Mobile 60 UC'},'PUBG'),supplierProductMatchKey({name:'ببجي 60'},'PUBG Global'));
  assert.notEqual(supplierProductMatchKey({name:'PUBG Mobile 60 UC'},'PUBG'),supplierProductMatchKey({name:'60 UC'},'PUBG Global'));
  assert.equal(supplierCategoryMatchKey('PUBG Mobile'),supplierCategoryMatchKey('UC 60'));
  assert.notEqual(supplierCategoryMatchKey('PUBG'),supplierCategoryMatchKey('Free Fire'));
});

test('different denominations and game families are never merged',()=>{
  assert.notEqual(supplierProductMatchKey({name:'PUBG UC 60'},'PUBG'),supplierProductMatchKey({name:'PUBG UC 325'},'PUBG'));
  assert.notEqual(supplierProductMatchKey({name:'PUBG UC 60'},'PUBG'),supplierProductMatchKey({name:'Free Fire 100'},'Free Fire'));
});

test('supplier comparison selects lowest source cost before any margin is applied',()=>{
  const rows=[
    {provider:'wamda',name:'PUBG UC 60',categoryName:'PUBG Mobile',unitPrice:0.12,currency:'USD'},
    {provider:'beststore',name:'PUBG UC 60',categoryName:'PUBG Global',sourceCost:0.10,currency:'USD'},
  ];
  const result=compareSupplierCandidates(rows.map(row=>({...row,matchKey:supplierProductMatchKey(row,row.categoryName)})),145);
  assert.equal(result.length,1);
  assert.equal(result[0].winner.provider,'beststore');
  assert.equal(result[0].winner.costSyp,14.5);
});

test('currencies are converted before comparison',()=>{
  assert.equal(supplierCostInSyp({sourceCost:1,currency:'USD'},145),145);
  assert.equal(supplierCostInSyp({sourceCost:100,currency:'SYP'},145),100);
  assert.equal(supplierCostInSyp({sourceCost:2,currency:'EUR'},145),null);
});

test('unavailable suppliers are excluded, while unmatched available SKUs remain publishable',()=>{
  const result=compareSupplierCandidates([
    {provider:'wamda',name:'PUBG UC 60',categoryName:'PUBG',unitPrice:0.1,currency:'USD',available:false},
    {provider:'beststore',name:'PUBG UC 60',categoryName:'PUBG',sourceCost:0.2,currency:'USD',available:true},
    {provider:'beststore',name:'Free Fire 100',categoryName:'Free Fire',sourceCost:0.3,currency:'USD',available:true},
  ].map(row=>({...row,matchKey:supplierProductMatchKey(row,row.categoryName)})),145);
  assert.equal(result.length,2);
  assert.equal(result.find(row=>row.matchKey.includes('pubg')).winner.provider,'beststore');
});
