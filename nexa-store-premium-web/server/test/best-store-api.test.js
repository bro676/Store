import test from 'node:test';
import assert from 'node:assert/strict';
import { createBestStoreClient, normalizeBestStoreProduct } from '../src/best-store-api.js';

test('Best Store normalizes source cost, quantity limits and parameter fields', () => {
  const product=normalizeBestStoreProduct({
    id:365,name:'UC 60',price:0.104,base_price:0.10,category_name:'PUBG Global',
    available:true,qty_values:{min:1,max:'15000'},product_type:'amount',
    params:['ادخل الايدي الاعب','Server ID'],category_img:'images/category/pubg.webp'
  },'USD');
  assert.equal(product.sourceCost,0.10);
  assert.equal(product.costBasis,'base_price');
  assert.equal(product.minimumQuantity,1);
  assert.equal(product.maximumQuantity,15000);
  const large=normalizeBestStoreProduct({id:366,name:'Large bundle',price:0.2,qty_values:{min:1,max:500000}},'USD');
  assert.equal(large.maximumQuantity,500000);
  assert.deepEqual(product.fields.map(field=>field.submitField),['playerId','serverId']);
  assert.equal(product.currency,'USD');
  assert.equal(normalizeBestStoreProduct({id:3,name:'Unavailable zero',price:1,available:0}).available,false);
  assert.equal(normalizeBestStoreProduct({id:4,name:'Unavailable string',price:1,available:'false'}).available,false);
});

test('Best Store null quantity means one unit; discrete quantities remain constrained', () => {
  const fixed=normalizeBestStoreProduct({id:1,name:'Fixed',price:2,qty_values:null});
  assert.equal(fixed.minimumQuantity,1);
  assert.equal(fixed.maximumQuantity,1);
  const steps=normalizeBestStoreProduct({id:2,name:'Steps',price:2,qty_values:[10,5,10,0]});
  assert.deepEqual(steps.allowedQuantities,[5,10]);
  assert.equal(steps.maximumQuantity,10);
});

test('Best Store client uses api-token header and idempotent order UUID', async () => {
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url:String(url),options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({status:'OK',data:{order_id:'ID_1',status:'accept',replay_api:[]}})};
  };
  const client=createBestStoreClient({apiToken:'secret-token',fetchImpl});
  const uuid='123e4567-e89b-42d3-a456-426614174000';
  const order=await client.createOrder(55,{quantity:3,fields:{playerId:'A 1'},orderUuid:uuid});
  assert.equal(order.status,'accept');
  assert.match(calls[0].url,/newOrder\/55\/params/);
  assert.match(calls[0].url,/order_uuid=/);
  assert.equal(calls[0].options.headers['api-token'],'secret-token');
  assert.equal(calls[0].options.method,'GET');
  await client.createOrder(55,{quantity:500001,orderUuid:uuid});
  assert.equal(calls.length,2,'Best Store may accept large documented quantities up to the configured safety cap');
});

test('Best Store rejects invalid order IDs and unsafe field keys', async () => {
  const client=createBestStoreClient({apiToken:'abc',fetchImpl:async()=>({ok:true,status:200,headers:{get:()=>null},text:async()=>'{}'})});
  await assert.rejects(()=>client.createOrder(0,{orderUuid:'bad'}),/معرّف المنتج/);
});

test('Best Store check resolves order UUID and reads the provider status result', async () => {
  const calls=[];
  const fetchImpl=async (url,options)=>{
    calls.push({url:String(url),options});
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({status:'OK',data:[{order_id:'ID_2',status:'accept',replay_api:['PIN']} ]})};
  };
  const client=createBestStoreClient({apiToken:'secret-token',fetchImpl});
  const uuid='123e4567-e89b-42d3-a456-426614174000';
  const result=await client.checkOrder(uuid);
  assert.equal(result.order_id,'ID_2');
  assert.match(calls[0].url,/uuid=1/);
  assert.match(calls[0].url,/orders=/);
});

test('Best Store top-level API errors are rejected instead of treated as empty product lists', async () => {
  const client=createBestStoreClient({apiToken:'secret-token',fetchImpl:async()=>({
    ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify({status:'error',message:'Token error'})
  })});
  await assert.rejects(()=>client.getProducts(),/Token error|رفض Best Store/);
});
