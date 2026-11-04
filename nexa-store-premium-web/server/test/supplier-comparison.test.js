import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSupplierCandidates, supplierProductMatchKey, supplierCategoryMatchKey, supplierCostInSyp, buildSupplierSourceMatchKeyIndex, existingSupplierMatchKey, applyFirstPriceableSupplierCandidate } from '../src/supplier-comparison.js';

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


test('supplier source index resolves legacy WAMDA and Best Store products without rescanning caches',()=>{
  const settings={
    wamdaCatalogCache:[{name:'PUBG Mobile',products:[{id:101,name:'PUBG UC 60'}]}],
    bestStoreCatalogCache:[{name:'PUBG Global',products:[{id:202,name:'PUBG UC 60'}]}],
  };
  const index=buildSupplierSourceMatchKeyIndex(settings);
  assert.equal(index.get('wamda:101'),index.get('beststore:202'));
  assert.equal(existingSupplierMatchKey({wamda:{provider:'wamda',productId:101}},index),index.get('wamda:101'));
  assert.equal(existingSupplierMatchKey({bestStore:{provider:'beststore',productId:202}},index),index.get('beststore:202'));
  assert.equal(existingSupplierMatchKey({wamda:{provider:'wamda',productId:999}},index),'');
});

test('explicit published supplierMatchKey takes precedence over the source index',()=>{
  const index=buildSupplierSourceMatchKeyIndex({
    wamdaCatalogCache:[{name:'PUBG Mobile',products:[{id:101,name:'PUBG UC 60'}]}],
  });
  assert.equal(existingSupplierMatchKey({supplierMatchKey:'explicit::key',wamda:{provider:'wamda',productId:101}},index),'explicit::key');
  assert.equal(existingSupplierMatchKey({id:'manual-product'},index),'');
});


test('unpriceable WAMDA winner falls back to the next supplier candidate',()=>{
  const wamda={provider:'wamda',productId:11,costSyp:10};
  const beststore={provider:'beststore',productId:22,costSyp:12};
  const attempts=[];
  const result=applyFirstPriceableSupplierCandidate({winner:wamda,candidates:[wamda,beststore]},candidate=>{
    attempts.push(candidate.provider);
    if(candidate.provider==='wamda')throw new Error('INVALID_WAMDA_CALCULATED_PRICE');
    return {published:candidate.provider};
  });
  assert.deepEqual(attempts,['wamda','beststore']);
  assert.equal(result.candidate.provider,'beststore');
  assert.deepEqual(result.result,{published:'beststore'});
  assert.deepEqual(result.unpriceableCandidates,[{
    provider:'wamda',productId:11,categoryId:'',errorCode:'INVALID_WAMDA_CALCULATED_PRICE'
  }]);
});

test('all unpriceable candidates skip only that product group',()=>{
  const candidates=[
    {provider:'wamda',productId:31},
    {provider:'beststore',productId:32},
  ];
  const result=applyFirstPriceableSupplierCandidate({candidates},()=>{throw new Error('INVALID_WAMDA_CALCULATED_PRICE');});
  assert.equal(result.candidate,null);
  assert.equal(result.result,null);
  assert.deepEqual(result.unpriceableCandidates.map(item=>item.productId),[31,32]);
});

test('supplier candidate application does not swallow unrelated publication failures',()=>{
  assert.throws(
    ()=>applyFirstPriceableSupplierCandidate({winner:{provider:'beststore'}},()=>{throw new Error('DATABASE_WRITE_FAILED');}),
    /DATABASE_WRITE_FAILED/
  );
});
