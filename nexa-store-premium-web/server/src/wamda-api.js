const API_BASE = 'https://api.wamda-store.com';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PRODUCTS = 100_000;

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function positiveInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}
function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function providerError(payload, httpStatus = 200) {
  const code = Number(payload?.code);
  const message = cleanText(payload?.message || payload?.error || 'WAMDA_API_ERROR', 300);
  const error = new Error(message);
  error.name = 'WamdaApiError';
  error.code = Number.isFinite(code) && code ? code : 'WAMDA_API_ERROR';
  error.status = httpStatus;
  error.requestId = cleanText(payload?.request_id || '', 100);
  error.remoteStatus = cleanText(payload?.status || '', 20);
  return error;
}
function assertOk(payload, httpStatus = 200) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('WAMDA_INVALID_RESPONSE'), { code:'WAMDA_INVALID_RESPONSE', status:502 });
  }
  if (httpStatus < 200 || httpStatus >= 300 || String(payload.status || '').toUpperCase() !== 'OK') {
    throw providerError(payload, httpStatus);
  }
  return payload.data;
}
async function readJson(response) {
  const length = Number(response.headers?.get?.('content-length') || 0);
  if (length > MAX_RESPONSE_BYTES) throw Object.assign(new Error('WAMDA_RESPONSE_TOO_LARGE'), { code:'WAMDA_RESPONSE_TOO_LARGE', status:502 });
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw Object.assign(new Error('WAMDA_RESPONSE_TOO_LARGE'), { code:'WAMDA_RESPONSE_TOO_LARGE', status:502 });
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('WAMDA_INVALID_JSON_RESPONSE'), { code:'WAMDA_INVALID_JSON_RESPONSE', status:502 }); }
}
function normalizeImage(value) {
  const candidate=typeof value==='string'?value:(value?.url||value?.src||value?.original_url||'');
  const image=cleanText(candidate,500);
  if(/^https:\/\//i.test(image))return image;
  if(/^assets\/[A-Za-z0-9_./-]+$/i.test(image)&&!image.includes('..'))return image;
  return '';
}
function normalizeProduct(row) {
  const id = positiveInteger(row?.id);
  if (!id) throw new Error('WAMDA_INVALID_PRODUCT_ID');
  const price = Number(row?.price ?? 0);
  const pricePerQuantity = Number(row?.price_per_quantity ?? 1);
  const unitPriceRaw = Number(row?.unit_price);
  const unitPrice = Number.isFinite(unitPriceRaw) && unitPriceRaw >= 0
    ? unitPriceRaw
    : (Number.isFinite(price) && price >= 0 && pricePerQuantity > 0 ? price / pricePerQuantity : NaN);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('WAMDA_INVALID_PRODUCT_PRICE');
  const min = positiveInteger(row?.qty_values?.min ?? row?.min, 1);
  const max = positiveInteger(row?.qty_values?.max ?? row?.max, min);
  const fields = Array.isArray(row?.fields) ? row.fields.slice(0, 50).map(field => {
    const key = cleanText(field?.key, 80);
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key) || ['order_uuid','api_token','quantity','qty'].includes(key.toLowerCase())) return null;
    const type = ['number','text','email','url'].includes(String(field?.type || '').toLowerCase())
      ? String(field.type).toLowerCase() : 'text';
    return {
      key,
      label:cleanText(field?.label || key, 100),
      type,
      required:field?.required !== false,
      min:optionalNumber(field?.min),
      max:optionalNumber(field?.max),
    };
  }).filter(Boolean) : [];
  const categoryId = positiveInteger(row?.category_id, 0);
  const isAvailable = row?.available !== false &&
    Number(row?.is_active ?? 1) !== 0 &&
    !['disabled','inactive','unavailable'].includes(String(row?.status || '').toLowerCase());
  return {
    id,
    name:cleanText(row?.name || ('Wamda product ' + id), 160),
    description:cleanText(row?.description || row?.desc || row?.note || '', 700),
    image:normalizeImage(row?.image || row?.image_url || row?.imageUrl || row?.thumbnail_url || row?.thumbnail),
    categoryImage:normalizeImage(row?.category_image || row?.categoryImage || row?.category_image_url),
    categoryId,
    categoryName:cleanText(row?.category || 'متفرقات', 120),
    sourcePrice:Number.isFinite(price) && price >= 0 ? price : unitPrice,
    pricePerQuantity:Number.isFinite(pricePerQuantity) && pricePerQuantity > 0 ? pricePerQuantity : 1,
    unitPrice,
    currency:'USD',
    minQuantity:min,
    maxQuantity:Math.max(min, max),
    apiOnly:row?.api_only === true,
    available:isAvailable,
    fields,
  };
}
function normalizeOrder(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Object.assign(new Error('WAMDA_ORDER_RESPONSE_MISSING'), { code:'WAMDA_ORDER_RESPONSE_MISSING', status:502 });
  }
  const orderId = cleanText(data.order_id || '', 100);
  const orderCode = cleanText(data.order_code || '', 120);
  const orderUuid = cleanText(data.order_uuid || '', 80);
  const status = cleanText(data.status || '', 40).toLowerCase();
  if (!['pending','processing','completed','rejected','canceled','cancelled'].includes(status)) {
    throw Object.assign(new Error('WAMDA_UNKNOWN_ORDER_STATUS'), { code:'WAMDA_UNKNOWN_ORDER_STATUS', status:502 });
  }
  return {
    orderId, orderCode, orderUuid, status,
    price:Number.isFinite(Number(data.price)) ? Number(data.price) : null,
    balanceAfter:Number.isFinite(Number(data.balance_after)) ? Number(data.balance_after) : null,
    deliveredData:cleanText(data.delivered_data || '', 4000),
    duplicate:data.duplicate === true,
    quantity:cleanText(data.quantity ?? '', 40),
  };
}
export function createWamdaClient({ apiToken, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const token = String(apiToken || '').trim();
  if (!token || token.length > 1024) throw new Error('INVALID_WAMDA_API_TOKEN');
  if (typeof fetchImpl !== 'function') throw new Error('WAMDA_FETCH_UNAVAILABLE');

  async function request(path, { method = 'GET', query = {}, body = null } = {}) {
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_\-/]+$/.test(path)) throw new Error('INVALID_WAMDA_ENDPOINT');
    const url = new URL(API_BASE + path);
    for (const [key,value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept:'application/json', 'api-token':token };
      if (body !== null) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(url, {
        method, headers, body:body === null ? undefined : JSON.stringify(body),
        redirect:'error', signal:controller.signal,
      });
      const payload = await readJson(response);
      return { payload, data:assertOk(payload,response.status), httpStatus:response.status };
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('WAMDA_REQUEST_TIMEOUT'), { code:'WAMDA_REQUEST_TIMEOUT', status:504 });
      if (error?.name === 'WamdaApiError' || error?.code) throw error;
      throw Object.assign(new Error('WAMDA_NETWORK_ERROR'), { code:'WAMDA_NETWORK_ERROR', status:502 });
    } finally {
      clearTimeout(timeout);
    }
  }
  async function getProfile() {
    const {data} = await request('/profile');
    if (!data || typeof data !== 'object') throw new Error('WAMDA_INVALID_PROFILE_RESPONSE');
    const balance = Number(data.balance);
    return {
      username:cleanText(data.username,100),
      email:cleanText(data.email,160),
      currency:cleanText(data.currency || 'USD',12).toUpperCase(),
      balance:Number.isFinite(balance) ? balance : null,
    };
  }
  async function getCategories(parentId = 0) {
    const {data} = await request('/categories',{query:{parent_id:positiveInteger(parentId,0)}});
    if (!Array.isArray(data)) throw new Error('WAMDA_INVALID_CATEGORIES_RESPONSE');
    return data.slice(0,5000).map(row=>({
      id:positiveInteger(row?.id,0),
      name:cleanText(row?.name || 'قسم',120),
      parentId:positiveInteger(row?.parent_id,0),
      image:normalizeImage(row?.image || row?.image_url || row?.imageUrl || row?.thumbnail_url || row?.thumbnail),
      available:row?.available !== false && Number(row?.is_active ?? 1)!==0,
      apiOnly:row?.api_only===true,
    }));
  }
  async function getProducts({limit = 1000, maxPages = 1000} = {}) {
    const pageSize = Math.max(1,Math.min(20000,Math.trunc(Number(limit)||1000)));
    const pages = Math.max(1,Math.min(1000,Math.trunc(Number(maxPages)||1000)));
    const products = [];
    for(let page=1;page<=pages;page++){
      const {data,payload}=await request('/products',{query:{limit:pageSize,page}});
      if(!Array.isArray(data)) throw new Error('WAMDA_INVALID_PRODUCTS_RESPONSE');
      for(const row of data) {
        products.push(normalizeProduct(row));
        if(products.length>MAX_PRODUCTS) throw new Error('WAMDA_TOO_MANY_PRODUCTS');
      }
      const pagination=payload.pagination;
      if(!pagination || pagination.has_more!==true) {
        return {products, pagesFetched:page};
      }
    }
    throw Object.assign(new Error('WAMDA_PRODUCT_PAGINATION_LIMIT'),{code:'WAMDA_PRODUCT_PAGINATION_LIMIT',status:502});
  }
  async function createOrder(productId,{quantity=1,fields={},orderUuid}={}) {
    const id=positiveInteger(productId);
    const qty=positiveInteger(quantity);
    if(!id||!qty) throw new Error('INVALID_WAMDA_ORDER_INPUT');
    if(typeof orderUuid!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderUuid)) throw new Error('INVALID_WAMDA_ORDER_UUID');
    if(!fields||typeof fields!=='object'||Array.isArray(fields)) throw new Error('INVALID_WAMDA_ORDER_FIELDS');
    const body={};
    for(const [key,value] of Object.entries(fields)){
      if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)||['quantity','qty','order_uuid','api_token'].includes(key.toLowerCase())) continue;
      if(typeof value!=='string'&&typeof value!=='number') throw new Error('INVALID_WAMDA_ORDER_FIELD_VALUE');
      const text=String(value);
      if(text.length>1000) throw new Error('INVALID_WAMDA_ORDER_FIELD_VALUE');
      body[key]=text;
    }
    body.quantity=qty;
    body.order_uuid=orderUuid;
    const {data}=await request('/newOrder/'+id+'/params',{method:'POST',body});
    return normalizeOrder(data);
  }
  async function checkOrder(identifier,{uuid=false}={}) {
    const value=cleanText(identifier,120);
    if(!value) throw new Error('INVALID_WAMDA_ORDER_IDENTIFIER');
    const {data}=await request('/check',{query:{orders:value,...(uuid?{uuid:1}:{})}});
    if(!data||typeof data!=='object'||Array.isArray(data)) throw new Error('WAMDA_INVALID_CHECK_RESPONSE');
    const candidates=Object.values(data).filter(row=>row&&typeof row==='object'&&!Array.isArray(row));
    const match=candidates.find(row=>
      String(row.order_uuid||'')===value ||
      String(row.order_id||'')===value ||
      String(row.order_code||'')===value
    ) || (candidates.length===1 && !candidates[0].error ? candidates[0] : null);
    if(!match||match.error) return null;
    return normalizeOrder(match);
  }
  return Object.freeze({getProfile,getCategories,getProducts,createOrder,checkOrder,base:API_BASE});
}
