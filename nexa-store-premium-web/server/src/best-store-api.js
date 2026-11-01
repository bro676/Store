const BASE_URL = 'https://api.best-store.app';
const MAX_RESPONSE_BYTES = 4_000_000;

function apiError(message, status = 502, code = 'BEST_STORE_API_ERROR') {
  return Object.assign(new Error(String(message || code).slice(0, 260)), { status, code, isBestStoreApiError:true });
}
function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function safeFieldKey(value, fallback) {
  const key = String(value || '').trim();
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) ? key : fallback;
}
function normalizeParam(raw, index) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const name = String(raw.name || raw.label || raw.title || '').trim();
    return {
      submitField: safeFieldKey(raw.key || raw.param || raw.name, index === 0 ? 'playerId' : 'param' + (index + 1)),
      label: String(raw.label || raw.title || name || ('بيانات إضافية ' + (index + 1))).slice(0, 100),
      type: ['number','email','url'].includes(String(raw.type || '').toLowerCase()) ? String(raw.type).toLowerCase() : 'text',
      required: raw.required !== false,
      ...(raw.placeholder ? { placeholder: String(raw.placeholder).slice(0, 120) } : {}),
    };
  }
  const label = String(raw || '').trim().slice(0, 100) || ('بيانات إضافية ' + (index + 1));
  const normalized = label.normalize('NFKC').toLowerCase();
  let key = index === 0 ? 'playerId' : 'param' + (index + 1);
  if (/(server|سيرفر|خادم)/i.test(normalized)) key = 'serverId';
  else if (/(region|منطقة|دولة)/i.test(normalized)) key = 'region';
  else if (/(email|بريد)/i.test(normalized)) key = 'email';
  else if (/(phone|هاتف|رقم جوال)/i.test(normalized)) key = 'phone';
  return { submitField:key,label,type:'text',required:true };
}
export function normalizeBestStoreProduct(raw, currency = 'USD') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = Number(raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const name = String(raw.name || '').trim().slice(0, 140);
  if (!name) return null;
  const listedPrice = safeNumber(raw.price, NaN);
  const basePrice = safeNumber(raw.base_price, NaN);
  const sourceCost = Number.isFinite(basePrice) && basePrice > 0
    ? basePrice
    : listedPrice;
  if (!Number.isFinite(sourceCost) || sourceCost <= 0) return null;
  const quantity = raw.qty_values;
  let minimumQuantity = 1, maximumQuantity = 1, allowedQuantities = [];
  if (Array.isArray(quantity)) {
    allowedQuantities = [...new Set(quantity.map(value => Number(value)).filter(value => Number.isSafeInteger(value) && value > 0 && value <= 1000000))].sort((a,b)=>a-b);
    if (allowedQuantities.length) {
      minimumQuantity = allowedQuantities[0];
      maximumQuantity = allowedQuantities[allowedQuantities.length - 1];
    }
  } else if (quantity && typeof quantity === 'object') {
    minimumQuantity = Math.max(1, Math.min(1000000, Math.trunc(safeNumber(quantity.min, 1))));
    maximumQuantity = Math.max(minimumQuantity, Math.min(1000000, Math.trunc(safeNumber(quantity.max, minimumQuantity))));
  }
  const params = Array.isArray(raw.params) ? raw.params : [];
  const fields = params.slice(0, 12).map(normalizeParam);
  const productImage = String(raw.image || raw.image_url || raw.product_img || raw.product_image || raw.icon || '').trim();
  const categoryImage = String(raw.category_img || raw.category_image || '').trim();
  return {
    id,
    name,
    description: String(raw.description || raw.desc || raw.details || '').trim().slice(0, 700),
    image: productImage,
    categoryImage,
    categoryName: String(raw.category_name || 'خدمات رقمية متنوعة').trim().slice(0, 120) || 'خدمات رقمية متنوعة',
    parentId: Number.isSafeInteger(Number(raw.parent_id)) && Number(raw.parent_id) >= 0 ? Number(raw.parent_id) : 0,
    price: Number.isFinite(listedPrice) && listedPrice > 0 ? listedPrice : sourceCost,
    basePrice: Number.isFinite(basePrice) && basePrice > 0 ? basePrice : null,
    sourceCost,
    costBasis: Number.isFinite(basePrice) && basePrice > 0 ? 'base_price' : 'price',
    currency: ['USD','SYP'].includes(String(currency).toUpperCase()) ? String(currency).toUpperCase() : 'USD',
    productType: String(raw.product_type || 'package').slice(0, 40),
    available: ![false,0,'0','false','False','FALSE','no','NO'].includes(raw.available),
    minimumQuantity,
    maximumQuantity,
    allowedQuantities,
    fields,
  };
}

export function createBestStoreClient({ apiToken, fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const token = String(apiToken || '').trim();
  if (!token) throw apiError('أدخل API Token الخاص بـ Best Store من لوحة الإدارة.', 400, 'BEST_STORE_TOKEN_MISSING');
  if (token.length > 1024) throw apiError('مفتاح Best Store أطول من الحد المسموح.', 400, 'BEST_STORE_TOKEN_INVALID');
  if (typeof fetchImpl !== 'function') throw apiError('بيئة الخادم لا تدعم fetch.', 500, 'FETCH_UNAVAILABLE');

  async function request(path, { method = 'GET', query = null } = {}) {
    const url = new URL(path, BASE_URL);
    if (query) for (const [key,value] of Object.entries(query)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { 'api-token':token, 'Accept':'application/json' },
        redirect:'error',
        signal:controller.signal,
      });
      const length = Number(response.headers?.get?.('content-length') || 0);
      if (length > MAX_RESPONSE_BYTES) throw apiError('استجابة Best Store تجاوزت الحجم المسموح.', 502, 'BEST_STORE_RESPONSE_TOO_LARGE');
      const body = await response.text();
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw apiError('استجابة Best Store تجاوزت الحجم المسموح.', 502, 'BEST_STORE_RESPONSE_TOO_LARGE');
      let payload;
      try { payload = body ? JSON.parse(body) : {}; }
      catch { throw apiError('أعاد Best Store استجابة غير صالحة بصيغة JSON.', 502, 'BEST_STORE_INVALID_JSON'); }
      if (!response.ok) {
        const message = payload?.message || payload?.error || payload?.msg || 'فشل طلب Best Store.';
        throw apiError(message, response.status >= 500 ? 502 : response.status, payload?.code || 'BEST_STORE_HTTP_ERROR');
      }
      // The docs return status=OK for successful endpoints; order state is nested
      // inside data.status and uses accept/reject/wait. Treat any top-level status
      // other than OK/success as an API error to avoid silently importing zero products.
      if (payload?.status && !['OK','ok','success','SUCCESS'].includes(String(payload.status))) {
        throw apiError(payload.message || payload.error || 'رفض Best Store الطلب.', 422, String(payload.status).slice(0,80));
      }
      return payload;
    } catch (error) {
      if (error?.isBestStoreApiError) throw error;
      if (error?.name === 'AbortError') throw apiError('انتهت مهلة الاتصال بـ Best Store.', 504, 'BEST_STORE_TIMEOUT');
      throw apiError('تعذر الاتصال بخادم Best Store.', 502, 'BEST_STORE_NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async getProfile() {
      const payload = await request('/client/api/profile');
      return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    },
    async getProducts() {
      const payload = await request('/client/api/products');
      const candidates = [
        payload,
        payload?.data,
        payload?.products,
        payload?.items,
        payload?.data?.products,
        payload?.data?.items,
        payload?.data?.data,
        payload?.result?.products,
        payload?.result?.data,
      ];
      const rows = candidates.find(Array.isArray);
      if (!rows || !rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) {
        throw apiError('صيغة قائمة منتجات Best Store غير معروفة؛ لم نحفظ مزامنة فارغة حتى لا تختفي المنتجات الحالية.', 502, 'BEST_STORE_PRODUCTS_INVALID');
      }
      return rows;
    },
    async createOrder(productId, { quantity = 1, fields = {}, orderUuid } = {}) {
      const id = Number(productId), qty = Number(quantity);
      if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(qty) || qty <= 0 || qty > 1000000) {
        throw apiError('معرّف المنتج أو الكمية غير صالح.', 400, 'BEST_STORE_INVALID_ORDER');
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(orderUuid || ''))) {
        throw apiError('معرّف الطلب الداخلي غير صالح.', 400, 'BEST_STORE_ORDER_UUID_INVALID');
      }
      const query = { qty, order_uuid:orderUuid };
      for (const [key,value] of Object.entries(fields || {})) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key)) continue;
        query[key] = String(value).slice(0,500);
      }
      const payload = await request('/client/api/newOrder/' + encodeURIComponent(id) + '/params', { query });
      return payload?.data && typeof payload.data === 'object' ? payload.data : payload;
    },
    async checkOrder(orderUuid) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(orderUuid || ''))) return null;
      const payload = await request('/client/api/check', { query:{ orders:JSON.stringify([orderUuid]), uuid:1 } });
      const candidate=Array.isArray(payload?.data)?payload.data[0]:(Array.isArray(payload?.orders)?payload.orders[0]:(payload?.data&&typeof payload.data==='object'?payload.data:null));
      if(candidate&&typeof candidate==='object'&&(
        candidate.order_id||candidate.orderId||candidate.id||
        ['accept','accepted','reject','rejected','wait','pending','processing','completed','success','failed'].includes(String(candidate.status||candidate.order_status||'').toLowerCase())
      ))return candidate;
      return null;
    },
  });
}
