import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const catalogScript = new URL('../../assets/brand/nexa-catalog.js', import.meta.url);
const storefrontScript = new URL('../../index.html', import.meta.url);

async function loadNexaCatalog() {
  const source = await readFile(catalogScript, 'utf8');
  const sandbox = { window:{}, URL };
  runInNewContext(source, sandbox);
  return sandbox.window.NexaCatalog;
}

function productCard(productId, categoryId) {
  return {
    nodeType:1,
    matches(selector) { return selector === '[data-open-item]'; },
    getAttribute(name) {
      if (name === 'data-open-item') return productId;
      if (name === 'data-open-category') return categoryId;
      return null;
    },
    closest(selector) { return this.matches(selector) ? this : null; },
  };
}

test('click inside a nested product-card element resolves the enclosing product card',async()=>{
  const api=await loadNexaCatalog();
  const card=productCard('rooh-chat','apps');
  const nestedImage={nodeType:1,matches:()=>false,parentElement:card,closest:selector=>card.closest(selector)};
  const event={target:nestedImage,composedPath:()=>[nestedImage,card]};
  assert.equal(api.findProductControl(event),card);
});

test('product-card activation falls back to target.closest when composedPath is unavailable',async()=>{
  const api=await loadNexaCatalog();
  const card=productCard('beststore-901','charging-apps');
  const nestedText={nodeType:1,matches:()=>false,parentElement:card,closest:selector=>card.closest(selector)};
  assert.equal(api.findProductControl({target:nestedText}),card);
});

test('a card click resolves the exact product in its supplied category and opens valid options',async()=>{
  const api=await loadNexaCatalog();
  const categories=[{
    id:'apps',name:'Charging applications',desc:'Digital applications',items:[{
      id:'rooh-chat',name:'ROOH CHAT',desc:'Chat credits',
      options:[{id:'default',name:'Default',desc:'Main package',packs:[['100 Credits',0.005]]}],
    }],
  }];
  const card=productCard('rooh-chat','apps');
  const event={target:card,composedPath:()=>[card]};
  const activated=api.findProductControl(event);
  assert.equal(activated,card);
  const resolved=api.resolveProductNavigation(
    categories,
    activated.getAttribute('data-open-item'),
    activated.getAttribute('data-open-category')
  );
  assert.ok(resolved);
  assert.equal(resolved.departmentId,'other');
  assert.equal(resolved.categoryId,'apps');
  assert.equal(resolved.itemId,'rooh-chat');
  assert.equal(resolved.optionId,'default');
  assert.equal(resolved.optionCount,1);
  assert.equal(resolved.packCount,1);
});

test('product details still open when a product has multiple valid options',async()=>{
  const api=await loadNexaCatalog();
  const categories=[{
    id:'games',name:'PUBG Mobile',items:[{
      id:'pubg-prime',name:'PUBG Prime',options:[
        {id:'monthly',name:'Monthly',packs:[['1 Month',5]]},
        {id:'yearly',name:'Yearly',packs:[['12 Months',50]]},
      ],
    }],
  }];
  const resolved=api.resolveProductNavigation(categories,'pubg-prime','games');
  assert.ok(resolved);
  assert.equal(resolved.optionId,null);
  assert.equal(resolved.optionCount,2);
  assert.equal(resolved.packCount,2);
});

test('a missing product or stale category cannot open an unrelated product',async()=>{
  const api=await loadNexaCatalog();
  const categories=[
    {id:'first',name:'First',items:[{id:'same-id',name:'First product',options:[{id:'a',packs:[['1',1]]}]}]},
    {id:'second',name:'Second',items:[{id:'same-id',name:'Second product',options:[{id:'b',packs:[['1',2]]}]}]},
  ];
  assert.equal(api.resolveProductNavigation(categories,'missing','first'),null);
  assert.equal(api.resolveProductNavigation(categories,'same-id','stale'),null);
  assert.equal(api.resolveProductNavigation(categories,'same-id'),null);
  assert.equal(api.resolveProductNavigation(categories,'same-id','second').item.name,'Second product');
  const unique=[{id:'only',name:'Only category',items:[{id:'unique-item',name:'Unique',options:[]}]}];
  assert.equal(api.resolveProductNavigation(unique,'unique-item','deleted-category').item.name,'Unique');
});

test('the live storefront delegates all product-card clicks at document level and prioritizes favorites',async()=>{
  const source=await readFile(storefrontScript,'utf8');
  const favoriteHandler=source.indexOf("const favoriteControl=eventElement(e,'[data-favorite]')");
  const productHandler=source.indexOf('const productControl=NexaCatalog.findProductControl(e)');
  assert.ok(favoriteHandler>=0,'favorite click handler must be present');
  assert.ok(productHandler>favoriteHandler,'favorite action must run before product-card navigation');
  assert.ok(source.includes("openItem(productControl.getAttribute('data-open-item'),productControl.getAttribute('data-open-category')||null)"));
  assert.ok(source.includes("document.addEventListener('click',e=>"));
  assert.ok(!source.includes('addEventListener(\'click\',handleStoreProductActivation'),
    'product navigation should not depend on per-root click listeners');
});
