import test from 'node:test';
import assert from 'node:assert/strict';
import { createWamdaClient } from '../src/wamda-api.js';

const token='test-token';
function response(payload,status=200){
  return {ok:status>=200&&status<300,status,headers:{get:()=>null},text:async()=>JSON.stringify(payload)};
}
test('uses api-token header and reads profile',async()=>{
  let seen;
  const client=createWamdaClient({apiToken:token,fetchImpl:async(url,options)=>{seen={url:String(url),options};return response({status:'OK',data:{balance:'25.50',username:'tester',email:'a@example.com',currency:'USD'}})}});
  const profile=await client.getProfile();
  assert.equal(seen.options.headers['api-token'],token);
  assert.equal(new URL(seen.url).pathname,'/profile');
  assert.equal(profile.balance,25.5);
});
test('loads all product pages and normalizes Wamda fields',async()=>{
  const seen=[];
  const client=createWamdaClient({apiToken:token,fetchImpl:async(url)=>{const u=new URL(url);seen.push(Number(u.searchParams.get('page')));return response({status:'OK',data:u.searchParams.get('page')==='1'?[{id:44,name:'Test',price:2,price_per_quantity:10,unit_price:.2,min:1,max:20,category_id:3,category:'Games',available:true,fields:[{key:'playerId',label:'Player ID',type:'text',required:true}]}]:[],pagination:{page:Number(u.searchParams.get('page')),has_more:u.searchParams.get('page')==='1'}})}});
  const result=await client.getProducts({limit:1});
  assert.deepEqual(seen,[1,2]);
  assert.equal(result.products[0].unitPrice,.2);
  assert.equal(result.products[0].fields[0].key,'playerId');
});
test('creates order with fixed UUID and api-token header',async()=>{
  let sent;
  const uuid='ecbdd545-e616-4aee-8770-7eefa977bcd0';
  const client=createWamdaClient({apiToken:token,fetchImpl:async(url,options)=>{sent={url:String(url),options};return response({status:'OK',data:{order_id:'1',order_code:'API_1',order_uuid:uuid,status:'pending',price:1,balance_after:4,delivered_data:'waiting'}})}});
  const order=await client.createOrder(7,{quantity:2,fields:{playerId:'abc'},orderUuid:uuid});
  assert.equal(new URL(sent.url).pathname,'/newOrder/7/params');
  assert.equal(sent.options.headers['api-token'],token);
  assert.deepEqual(JSON.parse(sent.options.body),{playerId:'abc',quantity:2,order_uuid:uuid});
  assert.equal(order.status,'pending');
});
test('checks a UUID without treating not-found as a fatal error',async()=>{
  const client=createWamdaClient({apiToken:token,fetchImpl:async(url)=>{assert.equal(new URL(url).searchParams.get('uuid'),'1');return response({status:'OK',data:{'some-uuid':{error:'Order not found.'}}})}});
  assert.equal(await client.checkOrder('ecbdd545-e616-4aee-8770-7eefa977bcd0',{uuid:true}),null);
});
test('rejects app-level errors even with HTTP 200',async()=>{
  const client=createWamdaClient({apiToken:token,fetchImpl:async()=>response({status:'ERROR',code:100,message:'Insufficient balance.',request_id:'abc'})});
  await assert.rejects(client.getProfile(),error=>error.code===100&&error.requestId==='abc');
});
