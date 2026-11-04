import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAdminSession, verifyAdminSession, encryptSecret, decryptSecret,
  isSafeCatalogImage, validateCatalog, mergeCatalog, deleteCatalogFolder, upsertCatalogProduct, getJsonPath, validateCatalogApiUrl, normalizeFxRate,
} from '../src/admin-core.js';

const secret = 'a-strong-admin-key-for-tests-only-2026';
const catalog = [{id:'games',name:'ألعاب',desc:'قسم',image:'assets/categories/games.svg',icon:'🎮',items:[{id:'freefire',name:'Free Fire',desc:'لعبة',image:'assets/products/freefire.svg',options:[{id:'mena',name:'MENA',desc:'منطقة',flag:'🌍',packs:[['100 جوهرة',180]]}]}]}];

test('admin sessions are signed and expire', () => {
  const token = createAdminSession(secret, 1_800_000_000_000, 60);
  assert.equal(verifyAdminSession(token, secret, 1_800_000_000_000), true);
  assert.equal(verifyAdminSession(token, secret + 'x', 1_800_000_000_000), false);
  assert.equal(verifyAdminSession(token, secret, 1_800_061_000_000), false);
});
test('admin secrets are encrypted and authenticated', () => {
  const token = encryptSecret('provider-secret', secret);
  assert.notEqual(token, 'provider-secret');
  assert.equal(decryptSecret(token, secret), 'provider-secret');
  assert.throws(() => decryptSecret(token, secret + 'x'));
});
test('validates nested catalogue and rejects active content images', () => {
  assert.equal(validateCatalog(catalog)[0].items[0].options[0].packs[0][1], 180);
  assert.equal(isSafeCatalogImage('data:image/png;base64,aGVsbG8='), true);
  assert.equal(isSafeCatalogImage('data:image/svg+xml;base64,PHN2Zz4='), false);
  assert.throws(() => validateCatalog([{...catalog[0],id:'bad id'}]));
  assert.throws(() => validateCatalog([{...catalog[0],image:'javascript:alert(1)'}]));
});
test('catalogue accepts exact decimal prices up to two fractional digits', () => {
  const decimal = [{...catalog[0],items:[{...catalog[0].items[0],options:[{...catalog[0].items[0].options[0],packs:[['نصف',1.5]]}]}]}];
  assert.equal(validateCatalog(decimal)[0].items[0].options[0].packs[0][1], 1.5);
  const tooPrecise = [{...catalog[0],items:[{...catalog[0].items[0],options:[{...catalog[0].items[0].options[0],packs:[['غير صالح',1.234]]}]}]}];
  assert.throws(() => validateCatalog(tooPrecise), /INVALID_PACK_PRICE/);
});
test('catalogue API URLs require public HTTPS hosts without credentials or custom ports', () => {
  assert.equal(validateCatalogApiUrl('https://catalog.vendor.net/v1/catalog').hostname,'catalog.vendor.net');
  for (const url of ['http://catalog.vendor.net/items','https://127.0.0.1/catalog','https://localhost/catalog',
    'https://service.local/catalog','https://catalog.vendor.net:8443/items','https://user:pass@catalog.vendor.net/items']) {
    assert.throws(() => validateCatalogApiUrl(url));
  }
});

test('product write API adds a valid product and upserts matching product IDs', () => {
  const product = {...catalog[0].items[0],id:'api-product',name:'API Product'};
  const added = upsertCatalogProduct(catalog,'games',product);
  assert.equal(added.created,true);
  assert.equal(added.catalog[0].items.at(-1).id,'api-product');
  const updated = upsertCatalogProduct(added.catalog,'games',{...product,name:'API Product Updated'});
  assert.equal(updated.created,false);
  assert.equal(updated.catalog[0].items.at(-1).name,'API Product Updated');
  assert.throws(() => upsertCatalogProduct(catalog,'missing',product),/CATEGORY_NOT_FOUND/);
});
test('catalogue validator supports the full imported supplier catalogue with safe aggregate limits',()=>{
  const supplierCatalog=Array.from({length:661},(_,categoryIndex)=>({
    id:'wamda-category-'+categoryIndex,
    name:'Supplier category '+categoryIndex,
    desc:'Imported supplier category',
    image:'assets/brand/logo.svg',
    items:Array.from({length:categoryIndex===0?211:categoryIndex<=532?6:5},(_,productIndex)=>({
      id:'wamda-'+categoryIndex+'-'+productIndex,
      name:'Supplier product '+categoryIndex+'-'+productIndex,
      desc:'Imported digital product',
      image:'assets/brand/logo.svg',
      options:[],
    })),
  }));
  const validated=validateCatalog(supplierCatalog);
  assert.equal(validated.length,661);
  assert.equal(validated[0].items.length,211);
  assert.equal(validated.reduce((sum,category)=>sum+category.items.length,0),4043);
  assert.throws(()=>validateCatalog([...supplierCatalog,...Array.from({length:340},(_,i)=>({
    id:'extra-category-'+i,name:'Extra '+i,desc:'',image:'assets/brand/logo.svg',items:[]
  }))]),/INVALID_CATALOG/);
  const largeSupplierCategory=[{...catalog[0],items:Array.from({length:955},(_,i)=>({
    id:'supplier-large-'+i,name:'Supplier product '+i,desc:'Imported product',image:'assets/brand/logo.svg',options:[]
  }))}];
  assert.equal(validateCatalog(largeSupplierCategory)[0].items.length,955);
  const oversized=[{...catalog[0],items:Array.from({length:2001},(_,i)=>({
    id:'oversized-'+i,name:'Product '+i,desc:'Product',image:'assets/brand/logo.svg',options:[]
  }))}];
  assert.throws(()=>validateCatalog(oversized),/INVALID_CATEGORY_ITEMS/);
});


test('catalogue validator rejects aggregate product counts beyond the 10,000-product safety limit',()=>{
  const makeCategory=(categoryIndex,count)=>({
    id:'bulk-category-'+categoryIndex,
    name:'Bulk category '+categoryIndex,
    desc:'Bulk import',
    image:'assets/brand/logo.svg',
    items:Array.from({length:count},(_,productIndex)=>({
      id:'bulk-product-'+categoryIndex+'-'+productIndex,
      name:'Bulk product '+categoryIndex+'-'+productIndex,
      desc:'Imported product',
      image:'assets/brand/logo.svg',
      options:[],
    })),
  });
  const oversized=Array.from({length:20},(_,index)=>makeCategory(index,500));
  oversized.push(makeCategory(20,1));
  assert.throws(()=>validateCatalog(oversized),/CATALOG_PRODUCT_LIMIT_EXCEEDED/);
});

test('reads configured FX response paths and converts legacy units', () => {
  assert.equal(getJsonPath({data:{usd:{buy:14500}}}, 'data.usd.buy'), 14500);
  assert.equal(normalizeFxRate(14500, 'old'), 145);
  assert.equal(normalizeFxRate('145', 'new'), 145);
  assert.throws(() => normalizeFxRate(0, 'new'));
});

test('catalog merge upserts matching products without deleting local-only products', () => {
  const original = validateCatalog(catalog);
  const incoming = [{...catalog[0],name:'ألعاب محدثة',items:[{...catalog[0].items[0],name:'Free Fire API'}]}];
  const merged = mergeCatalog(original,incoming);
  assert.equal(merged[0].name,'ألعاب محدثة');
  assert.equal(merged[0].items[0].name,'Free Fire API');
  assert.equal(merged[0].items.length,1);
});
test('catalog merge preserves existing products and appends products from incoming categories', () => {
  const original = [{...catalog[0],items:[catalog[0].items[0],{...catalog[0].items[0],id:'pubg',name:'PUBG'}]}];
  const incoming = [{...catalog[0],items:[{...catalog[0].items[0],name:'Free Fire API'},{...catalog[0].items[0],id:'roblox',name:'Roblox'}]}];
  const merged = mergeCatalog(original,incoming);
  assert.deepEqual(merged[0].items.map(item=>item.id),['freefire','roblox','pubg']);
});
test('catalog replace mode is explicit', () => {
  const replacement = [{...catalog[0],name:'Replaced'}];
  assert.equal(mergeCatalog(catalog,replacement,'replace')[0].name,'Replaced');
  assert.throws(() => mergeCatalog(catalog,replacement,'unknown'),/INVALID_CATALOG_SYNC_MODE/);
});

test('catalog API refresh preserves manual product display overrides and keeps a fresh API snapshot',()=>{
  const manualOptions=[{
    ...catalog[0].items[0].options[0],
    name:'نسخة معدلة يدوياً',
    packs:[['باقة يدوية',250]],
  }];
  const original=[{
    ...catalog[0],
    items:[{
      ...catalog[0].items[0],
      manualOverrides:{
        name:'اسم يدوي',
        desc:'وصف يدوي',
        image:'assets/products/logo.svg',
        options:manualOptions,
      },
    }],
  }];
  const incoming=[{
    ...catalog[0],
    items:[{
      ...catalog[0].items[0],
      name:'API product name',
      desc:'Description from API',
      image:'assets/products/pubg.svg',
      options:[{
        ...catalog[0].items[0].options[0],
        name:'API option',
        packs:[['API price',320]],
      }],
    }],
  }];
  const merged=mergeCatalog(original,incoming);
  const product=merged[0].items[0];
  assert.equal(product.name,'اسم يدوي');
  assert.equal(product.desc,'وصف يدوي');
  assert.equal(product.image,'assets/products/logo.svg');
  assert.equal(product.options[0].name,'نسخة معدلة يدوياً');
  assert.equal(product.options[0].packs[0][1],250);
  assert.equal(product.apiSource.name,'API product name');
  assert.equal(product.apiSource.desc,'Description from API');
  assert.equal(product.apiSource.image,'assets/products/pubg.svg');
  assert.equal(product.apiSource.options[0].name,'API option');
  assert.equal(product.apiSource.options[0].packs[0][1],320);
});


test('catalogue validator accepts up to twelve decimal places for supplier unit prices only',()=>{
  const base={
    id:'tiny-price-product',name:'Tiny supplier product',desc:'Supplier unit price below one cent',
    image:'assets/brand/logo.svg',
    options:[{id:'default',name:'Default',desc:'',packs:[['Unit',0.000000274586]]}],
  };
  const supplierCategory=[{
    id:'tiny-price-category',name:'Supplier products',desc:'',image:'assets/brand/logo.svg',
    items:[{...base,options:[{id:'default',name:'Default',desc:'',packs:[['Unit',0.000000274586]]}],wamda:{provider:'wamda'}}],
  }];
  assert.equal(validateCatalog(supplierCategory)[0].items[0].options[0].packs[0][1],0.000000274586);
  const ordinaryCategory=[{
    id:'ordinary-price-category',name:'Ordinary products',desc:'',image:'assets/brand/logo.svg',
    items:[base],
  }];
  assert.throws(()=>validateCatalog(ordinaryCategory),/INVALID_PACK_PRICE/);
});

test('catalog folders support nested parents, root departments, visibility and safe tree validation',()=>{
  const nested=[
    {...catalog[0],id:'games-root',name:'Games folder',parentId:'',departmentId:'games',items:[]},
    {...catalog[0],id:'pubg-folder',name:'PUBG folder',parentId:'games-root',items:[]},
    {...catalog[0],id:'pubg-products',name:'PUBG packs',parentId:'pubg-folder',items:[{...catalog[0].items[0],id:'pubg-uc'}]},
  ];
  const validated=validateCatalog(nested);
  assert.equal(validated[2].parentId,'pubg-folder');
  assert.equal(validated[0].departmentId,'games');
  assert.throws(()=>validateCatalog([{...nested[0],id:'bad-child',parentId:'missing-parent'}]),/INVALID_CATEGORY_PARENT/);
  assert.throws(()=>validateCatalog([{...nested[0],id:'loop-a',parentId:'loop-b',departmentId:undefined},{...nested[1],id:'loop-b',parentId:'loop-a'}]),/CATALOG_FOLDER_CYCLE/);
  assert.throws(()=>validateCatalog([nested[0],{...nested[1],id:'bad-nested',parentId:'games-root',departmentId:'apps'}]),/NESTED_CATEGORY_CANNOT_SET_DEPARTMENT/);
  assert.throws(()=>validateCatalog([{...nested[0],visible:'false'}]),/INVALID_CATEGORY_VISIBILITY/);
});

test('catalog refresh preserves manually organized folder names, parent links and product visibility',()=>{
  const original=[{
    ...catalog[0],id:'source-folder',name:'اسم مجلد يدوي',parentId:'',departmentId:'games',visible:false,sortOrder:4,
    apiSource:{name:'Supplier category',desc:'Supplier description',image:'assets/categories/games.svg',icon:'🎮'},
    manualOverrides:{name:'اسم مجلد يدوي',parentId:'',departmentId:'games',visible:false,sortOrder:4},
    items:[{...catalog[0].items[0],visible:false,manualOverrides:{name:'اسم منتج يدوي',visible:false}}],
  }];
  const incoming=[{
    ...catalog[0],id:'source-folder',name:'Supplier category updated',desc:'Updated',items:[{...catalog[0].items[0],name:'API product updated'}],
  }];
  const merged=mergeCatalog(original,incoming);
  assert.equal(merged[0].name,'اسم مجلد يدوي');
  assert.equal(merged[0].parentId,'');
  assert.equal(merged[0].departmentId,'games');
  assert.equal(merged[0].visible,false);
  assert.equal(merged[0].items[0].visible,false);
  assert.equal(merged[0].items[0].name,'اسم منتج يدوي');
  assert.equal(merged[0].apiSource.name,'Supplier category updated');
  assert.ok(merged[0].sourceCategoryAliases.includes('Supplier category'));
  assert.ok(merged[0].sourceCategoryAliases.includes('Supplier category updated'));
});

test('replace sync preserves manually-created nested folders that are not in supplier feed',()=>{
  const root={...catalog[0],id:'manual-root',name:'Manual root',parentId:'',departmentId:'games',folderManual:true,items:[]};
  const child={...catalog[0],id:'manual-child',name:'Manual child',parentId:'manual-root',items:[]};
  const replacement=[{...catalog[0],id:'supplier-feed-category',name:'Supplier feed',items:[]}];
  const merged=mergeCatalog([root,child],replacement,'replace');
  assert.deepEqual(merged.map(row=>row.id),['supplier-feed-category','manual-root','manual-child']);
});

test('deleting a non-empty folder rehomes products and child folders without changing supplier metadata',()=>{
  const root={...catalog[0],id:'games-root',name:'Games',parentId:'',departmentId:'games',items:[]};
  const supplierProduct={
    ...catalog[0].items[0],id:'freefire-10',supplierMatchKey:'freefire::10',
    bestStore:{provider:'beststore',productId:501,available:true},
    manualOverrides:{name:'اسم يدوي',image:'assets/products/freefire.svg'},
  };
  const source={...catalog[0],id:'old-folder',name:'Old folder',parentId:'games-root',items:[supplierProduct],sourceCategoryAliases:['Supplier folder']};
  const destination={...catalog[0],id:'new-folder',name:'New folder',parentId:'games-root',items:[]};
  const child={...catalog[0],id:'child-folder',name:'Child',parentId:'old-folder',items:[]};
  const leaf={...catalog[0],id:'leaf-folder',name:'Leaf',parentId:'child-folder',items:[]};
  const result=deleteCatalogFolder([root,source,destination,child,leaf],'old-folder','new-folder');
  assert.equal(result.some(row=>row.id==='old-folder'),false);
  const target=result.find(row=>row.id==='new-folder');
  assert.equal(target.items[0].id,'freefire-10');
  assert.equal(target.items[0].supplierMatchKey,'freefire::10');
  assert.equal(target.items[0].bestStore.productId,501);
  assert.equal(target.items[0].manualOverrides.name,'اسم يدوي');
  assert.ok(target.sourceCategoryAliases.includes('Supplier folder'));
  assert.equal(result.find(row=>row.id==='child-folder').parentId,'new-folder');
  assert.equal(result.find(row=>row.id==='leaf-folder').parentId,'child-folder');
});

test('deleting an empty folder needs no destination when another folder remains',()=>{
  const empty={...catalog[0],id:'empty-folder',name:'Empty',parentId:'',departmentId:'games',items:[]};
  const retained={...catalog[0],id:'retained-folder',name:'Retained',parentId:'',departmentId:'games',items:[]};
  const result=deleteCatalogFolder([empty,retained],'empty-folder');
  assert.deepEqual(result.map(row=>row.id),['retained-folder']);
});

test('deleting the final empty folder is rejected to keep the catalog non-empty',()=>{
  const empty={...catalog[0],id:'only-folder',name:'Only',parentId:'',departmentId:'games',items:[]};
  assert.throws(()=>deleteCatalogFolder([empty],'only-folder'),/LAST_CATALOG_FOLDER_CANNOT_DELETE/);
});

test('deleting a non-empty folder without a destination is rejected',()=>{
  const source={...catalog[0],id:'source',items:[catalog[0].items[0]]};
  assert.throws(()=>deleteCatalogFolder([source],'source'),/FOLDER_DELETE_DESTINATION_REQUIRED/);
});

test('folder deletion rejects destinations inside the deleted subtree',()=>{
  const source={...catalog[0],id:'source',items:[]};
  const child={...catalog[0],id:'child',parentId:'source',items:[]};
  assert.throws(()=>deleteCatalogFolder([source,child],'source','child'),/INVALID_FOLDER_DELETE_DESTINATION/);
});

test('folder deletion rejects product ID collisions in the destination',()=>{
  const product={...catalog[0].items[0],id:'same-product'};
  const source={...catalog[0],id:'source',items:[product]};
  const destination={...catalog[0],id:'destination',items:[{...product}]};
  assert.throws(()=>deleteCatalogFolder([source,destination],'source','destination'),/PRODUCT_ID_COLLISION_IN_DESTINATION/);
});

test('product fulfillment settings are validated and bounded',()=>{
  const manual={...catalog[0],items:[{...catalog[0].items[0],fulfillmentMode:'manual',manualDeliveryHours:36}]};
  assert.equal(validateCatalog([manual])[0].items[0].manualDeliveryHours,36);
  assert.throws(()=>validateCatalog([{...catalog[0],items:[{...catalog[0].items[0],fulfillmentMode:'instant'}]}]),/INVALID_PRODUCT_FULFILLMENT_MODE/);
  assert.throws(()=>validateCatalog([{...catalog[0],items:[{...catalog[0].items[0],manualDeliveryHours:0}]}]),/INVALID_PRODUCT_MANUAL_DELIVERY_HOURS/);
  assert.throws(()=>validateCatalog([{...catalog[0],items:[{...catalog[0].items[0],fulfillmentMode:'automatic'}]}]),/AUTOMATIC_FULFILLMENT_REQUIRES_SUPPORTED_SUPPLIER/);
});

test('catalogue sync preserves manual fulfillment choice and its delivery SLA',()=>{
  const supplierLink={provider:'seagm',kind:'card',categoryId:1,typeId:1};
  const manualProduct={...catalog[0].items[0],seagm:supplierLink,fulfillmentMode:'manual',manualDeliveryHours:48,
    manualOverrides:{fulfillmentMode:'manual',manualDeliveryHours:48}};
  const original=[{...catalog[0],items:[manualProduct]}];
  const supplierProduct={...catalog[0].items[0],seagm:supplierLink,fulfillmentMode:'automatic',manualDeliveryHours:24};
  const incoming=[{...catalog[0],items:[supplierProduct]}];
  const merged=mergeCatalog(original,incoming);
  assert.equal(merged[0].items[0].fulfillmentMode,'manual');
  assert.equal(merged[0].items[0].manualDeliveryHours,48);
});

test('catalog sort priorities are non-negative integers',()=>{
  assert.throws(()=>validateCatalog([{...catalog[0],sortOrder:-1}]),/INVALID_CATEGORY_SORT_ORDER/);
  assert.throws(()=>validateCatalog([{...catalog[0],items:[{...catalog[0].items[0],sortOrder:-1}]}]),/INVALID_PRODUCT_SORT_ORDER/);
});
