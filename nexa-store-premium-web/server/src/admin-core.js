import crypto from 'node:crypto';
import net from 'node:net';

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,49}$/i;
const MAX_IMAGE_DATA_LENGTH = 2_400_000;

export function createAdminSession(secret, now = Date.now(), ttlSeconds = 8 * 60 * 60) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('ADMIN_KEY_TOO_SHORT');
  const expires = String(Math.floor(now / 1000) + ttlSeconds);
  const signature = crypto.createHmac('sha256', secret).update(expires).digest('base64url');
  return `${expires}.${signature}`;
}

export function verifyAdminSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 24) return false;
  const [expires, signature, extra] = token.split('.');
  if (extra !== undefined || !/^\d{10,12}$/.test(expires || '') || !/^[A-Za-z0-9_-]{40,50}$/.test(signature || '')) return false;
  if (Number(expires) <= Math.floor(now / 1000)) return false;
  const expected = crypto.createHmac('sha256', secret).update(expires).digest();
  let supplied;
  try { supplied = Buffer.from(signature, 'base64url'); } catch { return false; }
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function encryptionKey(secret) {
  if (typeof secret !== 'string' || secret.length < 24) throw new Error('ADMIN_KEY_TOO_SHORT');
  return crypto.createHash('sha256').update('nexa-store-admin-secret-v1:').update(secret).digest();
}
export function encryptSecret(value, secret) {
  if (typeof value !== 'string' || !value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptSecret(value, secret) {
  if (!value) return '';
  const [ivText, tagText, dataText, extra] = String(value).split('.');
  if (extra !== undefined || !ivText || !tagText || !dataText) throw new Error('INVALID_ENCRYPTED_SECRET');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

export function isSafeCatalogImage(image) {
  if (typeof image !== 'string' || image.length > MAX_IMAGE_DATA_LENGTH) return false;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image)) return true;
  if (/^https:\/\//i.test(image)) {
    try { const url = new URL(image); return Boolean(url.hostname) && !url.username && !url.password; } catch { return false; }
  }
  return /^assets\/(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+\.(?:svg|png|jpe?g|webp|gif)$/i.test(image);
}

function requiredText(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`INVALID_${label}`);
}

function hasAtMostDecimalPlaces(value, maximum) {
  const [mantissa, exponentText = '0'] = String(value).toLowerCase().split('e');
  const decimalPlaces = (mantissa.split('.')[1] || '').length - Number(exponentText);
  return Number.isFinite(decimalPlaces) && Math.max(0, decimalPlaces) <= maximum;
}
function validId(value, label) {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new Error(`INVALID_${label}_ID`);
}
function validateUniqueIds(rows, label) {
  const seen = new Set();
  for (const row of rows) {
    validId(row?.id, label);
    if (seen.has(row.id)) throw new Error(`DUPLICATE_${label}_ID`);
    seen.add(row.id);
  }
}

const MAX_CATALOG_CATEGORIES = 1000;
const CATALOG_DEPARTMENT_IDS = new Set(['games','balance','apps','numbers','cards','vpn','verification','ai','social','web','other']);
const CATEGORY_MANUAL_KEYS = ['name','desc','image','icon','parentId','departmentId','sortOrder','visible'];
const PRODUCT_MANUAL_KEYS = ['name','desc','image','options','sortOrder','visible','fulfillmentMode','manualDeliveryHours','manualDeliveryMessage'];
// Large supplier categories (such as Best Store's 955-item ZNET category) must remain publishable.
const MAX_PRODUCTS_PER_CATEGORY = 2000;
const MAX_CATALOG_PRODUCTS = 10000;

export function validateCatalog(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CATALOG_CATEGORIES) throw new Error('INVALID_CATALOG');
  validateUniqueIds(input, 'CATEGORY');
  const categoriesById = new Map(input.map(category=>[category.id,category]));
  let totalProducts = 0;
  for (const category of input) {
    requiredText(category.name, 100, 'CATEGORY_NAME');
    if (typeof category.desc !== 'string' || category.desc.length > 500) throw new Error('INVALID_CATEGORY_DESC');
    if (!isSafeCatalogImage(category.image)) throw new Error('INVALID_CATEGORY_IMAGE');
    if (category.icon !== undefined && (typeof category.icon !== 'string' || category.icon.length > 12)) throw new Error('INVALID_CATEGORY_ICON');
    if (category.parentId !== undefined && category.parentId !== null && category.parentId !== '') {
      validId(category.parentId,'CATEGORY_PARENT');
      if (category.parentId===category.id || !categoriesById.has(category.parentId)) throw new Error('INVALID_CATEGORY_PARENT');
      if (category.departmentId !== undefined && category.departmentId !== null && category.departmentId !== '') throw new Error('NESTED_CATEGORY_CANNOT_SET_DEPARTMENT');
    }
    if (category.departmentId !== undefined && category.departmentId !== null && category.departmentId !== '' && !CATALOG_DEPARTMENT_IDS.has(category.departmentId)) throw new Error('INVALID_CATEGORY_DEPARTMENT');
    if (category.sortOrder !== undefined && (!Number.isSafeInteger(category.sortOrder) || Math.abs(category.sortOrder)>1_000_000)) throw new Error('INVALID_CATEGORY_SORT_ORDER');
    if (category.visible !== undefined && typeof category.visible !== 'boolean') throw new Error('INVALID_CATEGORY_VISIBILITY');
    if (category.manualOverrides !== undefined && (!category.manualOverrides || typeof category.manualOverrides!=='object' || Array.isArray(category.manualOverrides))) throw new Error('INVALID_CATEGORY_MANUAL_OVERRIDES');
    if (category.sourceCategoryAliases !== undefined && (!Array.isArray(category.sourceCategoryAliases) || category.sourceCategoryAliases.length>40 || category.sourceCategoryAliases.some(value=>typeof value!=='string'||value.length>100))) throw new Error('INVALID_CATEGORY_SOURCE_ALIASES');
    if (!Array.isArray(category.items) || category.items.length > MAX_PRODUCTS_PER_CATEGORY) throw new Error('INVALID_CATEGORY_ITEMS');
    totalProducts += category.items.length;
    if (totalProducts > MAX_CATALOG_PRODUCTS) throw new Error('CATALOG_PRODUCT_LIMIT_EXCEEDED');
    validateUniqueIds(category.items, 'PRODUCT');
    for (const product of category.items) {
      requiredText(product.name, 120, 'PRODUCT_NAME');
      if (typeof product.desc !== 'string' || product.desc.length > 700) throw new Error('INVALID_PRODUCT_DESC');
      if (!isSafeCatalogImage(product.image)) throw new Error('INVALID_PRODUCT_IMAGE');
      if (product.visible !== undefined && typeof product.visible !== 'boolean') throw new Error('INVALID_PRODUCT_VISIBILITY');
      if (product.manualCreated !== undefined && typeof product.manualCreated !== 'boolean') throw new Error('INVALID_PRODUCT_MANUAL_CREATED');
      if (product.fulfillmentMode !== undefined && !['automatic','manual'].includes(product.fulfillmentMode)) throw new Error('INVALID_PRODUCT_FULFILLMENT_MODE');
      if (product.manualDeliveryHours !== undefined && (!Number.isSafeInteger(product.manualDeliveryHours) || product.manualDeliveryHours < 1 || product.manualDeliveryHours > 720)) throw new Error('INVALID_PRODUCT_MANUAL_DELIVERY_HOURS');
      if (product.manualDeliveryMessage !== undefined && (typeof product.manualDeliveryMessage !== 'string' || product.manualDeliveryMessage.length > 240 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(product.manualDeliveryMessage))) throw new Error('INVALID_PRODUCT_MANUAL_DELIVERY_MESSAGE');
      if (product.sortOrder !== undefined && (!Number.isSafeInteger(product.sortOrder) || Math.abs(product.sortOrder)>1_000_000)) throw new Error('INVALID_PRODUCT_SORT_ORDER');
      if (product.manualOverrides !== undefined && (!product.manualOverrides || typeof product.manualOverrides!=='object' || Array.isArray(product.manualOverrides))) throw new Error('INVALID_PRODUCT_MANUAL_OVERRIDES');
      if (!Array.isArray(product.options) || product.options.length > 100) throw new Error('INVALID_PRODUCT_OPTIONS');
      validateUniqueIds(product.options, 'OPTION');
      for (const option of product.options) {
        requiredText(option.name, 120, 'OPTION_NAME');
        if (typeof option.desc !== 'string' || option.desc.length > 500) throw new Error('INVALID_OPTION_DESC');
        if (option.flag !== undefined && (typeof option.flag !== 'string' || option.flag.length > 12)) throw new Error('INVALID_OPTION_FLAG');
        if (option.image !== undefined && option.image !== '' && !isSafeCatalogImage(option.image)) throw new Error('INVALID_OPTION_IMAGE');
        if (!Array.isArray(option.packs) || option.packs.length > 200) throw new Error('INVALID_OPTION_PACKS');
        for (const pack of option.packs) {
          if (!Array.isArray(pack) || pack.length !== 2) throw new Error('INVALID_PACK');
          requiredText(pack[0], 120, 'PACK_NAME');
          const supplierLinked = product.wamda?.provider === 'wamda' || product.bestStore?.provider === 'beststore';
          const maximumDecimals = supplierLinked ? 12 : 2;
          if (!Number.isFinite(pack[1]) || pack[1] < 0 || pack[1] > 1_000_000_000 || !hasAtMostDecimalPlaces(pack[1], maximumDecimals)) throw new Error('INVALID_PACK_PRICE');
        }
      }
    }
  }
  // Category parent references must form a tree: reject cycles before the
  // catalog is persisted, otherwise a recursive storefront/admin tree could loop.
  for (const category of input) {
    const visited = new Set([category.id]);
    let parentId = category.parentId || '';
    while (parentId) {
      if (visited.has(parentId)) throw new Error('CATALOG_FOLDER_CYCLE');
      visited.add(parentId);
      parentId = categoriesById.get(parentId)?.parentId || '';
    }
  }
  return JSON.parse(JSON.stringify(input));
}



export function validateCatalogApiUrl(raw) {
  let url;
  try { url = new URL(String(raw || '')); } catch { throw new Error('INVALID_CATALOG_API_URL'); }
  const host = url.hostname.toLowerCase().replace(/^\\[|\\]$/g,'');
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !host || net.isIP(host) || host === 'localhost' || host.endsWith('.localhost') ||
      host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.home') ||
      host.endsWith('.internal') || host.endsWith('.test') || host.endsWith('.invalid') ||
      host.endsWith('.example') || host === 'metadata.google.internal') {
    throw new Error('CATALOG_API_HTTPS_PUBLIC_HOST_REQUIRED');
  }
  return url;
}

function applyCategorySourceMerge(previousCategory,incomingCategory) {
  const source=JSON.parse(JSON.stringify(incomingCategory));
  const previous=previousCategory||{};
  const sourceSnapshot={name:source.name,desc:source.desc,image:source.image,icon:source.icon};
  const overrides=previous.manualOverrides&&typeof previous.manualOverrides==='object'&&!Array.isArray(previous.manualOverrides)
    ?{...previous.manualOverrides}:{};
  const oldSource=previous.apiSource&&typeof previous.apiSource==='object'?previous.apiSource:null;
  if(oldSource){
    for(const key of CATEGORY_MANUAL_KEYS){
      if(!Object.prototype.hasOwnProperty.call(overrides,key)&&Object.prototype.hasOwnProperty.call(oldSource,key)&&
          Object.prototype.hasOwnProperty.call(previous,key)&&JSON.stringify(previous[key])!==JSON.stringify(oldSource[key]))overrides[key]=previous[key];
    }
  }
  const category={...previous,...source,apiSource:sourceSnapshot,sourceCategoryAliases:Array.from(new Set([
    ...(Array.isArray(previous.sourceCategoryAliases)?previous.sourceCategoryAliases:[]),
    ...(previous.apiSource?.name?[previous.apiSource.name]:[]),source.name
  ].filter(value=>typeof value==='string'&&value.trim()))).slice(0,40)};
  for(const key of CATEGORY_MANUAL_KEYS){
    if(Object.prototype.hasOwnProperty.call(overrides,key))category[key]=JSON.parse(JSON.stringify(overrides[key]));
  }
  if(Object.keys(overrides).length)category.manualOverrides=overrides;
  else delete category.manualOverrides;
  return category;
}

function mergeSupplierProduct(previous, incoming) {
  const source=JSON.parse(JSON.stringify(incoming));
  const previousProduct=previous||{};
  const apiSource={
    name:source.name,desc:source.desc,image:source.image,
    options:Array.isArray(source.options)?source.options.map(option=>({...option,packs:(option.packs||[]).map(pack=>[...pack])})):[],
  };
  const overrides=previousProduct.manualOverrides&&typeof previousProduct.manualOverrides==='object'&&!Array.isArray(previousProduct.manualOverrides)
    ?{...previousProduct.manualOverrides}:{};
  const isManualCreated=previousProduct.manualCreated===true||source.manualCreated===true;
  const product={...previousProduct,...source,apiSource,...(isManualCreated?{manualCreated:true}:{})};
  for(const key of PRODUCT_MANUAL_KEYS){
    if(Object.prototype.hasOwnProperty.call(overrides,key))product[key]=JSON.parse(JSON.stringify(overrides[key]));
  }
  if(Object.keys(overrides).length)product.manualOverrides=overrides;
  else delete product.manualOverrides;
  return product;
}

export function deleteCatalogFolder(input, categoryId, destinationCategoryId = '') {
  const current=validateCatalog(input);
  if(typeof categoryId!=='string'||!categoryId)throw Object.assign(new Error('INVALID_FOLDER_ID'),{status:400});
  const source=current.find(category=>category.id===categoryId);
  if(!source)throw Object.assign(new Error('CATALOG_FOLDER_NOT_FOUND'),{status:404});
  const subtree=new Set([categoryId]);
  let changed=true;
  while(changed){
    changed=false;
    for(const category of current){
      if(category.parentId&&subtree.has(category.parentId)&&!subtree.has(category.id)){
        subtree.add(category.id);changed=true;
      }
    }
  }
  const directChildren=current.filter(category=>category.parentId===categoryId);
  const hasContents=(source.items||[]).length>0||directChildren.length>0;
  const destinationId=String(destinationCategoryId||'');
  if(hasContents&&!destinationId)throw Object.assign(new Error('FOLDER_DELETE_DESTINATION_REQUIRED'),{status:400});
  if(!hasContents&&destinationId&&subtree.has(destinationId))throw Object.assign(new Error('INVALID_FOLDER_DELETE_DESTINATION'),{status:400});
  if(hasContents){
    if(!destinationId||subtree.has(destinationId))throw Object.assign(new Error('INVALID_FOLDER_DELETE_DESTINATION'),{status:400});
    const destination=current.find(category=>category.id===destinationId);
    if(!destination)throw Object.assign(new Error('FOLDER_DELETE_DESTINATION_NOT_FOUND'),{status:404});
    const targetProductIds=new Set((destination.items||[]).map(product=>product.id));
    if((source.items||[]).some(product=>targetProductIds.has(product.id)))
      throw Object.assign(new Error('PRODUCT_ID_COLLISION_IN_DESTINATION'),{status:409});
  }
  const result=current.map(category=>JSON.parse(JSON.stringify(category)));
  const sourceCopy=result.find(category=>category.id===categoryId);
  if(hasContents){
    const destination=result.find(category=>category.id===destinationId);
    destination.items.push(...sourceCopy.items);
    destination.sourceCategoryAliases=Array.from(new Set([
      ...(Array.isArray(destination.sourceCategoryAliases)?destination.sourceCategoryAliases:[]),
      ...(Array.isArray(sourceCopy.sourceCategoryAliases)?sourceCopy.sourceCategoryAliases:[]),
      ...(sourceCopy.apiSource?.name?[sourceCopy.apiSource.name]:[]),
      ...(sourceCopy.name?[sourceCopy.name]:[]),
    ].filter(value=>typeof value==='string'&&value.trim()))).slice(0,40);
    for(const child of result){
      if(child.parentId!==categoryId)continue;
      child.parentId=destinationId;
      child.departmentId='';
      child.manualOverrides={
        ...(child.manualOverrides&&typeof child.manualOverrides==='object'?child.manualOverrides:{}),
        parentId:destinationId,
        departmentId:'',
      };
    }
  }
  const remaining=result.filter(category=>category.id!==categoryId);
  if(!remaining.length)throw Object.assign(new Error('LAST_CATALOG_FOLDER_CANNOT_DELETE'),{status:409});
  return validateCatalog(remaining);
}

export function mergeCatalog(existing, incoming, mode = 'merge') {
  const current=validateCatalog(existing),next=validateCatalog(incoming);
  if(!['merge','replace'].includes(mode))throw new Error('INVALID_CATALOG_SYNC_MODE');
  const result=mode==='replace'
    ?next.map(category=>JSON.parse(JSON.stringify(category)))
    :current.map(category=>JSON.parse(JSON.stringify(category)));
  const incomingIds=new Set(next.map(category=>category.id));
  for(const incomingCategory of next){
    const index=result.findIndex(category=>category.id===incomingCategory.id);
    if(index<0){result.push(JSON.parse(JSON.stringify(incomingCategory)));continue;}
    const previous=result[index];
    const sourceCategory=applyCategorySourceMerge(previous,incomingCategory);
    const oldProducts=new Map((previous.items||[]).map(product=>[product.id,product]));
    const incomingProducts=(incomingCategory.items||[]).map(product=>mergeSupplierProduct(oldProducts.get(product.id),product));
    const incomingProductIds=new Set(incomingProducts.map(product=>product.id));
    let items=incomingProducts;
    if(mode==='merge'){
      items=[...incomingProducts,...(previous.items||[]).filter(product=>!incomingProductIds.has(product.id))];
    }else{
      const manualProducts=(previous.items||[]).filter(product=>product.manualCreated===true&&!incomingProductIds.has(product.id));
      items=[...incomingProducts,...manualProducts];
    }
    result[index]={...sourceCategory,items};
  }
  if(mode==='replace'){
    // Preserve manually-created/moved folder nodes that are not part of the
    // upstream feed; they are part of the store's organization, not the feed.
    for(const category of current){
      if(incomingIds.has(category.id))continue;
      const hasManualStructure=Boolean(category.parentId||category.departmentId||category.manualOverrides||category.folderManual);
      if(hasManualStructure)result.push(JSON.parse(JSON.stringify(category)));
    }
  }
  return validateCatalog(result);
}


export function upsertCatalogProduct(existingCatalog, categoryId, productInput) {
  const current = validateCatalog(existingCatalog);
  if (typeof categoryId !== 'string' || !productInput || typeof productInput !== 'object' || Array.isArray(productInput)) {
    throw new Error('INVALID_CATALOG_PRODUCT_REQUEST');
  }
  const categoryIndex = current.findIndex(category=>category.id===categoryId);
  if (categoryIndex < 0) throw Object.assign(new Error('CATEGORY_NOT_FOUND'),{status:404});
  const validated = validateCatalog([{id:'api-products',name:'API Products',desc:'API validation',image:'assets/brand/logo.svg',items:[productInput]}])[0].items[0];
  const items = current[categoryIndex].items;
  const productIndex = items.findIndex(product=>product.id===validated.id);
  if (productIndex < 0) { validated.manualCreated=true; items.push(validated); }
  else {
    const previous=items[productIndex];
    const overrides=previous.manualOverrides&&typeof previous.manualOverrides==='object'?previous.manualOverrides:{};
    validated.apiSource={name:validated.name,desc:validated.desc,image:validated.image,options:validated.options};
    for(const key of ['name','desc','image','options'])if(Object.prototype.hasOwnProperty.call(overrides,key))validated[key]=overrides[key];
    if(Object.keys(overrides).length)validated.manualOverrides=overrides;
    items[productIndex]=validated;
  }
  return { catalog:validateCatalog(current),created:productIndex<0,productId:validated.id };
}

export function getJsonPath(root, path) {
  if (typeof path !== 'string' || path.length > 160 || !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path)) {
    throw new Error('INVALID_FX_JSON_PATH');
  }
  const keys = path.split('.');
  if (keys.some(key => ['__proto__','prototype','constructor'].includes(key))) throw new Error('INVALID_FX_JSON_PATH');
  return keys.reduce((value, key) => value == null ? undefined : value[key], root);
}

export function normalizeFxRate(value, unit = 'new') {
  const numeric = Number(String(value ?? '').trim());
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100_000_000) throw new Error('INVALID_FX_RATE');
  const normalized = unit === 'old' ? numeric / 100 : numeric;
  if (!Number.isFinite(normalized) || normalized < 0.000001 || normalized > 1_000_000) throw new Error('INVALID_NORMALIZED_FX_RATE');
  return Math.round(normalized * 1_000_000) / 1_000_000;
}
