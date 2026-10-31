import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

function compileInlineScripts(html, label) {
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match=>!/\bsrc\s*=/.test(match[1])&&!/application\/ld\+json|application\/json/i.test(match[1]));
  assert.ok(scripts.length>0, label+' should contain inline application JavaScript');
  for(let i=0;i<scripts.length;i++){
    assert.doesNotThrow(()=>new Function(scripts[i][2]),label+' inline script '+(i+1)+' must parse');
  }
  return scripts.length;
}

test('storefront and admin inline application scripts parse cleanly',()=>{
  assert.ok(compileInlineScripts(read('index.html'),'storefront')>=1);
  assert.ok(compileInlineScripts(read('admin.html'),'admin dashboard')>=1);
});

test('storefront checkout has one wallet-aware order handler and real customer payment methods',()=>{
  const html=read('index.html');
  assert.equal((html.match(/async function doOrder\(e\)\{/g)||[]).length,1);
  assert.match(html,/paymentMethod,customerName/);
  assert.match(html,/\/api\/wallet\/topups\/current/);
  assert.match(html,/\/api\/customer\/orders/);
  assert.match(html,/value="wallet"/);
  assert.match(html,/value="shamcash"/);
});

test('store product detail controls emit quoted HTML attributes',()=>{
  const html=read('index.html');
  assert.match(html,/data-browse-item="\'\+esc\(product\.id\)\+'"'/);
  assert.match(html,/data-open-item="\'\+esc\(i\.id\)\+'"'/);
});

test('storefront and dashboard theme preferences are independent',()=>{
  const store=read('index.html'),admin=read('admin.html');
  assert.match(store,/NEXA_THEME_KEY='nexa-store-color-mode'/);
  assert.match(admin,/ADMIN_THEME_KEY='nexa-admin-color-mode'/);
  assert.doesNotMatch(store,/addEventListener\(['"]storage['"]/);
  assert.doesNotMatch(admin,/addEventListener\(['"]storage['"]/);
});

test('dark mode uses charcoal and gold while light mode uses ivory and readable dark text',()=>{
  const storeCss=read('assets/brand/nexa-luxury.css'),admin=read('admin.html');
  assert.match(storeCss,/:root\[data-theme="dark"\][\s\S]*?--lux-bg:#0f0f0f/);
  assert.match(storeCss,/:root\[data-theme="light"\][\s\S]*?--lux-bg:#f3efe3/);
  assert.match(admin,/:root\[data-theme="dark"\][\s\S]*?--paper:#101010/);
  assert.match(admin,/:root\[data-theme="light"\][\s\S]*?--paper:#f3efe3/);
});

test('server source passes Node syntax validation',()=>{
  const serverPath=fileURLToPath(new URL('../src/server.js',import.meta.url));
  const result=spawnSync(process.execPath,['--check',serverPath],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout||'server.js syntax check failed');
});
