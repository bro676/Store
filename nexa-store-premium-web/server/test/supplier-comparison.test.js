import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSupplierCandidates, buildSupplierComparisonPlan, supplierProductMatchKey, supplierCategoryMatchKey, supplierCostInSyp, isSupplierAvailable, buildSupplierSourceMatchKeyIndex, existingSupplierMatchKey, applyFirstPriceableSupplierCandidate, buildSupplierCatalogIndex, updateSupplierCatalogIndex } from '../src/supplier-comparison.js';

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
  assert.equal(supplierProductMatchKey({name:'UC 60'},'UC 60'),supplierProductMatchKey({name:'PUBG UC 60'},'PUBG Mobile'));
  assert.notEqual(supplierProductMatchKey({name:'UC Browser Premium'},'Applications'),supplierProductMatchKey({name:'PUBG UC 60'},'PUBG Mobile'));
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


test('supplier catalog index finds existing legacy products and storefront categories in one pass',()=>{
  const catalog=[
    {id:'games',name:'PUBG',items:[
      {id:'legacy-wamda',name:'PUBG UC 60',wamda:{provider:'wamda',productId:101}},
    ]},
    {id:'cards',name:'Gift Cards',items:[
      {id:'legacy-beststore',name:'Steam Wallet 10 USD',bestStore:{provider:'beststore',productId:202}},
    ]},
  ];
  const sourceIndex=buildSupplierSourceMatchKeyIndex({
    wamdaCatalogCache:[{name:'PUBG',products:[{id:101,name:'PUBG UC 60'}]}],
    bestStoreCatalogCache:[{name:'Steam',products:[{id:202,name:'Steam Wallet 10 USD'}]}],
  });
  const index=buildSupplierCatalogIndex(catalog,sourceIndex);
  assert.equal(index.byProviderProduct.get('wamda:101').item.id,'legacy-wamda');
  assert.equal(index.byProviderProduct.get('beststore:202').item.id,'legacy-beststore');
  assert.equal(index.categoryByName.get('pubg').id,'games');
  assert.equal(index.categoryByFamily.get(supplierCategoryMatchKey('PUBG'))?.id,'games');
});

test('supplier catalog index updates replaced items and registers inserted supplier products',()=>{
  const category={id:'games',name:'PUBG',items:[{id:'old',name:'PUBG UC 60',wamda:{provider:'wamda',productId:101}}]};
  const sourceIndex=buildSupplierSourceMatchKeyIndex({
    wamdaCatalogCache:[{name:'PUBG',products:[{id:101,name:'PUBG UC 60'}]}],
    bestStoreCatalogCache:[{name:'PUBG Mobile',products:[{id:202,name:'PUBG UC 60'}]}],
  });
  const index=buildSupplierCatalogIndex([category],sourceIndex);
  const previous=index.byProviderProduct.get('wamda:101');
  const replacement={id:'old',name:'PUBG UC 60',supplierMatchKey:'pubg::60',bestStore:{provider:'beststore',productId:202}};
  category.items[0]=replacement;
  updateSupplierCatalogIndex(index,previous,replacement,category,0,'pubg::60');
  assert.equal(index.byMatchKey.get('pubg::60').item,replacement);
  assert.equal(index.byProviderProduct.has('wamda:101'),false);
  assert.equal(index.byProviderProduct.get('beststore:202').item,replacement);
});


function supplierCandidate(provider,productId,name,categoryName,sourceCost,currency='SYP',extra={}) {
  const product={id:productId,name,available:true,...(extra.product||{})};
  return {
    provider,productId,product,categoryName,sourceCost,currency,available:true,
    ...Object.fromEntries(Object.entries(extra).filter(([key])=>key!=='product')),
  };
}

test('identical generic products match across different supplier category names',()=>{
  const wamda=supplierCandidate('wamda',501,'ROOH CHAT','💻 قسم التطبيقات',0.0000844605,'USD');
  const beststore=supplierCandidate('beststore',901,'rooh chat','charging applications',0.00008383648135824588,'SYP');
  assert.equal(supplierProductMatchKey(wamda.product,wamda.categoryName),supplierProductMatchKey(beststore.product,beststore.categoryName));
  const plan=buildSupplierComparisonPlan([wamda,beststore],145);
  assert.equal(plan.stats.sharedProductKeys,1);
  assert.equal(plan.stats.comparedGroups,1);
  assert.equal(plan.groups.length,1);
  assert.equal(plan.groups[0].winner.provider,'beststore');
});

test('production-style Arabic PUBG prime item matches despite different categories and diacritics',()=>{
  const wamda=supplierCandidate('wamda',601,'برايم 6 أشهر','باقات PUBG Mobile',5,'SYP');
  const beststore=supplierCandidate('beststore',961,'برايم 6 اشهر','PUBG Global Items',4,'SYP');
  assert.equal(supplierProductMatchKey(wamda.product,wamda.categoryName),supplierProductMatchKey(beststore.product,beststore.categoryName));
  const plan=buildSupplierComparisonPlan([wamda,beststore],145);
  assert.equal(plan.stats.comparedGroups,1);
  assert.equal(plan.groups[0].winner.provider,'beststore');
});

test('currency denomination remains part of product identity',()=>{
  const euro=supplierProductMatchKey({name:'ROBLOX 50€'},'Roblox');
  const dollar=supplierProductMatchKey({name:'ROBLOX 50$'},'Roblox');
  assert.notEqual(euro,dollar);
  assert.equal(euro,supplierProductMatchKey({name:'Roblox 50 EUR'},'Roblox Cards'));
  assert.equal(dollar,supplierProductMatchKey({name:'ROBLOX 50 USD'},'Roblox Gift Cards'));
});

test('social reaction emoji variants remain different SKUs',()=>{
  const heart=supplierProductMatchKey({name:'Telegram Reaction [❤️]'},'Telegram Reactions');
  const thumbs=supplierProductMatchKey({name:'Telegram Reaction [👍]'},'Telegram Reactions');
  const fire=supplierProductMatchKey({name:'Telegram Reaction [🔥]'},'Telegram Reactions');
  assert.notEqual(heart,thumbs);
  assert.notEqual(heart,fire);
  assert.notEqual(thumbs,fire);
});

test('regional and product-order qualifiers are preserved',()=>{
  assert.notEqual(supplierProductMatchKey({name:'Netflix 1 Month US'},'Netflix'),supplierProductMatchKey({name:'Netflix 1 Month Turkey'},'Netflix'));
  assert.notEqual(supplierProductMatchKey({name:'UP FUN'},'Apps'),supplierProductMatchKey({name:'FUN UP'},'Apps'));
  assert.notEqual(supplierProductMatchKey({name:'PUBG UC 60'},'PUBG'),supplierProductMatchKey({name:'PUBG UC 325'},'PUBG'));
});

test('known platform aliases match across Arabic and English categories',()=>{
  const pairs=[
    [{name:'YouTube Premium 1 Month'},'YouTube subscriptions',{name:'يوتيوب بريميوم 1 شهر'},'خدمات يوتيوب'],
    [{name:'WhatsApp Followers 100'},'WhatsApp services',{name:'متابعين واتساب 100'},'خدمات واتساب'],
    [{name:'Discord Nitro 1 Month'},'Discord',{name:'Discord Nitro 1 Month'},'Nitro subscriptions'],
    [{name:'Facebook Likes 100'},'Facebook',{name:'Facebook Likes 100'},'Social media'],
  ];
  for(const [a,ca,b,cb] of pairs){
    assert.equal(supplierProductMatchKey(a,ca),supplierProductMatchKey(b,cb),`${a.name} vs ${b.name}`);
  }
});

test('one-provider-only products are included as automatic single-source publish groups',()=>{
  const rows=[
    supplierCandidate('wamda',1,'MANGO','Applications',1,'SYP'),
    supplierCandidate('beststore',2,'ONLY BEST STORE SKU','Digital Cards',0.5,'SYP'),
  ];
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.groups.length,2);
  assert.equal(plan.stats.comparedGroups,0);
  assert.equal(plan.stats.singleSourceGroups,2);
  assert.equal(plan.stats.uniqueOnlyProductKeys,2);
  assert.ok(plan.groups.every(group=>group.candidates.length===1&&!group.compared));
});

test('a shared but unavailable supplier falls back to the only available supplier',()=>{
  const rows=[
    supplierCandidate('wamda',10,'ROOH CHAT','Applications',0.00001,'SYP',{available:false}),
    supplierCandidate('beststore',20,'ROOH CHAT','Charging apps',0.00002,'SYP'),
  ];
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.stats.sharedProductKeys,1);
  assert.equal(plan.stats.comparedGroups,0);
  assert.equal(plan.groups.length,1);
  assert.equal(plan.groups[0].winner.provider,'beststore');
  assert.equal(plan.stats.sources.wamda.unavailable,1);
});

test('string false availability values are treated as unavailable',()=>{
  for(const value of [false,0,'0','false','FALSE','no','off','inactive','disabled'])assert.equal(isSupplierAvailable(value),false);
  for(const value of [true,1,'true','yes',undefined,null])assert.equal(isSupplierAvailable(value),true);
});

test('duplicate rows for the same provider product ID are deduplicated',()=>{
  const rows=[
    supplierCandidate('wamda',11,'DANA CHAT','Applications',2,'SYP',{available:false}),
    supplierCandidate('wamda',11,'DANA CHAT','Applications',2,'SYP',{available:true}),
    supplierCandidate('beststore',21,'DANA CHAT','Charging applications',1,'SYP'),
  ];
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.stats.sourceRowsFetched,3);
  assert.equal(plan.stats.duplicateSourceRowsRemoved,1);
  assert.equal(plan.stats.uniqueSourceProducts,2);
  assert.equal(plan.stats.comparedGroups,1);
});

test('distinct duplicate product IDs in one supplier are ambiguous and never collapsed together',()=>{
  const rows=[
    supplierCandidate('wamda',101,'DANA CHAT','Applications',0.00001,'SYP'),
    supplierCandidate('wamda',102,'DANA CHAT','Applications',0.00002,'SYP'),
    supplierCandidate('beststore',201,'DANA CHAT','Charging applications',0.000005,'SYP'),
  ];
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.stats.sharedProductKeys,1);
  assert.equal(plan.stats.ambiguousProductKeys,1);
  assert.equal(plan.stats.comparedGroups,0);
  assert.equal(plan.groups.length,3);
  assert.ok(plan.groups.every(group=>group.ambiguous&&group.candidates.length===1));
  assert.equal(new Set(plan.groups.map(group=>group.publishMatchKey)).size,3);
});

test('invalid prices are counted and do not suppress valid unique products',()=>{
  const rows=[
    supplierCandidate('wamda',1,'INVALID PRICE ITEM','Applications',0,'EUR'),
    supplierCandidate('beststore',2,'VALID BESTSTORE ONLY','Charging applications',3,'SYP'),
  ];
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.stats.sources.wamda.invalidPrice,1);
  assert.equal(plan.stats.unmatchableProducts,0);
  assert.equal(plan.groups.length,1);
  assert.equal(plan.groups[0].winner.provider,'beststore');
});

test('Best Store calculated-price failures are skipped but unrelated errors still propagate',()=>{
  const best={provider:'beststore',productId:88,sourceProductKey:'beststore:88'};
  const result=applyFirstPriceableSupplierCandidate({winner:best},()=>{throw Object.assign(new Error('سعر بيع Best Store المحسوب غير صالح.'),{code:'BEST_STORE_INVALID_SELL_PRICE'});});
  assert.equal(result.candidate,null);
  assert.equal(result.unpriceableCandidates[0].sourceProductKey,'beststore:88');
  assert.throws(()=>applyFirstPriceableSupplierCandidate({winner:best},()=>{throw new Error('DATABASE_WRITE_FAILED');}),/DATABASE_WRITE_FAILED/);
});

test('production-like inventory publishes all matched and single-source products without cross-merging currencies',()=>{
  const rows=[
    supplierCandidate('wamda',501,'ROOH CHAT','💻 قسم التطبيقات',0.0000844605,'USD'),
    supplierCandidate('beststore',901,'ROOH CHAT','charging applications',0.00008383648135824588,'SYP'),
    supplierCandidate('wamda',502,'PUBG Prime 6 Months','PUBG Mobile',5,'SYP'),
    supplierCandidate('beststore',902,'PUBG Prime 6 Months','PUBG Global',4,'SYP'),
    supplierCandidate('wamda',503,'ROBLOX 50€','Roblox Cards',0.2,'SYP'),
    supplierCandidate('beststore',903,'ROBLOX 50$','Digital Cards',0.1,'SYP'),
    supplierCandidate('wamda',504,'MANGO','Applications',1,'SYP'),
    supplierCandidate('beststore',904,'BEST STORE UNIQUE','Digital Cards',1,'SYP'),
  ];
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.stats.sourceRowsFetched,8);
  assert.equal(plan.stats.sharedProductKeys,2);
  assert.equal(plan.stats.comparedGroups,2);
  assert.equal(plan.stats.uniqueOnlyProductKeys,4);
  assert.equal(plan.stats.singleSourceGroups,4);
  assert.equal(plan.groups.length,6);
  assert.equal(plan.groups.find(group=>group.matchKey===supplierProductMatchKey({name:'ROOH CHAT'},'Applications')).winner.provider,'beststore');
  assert.equal(plan.groups.find(group=>group.matchKey===supplierProductMatchKey({name:'ROBLOX 50€'},'Roblox')).candidates.length,1);
});

test('5,000-row supplier inventory plan covers every source SKU with linear grouping',()=>{
  const rows=[];
  for(let i=0;i<3500;i++){
    const id=String(i).padStart(5,'0');
    rows.push(supplierCandidate('wamda',100000+i,`Service SKU ${id}`,'WAMDA Applications',0.01+i/100000,'USD'));
  }
  for(let i=0;i<1500;i++){
    const id=String(i).padStart(5,'0');
    rows.push(supplierCandidate('beststore',200000+i,`Service SKU ${id}`,'Best Store Digital Services',0.5+i/100000,'SYP'));
  }
  const plan=buildSupplierComparisonPlan(rows,145);
  assert.equal(plan.stats.sourceRowsFetched,5000);
  assert.equal(plan.stats.uniqueSourceProducts,5000);
  assert.equal(plan.groups.length,3500);
  assert.equal(plan.stats.sharedProductKeys,1500);
  assert.equal(plan.stats.comparedGroups,1500);
  assert.equal(plan.stats.singleSourceGroups,2000);
  assert.equal(plan.stats.uniqueOnlyProductKeys,2000);
  const shared=plan.groups.find(group=>group.matchKey===supplierProductMatchKey({name:'Service SKU 00000'},''));
  assert.equal(shared.candidates.length,2);
  assert.equal(shared.winner.provider,'beststore');
});

test('published legacy supplier keys can be found by the updated identity key',()=>{
  const legacy={id:'published-old-key',name:'ROOH CHAT',supplierMatchKey:'old-vendor-category::rooh chat',wamda:{provider:'wamda',productId:501}};
  const sourceIndex=buildSupplierSourceMatchKeyIndex({
    wamdaCatalogCache:[{name:'💻 قسم التطبيقات',products:[{id:501,name:'ROOH CHAT'}]}],
    bestStoreCatalogCache:[{name:'charging applications',products:[{id:901,name:'ROOH CHAT'}]}],
  });
  const index=buildSupplierCatalogIndex([{id:'apps',name:'Applications',items:[legacy]}],sourceIndex);
  const currentKey=sourceIndex.get('wamda:501');
  assert.equal(index.byMatchKey.get(currentKey).item.id,'published-old-key');
  assert.equal(index.byProviderProduct.get('wamda:501').item.id,'published-old-key');
});


test('Arabic duration variants and Persian digits normalize without losing denominations',()=>{
  const a=supplierProductMatchKey({name:'PUBG Prime 6 Months'},'PUBG Mobile');
  const b=supplierProductMatchKey({name:'برايم ٦ أشهر'},'PUBG Global');
  assert.equal(a,b);
  assert.notEqual(
    supplierProductMatchKey({name:'Roblox 50 EUR'},'Roblox'),
    supplierProductMatchKey({name:'Roblox 50 USD'},'Roblox')
  );
});

test('emoji skin tone variants remain distinct supplier products',()=>{
  const light=supplierProductMatchKey({name:'Telegram Reaction [👍🏻]'},'Telegram Reactions');
  const dark=supplierProductMatchKey({name:'Telegram Reaction [👍🏿]'},'Telegram Reactions');
  assert.notEqual(light,dark);
});
