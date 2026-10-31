import crypto from 'node:crypto';

const API_BASES = Object.freeze({
  production: 'https://openapi.seagm.com',
  sandbox: 'https://openapi.seagm.io',
});
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CATEGORIES = 500;
const MAX_PRODUCTS = 5000;

export function seagmBaseUrl(environment = 'sandbox') {
  const base = API_BASES[environment];
  if (!base) throw new Error('INVALID_SEAGM_ENVIRONMENT');
  return base;
}

export function buildSeagmSignature(params, secretKey) {
  if (typeof secretKey !== 'string' || secretKey.length < 1 || secretKey.length > 512) throw new Error('INVALID_SEAGM_SECRET_KEY');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('INVALID_SEAGM_PARAMETERS');
  const keys = Object.keys(params).filter(key => params[key] !== undefined && params[key] !== null && key !== 'signature').sort();
  const totalParams = keys.map(key => encodeURIComponent(key) + '=' + encodeURIComponent(String(params[key]))).join('&');
  return crypto.createHmac('sha256', secretKey).update(totalParams, 'utf8').digest('hex');
}

function safeId(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('INVALID_SEAGM_' + label);
  return n;
}
function cleanText(value, max = 200) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function responseData(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('SEAGM_INVALID_RESPONSE');
  if (Number(payload.code) !== 200) {
    const code = Number(payload.error_info?.info_code || payload.code || 0);
    const message = cleanText(payload.error_info?.info_message || payload.msg || 'SEAGM API returned an error.', 240);
    const error = new Error(message);
    error.code = code || 'SEAGM_API_ERROR';
    throw error;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'data')) throw new Error('SEAGM_RESPONSE_DATA_MISSING');
  return payload.data;
}
async function readJsonLimited(response) {
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('SEAGM_RESPONSE_TOO_LARGE');
  const raw = await response.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('SEAGM_RESPONSE_TOO_LARGE');
  try { return JSON.parse(raw); } catch { throw new Error('SEAGM_INVALID_JSON_RESPONSE'); }
}
function arrayData(data, name) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['list', 'items', 'categories', 'types', 'products']) {
      if (Array.isArray(data[key])) return data[key];
    }
  }
  throw new Error('SEAGM_' + name + '_NOT_ARRAY');
}
function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields.slice(0, 50).map((field, index) => {
    const name = cleanText(field?.name, 80);
    if (!name) return null;
    const options = Array.isArray(field.options) ? field.options.slice(0, 100).map(option => ({
      label: cleanText(option?.label ?? option?.lable, 100),
      value: cleanText(option?.value, 120),
      child: Array.isArray(option?.child) ? option.child.slice(0, 10).map(child => ({
        name: cleanText(child?.name, 80),
        label: cleanText(child?.label, 100),
        prefix: cleanText(child?.prefix, 40),
        options: Array.isArray(child?.options) ? child.options.slice(0, 100).map(item => ({
          parent_value: cleanText(item?.parent_value, 120),
          child_options: Array.isArray(item?.child_options) ? item.child_options.slice(0, 100).map(sub => ({
            label: cleanText(sub?.label, 100), value: cleanText(sub?.value, 120),
          })) : [],
        })) : [],
      })) : [],
    })) : [];
    return {
      name,
      label: cleanText(field?.label || field?.title || name, 100),
      type: cleanText(field?.type || 'input', 30).toLowerCase(),
      placeholder: cleanText(field?.placeholder, 160),
      prefix: cleanText(field?.prefix, 40),
      multiline: field?.multiline === true,
      position: Number.isInteger(Number(field?.position)) ? Number(field.position) : index,
      options,
    };
  }).filter(Boolean);
}
function normalizeProduct(row, kind, category) {
  const id = safeId(row?.id ?? row?.type_id ?? row?.product_id, 'PRODUCT_ID');
  const unitPrice = Number(row?.unit_price ?? row?.unitPrice ?? 0);
  const originPrice = Number(row?.origin_price ?? row?.originPrice ?? unitPrice);
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || !Number.isFinite(originPrice) || originPrice < 0) throw new Error('SEAGM_INVALID_PRODUCT_PRICE');
  const currency = cleanText(row?.currency || row?.par_value_currency || '', 12).toUpperCase();
  return {
    id,
    kind,
    name: cleanText(row?.name || row?.product_name || row?.title || ('SEAGM product ' + id), 160),
    categoryId: category.id,
    categoryName: category.name,
    categoryCode: category.code,
    currency,
    unitPrice,
    originPrice,
    discountRate: Number.isFinite(Number(row?.discount_rate)) ? Number(row.discount_rate) : 0,
    parValue: Number.isFinite(Number(row?.par_value)) ? Number(row.par_value) : null,
    parValueCurrency: cleanText(row?.par_value_currency || '', 12).toUpperCase(),
    minAmount: Number.isInteger(Number(row?.min_amount)) && Number(row?.min_amount) > 0 ? Number(row.min_amount) : 1,
    maxAmount: Number.isInteger(Number(row?.max_amount)) && Number(row?.max_amount) > 0 ? Number(row.max_amount) : 1,
    inStock: row?.has_stock !== false && row?.in_stock !== false,
    autoDelivery: category.autoDelivery,
    fields: normalizeFields(row?.fields),
  };
}

export function createSeagmClient({ uid, secretKey, environment = 'sandbox', fetchImpl = globalThis.fetch, timeoutMs = 12000 } = {}) {
  const normalizedUid = String(uid ?? '').trim();
  if (!/^\d{1,20}$/.test(normalizedUid)) throw new Error('INVALID_SEAGM_UID');
  if (typeof secretKey !== 'string' || !secretKey.trim() || secretKey.length > 512) throw new Error('INVALID_SEAGM_SECRET_KEY');
  if (typeof fetchImpl !== 'function') throw new Error('SEAGM_FETCH_UNAVAILABLE');
  const base = seagmBaseUrl(environment);

  async function get(path, extra = {}) {
    if (typeof path !== 'string' || !/^\/v1\/[a-z0-9\-/:]+$/i.test(path)) throw new Error('INVALID_SEAGM_ENDPOINT');
    const params = { ...extra, timestamp: Math.floor(Date.now() / 1000), uid: normalizedUid };
    const signature = buildSeagmSignature(params, secretKey);
    const query = new URLSearchParams();
    for (const key of Object.keys(params).sort()) query.set(key, String(params[key]));
    query.set('signature', signature);
    const url = base + path + '?' + query.toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error('SEAGM HTTP ' + response.status);
        error.status = response.status;
        throw error;
      }
      return responseData(await readJsonLimited(response));
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('SEAGM_REQUEST_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function getAccount() {
    const data = await get('/v1/me');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('SEAGM_INVALID_ACCOUNT_RESPONSE');
    return {
      id: cleanText(data.id, 40),
      username: cleanText(data.username, 100),
      email: cleanText(data.email, 160),
      currency: cleanText(data.currency, 12).toUpperCase(),
      balance: cleanText(data.balance, 40),
    };
  }

  async function getCatalog() {
    const cardCategories = arrayData(await get('/v1/card-categories'), 'CARD_CATEGORIES');
    const rechargeCategories = arrayData(await get('/v1/recharge-categories'), 'RECHARGE_CATEGORIES');
    if (cardCategories.length + rechargeCategories.length > MAX_CATEGORIES) throw new Error('SEAGM_TOO_MANY_CATEGORIES');
    const categories = [];
    let productCount = 0;

    for (const raw of cardCategories) {
      const category = {
        id: safeId(raw?.id, 'CATEGORY_ID'),
        name: cleanText(raw?.name, 160),
        code: cleanText(raw?.code, 120),
        kind: 'card',
        autoDelivery: raw?.auto_delivery === true,
      };
      const rows = arrayData(await get('/v1/card-categories/' + category.id + '/card-types'), 'CARD_TYPES');
      const products = rows.map(row => normalizeProduct(row, 'card', category));
      productCount += products.length;
      if (productCount > MAX_PRODUCTS) throw new Error('SEAGM_TOO_MANY_PRODUCTS');
      categories.push({ ...category, products });
    }

    for (const raw of rechargeCategories) {
      const category = {
        id: safeId(raw?.id, 'CATEGORY_ID'),
        name: cleanText(raw?.name, 160),
        code: cleanText(raw?.code, 120),
        kind: 'recharge',
        autoDelivery: raw?.auto_delivery === true,
      };
      const rows = arrayData(await get('/v1/recharge-categories/' + category.id + '/recharge-types'), 'RECHARGE_TYPES');
      const products = rows.map(row => normalizeProduct(row, 'recharge', category));
      productCount += products.length;
      if (productCount > MAX_PRODUCTS) throw new Error('SEAGM_TOO_MANY_PRODUCTS');
      categories.push({ ...category, products });
    }

    return {
      categories,
      stats: {
        categories: categories.length,
        cardCategories: cardCategories.length,
        rechargeCategories: rechargeCategories.length,
        products: productCount,
      },
    };
  }

  return Object.freeze({ get, getAccount, getCatalog, base, uid: normalizedUid, environment });
}

export const SEAGM_API_ENDPOINTS = Object.freeze({
  account: '/v1/me',
  cardCategories: '/v1/card-categories',
  rechargeCategories: '/v1/recharge-categories',
});
