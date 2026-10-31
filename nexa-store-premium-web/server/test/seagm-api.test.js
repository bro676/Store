import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeagmSignature, createSeagmClient, seagmBaseUrl,
} from '../src/seagm-api.js';

const DOC_SECRET = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';

test('SEAGM HMAC signature uses the documented sorted totalParams format', () => {
  assert.equal(
    buildSeagmSignature({ timestamp:1645084639, uid:10001 }, DOC_SECRET),
    '6ffc56701e44ce8e31682d68a313d78c6797085d1dfe0c9b53c1a85d8259f0a5',
  );
});

test('SEAGM base URLs are restricted to the documented sandbox and production hosts', () => {
  assert.equal(seagmBaseUrl('sandbox'), 'https://openapi.seagm.io');
  assert.equal(seagmBaseUrl('production'), 'https://openapi.seagm.com');
  assert.throws(() => seagmBaseUrl('http://localhost'), /INVALID_SEAGM_ENVIRONMENT/);
});

test('SEAGM client rejects malformed credentials and arbitrary endpoints', async () => {
  assert.throws(() => createSeagmClient({ uid:'abc', secretKey:DOC_SECRET }), /INVALID_SEAGM_UID/);
  assert.throws(() => createSeagmClient({ uid:'10001', secretKey:'' }), /INVALID_SEAGM_SECRET_KEY/);
  const client = createSeagmClient({ uid:'10001', secretKey:DOC_SECRET, fetchImpl:async()=>{ throw new Error('should not call'); } });
  await assert.rejects(client.get('https://evil.example/v1/me'), /INVALID_SEAGM_ENDPOINT/);
});

test('account test calls signed /v1/me and normalizes balance details', async () => {
  let captured;
  const client = createSeagmClient({
    uid:'10001', secretKey:DOC_SECRET, environment:'sandbox',
    fetchImpl:async (url, options) => {
      captured = { url:new URL(url), options };
      return new Response(JSON.stringify({code:200,msg:'OK',data:{id:10015,username:'merchant',email:'merchant@example.test',currency:'MYR',balance:'99463.82'}}), {status:200,headers:{'content-type':'application/json'}});
    },
  });
  const account = await client.getAccount();
  assert.deepEqual(account, {id:'10015',username:'merchant',email:'merchant@example.test',currency:'MYR',balance:'99463.82'});
  assert.equal(captured.url.origin, 'https://openapi.seagm.io');
  assert.equal(captured.url.pathname, '/v1/me');
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.url.searchParams.get('uid'), '10001');
  assert.equal(captured.url.searchParams.has('timestamp'), true);
  const sentSignature = captured.url.searchParams.get('signature');
  const signedParams = {
    uid:captured.url.searchParams.get('uid'),
    timestamp:captured.url.searchParams.get('timestamp'),
  };
  assert.equal(sentSignature, buildSeagmSignature(signedParams, DOC_SECRET));
});

test('catalog sync enumerates card and direct top-up categories and their products', async () => {
  const calls = [];
  const routes = new Map([
    ['/v1/card-categories', {code:200,data:[{id:1,name:'Gift cards',code:'gift',auto_delivery:true}]}],
    ['/v1/recharge-categories', {code:200,data:[{id:634,name:'Game top ups',code:'topups',auto_delivery:false}]}],
    ['/v1/card-categories/1/card-types', {code:200,data:[{id:49,name:'1000 points',category_id:1,currency:'MYR',unit_price:'10.50',has_stock:true}]}],
    ['/v1/recharge-categories/634/recharge-types', {code:200,data:[{id:2987,name:'Player credit',category_id:634,currency:'MYR',unit_price:'60.28',min_amount:1,max_amount:10,fields:[{name:'player_id',type:'input',label:'Player ID',placeholder:'Enter ID'}]}]}],
  ]);
  const client = createSeagmClient({
    uid:'10001',secretKey:DOC_SECRET,environment:'production',
    fetchImpl:async url=>{
      const parsed = new URL(url);
      calls.push(parsed.pathname);
      const payload = routes.get(parsed.pathname);
      assert.ok(payload, `Unexpected endpoint ${parsed.pathname}`);
      return new Response(JSON.stringify(payload),{status:200});
    },
  });
  const result = await client.getCatalog();
  assert.deepEqual(result.stats,{categories:2,cardCategories:1,rechargeCategories:1,products:2});
  assert.deepEqual(calls,[
    '/v1/card-categories','/v1/recharge-categories',
    '/v1/card-categories/1/card-types','/v1/recharge-categories/634/recharge-types',
  ]);
  assert.equal(result.categories[0].products[0].id,49);
  assert.equal(result.categories[0].products[0].kind,'card');
  assert.equal(result.categories[1].products[0].kind,'recharge');
  assert.equal(result.categories[1].products[0].fields[0].name,'player_id');
  assert.equal(result.categories[1].products[0].maxAmount,10);
});

test('normalizes current camelCase product fields and provider submitField names', async () => {
  const client = createSeagmClient({
    uid:'10001',secretKey:DOC_SECRET,
    fetchImpl:async url=>{
      const path=new URL(url).pathname;
      const payload=path==='/v1/card-categories'
        ? {code:200,data:[{id:11,name:'Digital Cards',code:'cards'}]}
        : path==='/v1/recharge-categories'
          ? {code:200,data:[{id:12,name:'Direct Recharge',code:'recharge'}]}
          : path==='/v1/card-categories/11/card-types'
            ? {code:200,data:[{id:13,name:'Card',categoryId:11,unitPrice:'3.50',parValue:'5',parValueCurrency:'USD',maxAmount:4,hasStock:true}]}
            : {code:200,data:[{id:14,name:'Topup',categoryId:12,unitPrice:'2.75',minAmount:1,maxAmount:8,fields:[{name:'player_id',submitField:'charge_account',type:'input',label:'Player ID',tips:'Enter your ID'}]}]};
      return new Response(JSON.stringify(payload),{status:200});
    },
  });
  const result=await client.getCatalog();
  const card=result.categories[0].products[0];
  const recharge=result.categories[1].products[0];
  assert.equal(card.parValue,5);
  assert.equal(card.parValueCurrency,'USD');
  assert.equal(card.maxAmount,4);
  assert.equal(recharge.minAmount,1);
  assert.equal(recharge.maxAmount,8);
  assert.equal(recharge.fields[0].submitField,'charge_account');
  assert.equal(recharge.fields[0].tips,'Enter your ID');
});

test('SEAGM stops on provider rate limits and exposes retry-after', async () => {
  const client=createSeagmClient({
    uid:'10001',secretKey:DOC_SECRET,
    fetchImpl:async()=>new Response('rate limited',{status:429,headers:{'retry-after':'30'}}),
  });
  await assert.rejects(client.getAccount(),error=>{
    assert.equal(error.code,'SEAGM_RATE_LIMITED');
    assert.equal(error.retryAfter,30);
    return true;
  });
});

test('SEAGM errors are surfaced without accepting non-200 provider codes', async () => {
  const client = createSeagmClient({
    uid:'10001',secretKey:DOC_SECRET,
    fetchImpl:async()=>new Response(JSON.stringify({
      code:400,msg:'Bad Request',error_info:{info_code:20038,info_message:'Signature is invalid.'},
    }),{status:200}),
  });
  await assert.rejects(client.getAccount(), error => error.code === 20038 && /Signature is invalid/.test(error.message));
});

test('SEAGM rejects invalid response shapes and malformed JSON', async () => {
  const invalidShape = createSeagmClient({uid:'10001',secretKey:DOC_SECRET,fetchImpl:async()=>new Response('[]',{status:200})});
  await assert.rejects(invalidShape.getAccount(), /SEAGM_INVALID_RESPONSE/);
  const invalidJson = createSeagmClient({uid:'10001',secretKey:DOC_SECRET,fetchImpl:async()=>new Response('not json',{status:200})});
  await assert.rejects(invalidJson.getAccount(), /SEAGM_INVALID_JSON_RESPONSE/);
});

test('SEAGM HTTP errors and timeouts are reported safely', async () => {
  const badHttp = createSeagmClient({uid:'10001',secretKey:DOC_SECRET,fetchImpl:async()=>new Response('',{status:503})});
  await assert.rejects(badHttp.getAccount(), /SEAGM HTTP 503/);
  const timeout = createSeagmClient({
    uid:'10001',secretKey:DOC_SECRET,timeoutMs:1,
    fetchImpl:(_url,{signal})=>new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));
    }),
  });
  await assert.rejects(timeout.getAccount(), /SEAGM_REQUEST_TIMEOUT/);
});
