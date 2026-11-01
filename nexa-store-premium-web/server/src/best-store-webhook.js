import { timingSafeEqual } from 'node:crypto';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{1,120}$/;
export const BEST_STORE_WEBHOOK_MAX_BYTES = 32 * 1024;

export function verifyBestStoreWebhookSecret(supplied, expected) {
  const left = Buffer.from(String(supplied || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return right.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}


export function parseBestStoreWebhookBody(rawBody, contentType = '') {
  const body = String(rawBody ?? '');
  if (Buffer.byteLength(body, 'utf8') > BEST_STORE_WEBHOOK_MAX_BYTES) {
    throw Object.assign(new Error('BEST_STORE_WEBHOOK_BODY_TOO_LARGE'), { status:413 });
  }
  if (!body.trim()) return {};
  const type = String(contentType || '').toLowerCase();
  if (type.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);
    const result = {};
    for (const [key, value] of params) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        throw Object.assign(new Error('BEST_STORE_WEBHOOK_DUPLICATE_FIELD'), { status:400 });
      }
      result[key] = value;
    }
    return result;
  }
  if (type.includes('application/json') || !type || /^[\s]*[\[{]/.test(body)) {
    let payload;
    try { payload = JSON.parse(body); }
    catch { throw Object.assign(new Error('BEST_STORE_WEBHOOK_INVALID_JSON'), { status:400 }); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw Object.assign(new Error('BEST_STORE_WEBHOOK_INVALID_PAYLOAD'), { status:400 });
    }
    return payload;
  }
  throw Object.assign(new Error('BEST_STORE_WEBHOOK_UNSUPPORTED_CONTENT_TYPE'), { status:415 });
}

export function isBestStoreWebhookTest(payload = {}) {
  const event = String(payload?.event || payload?.type || '').trim().toLowerCase();
  return payload?.test === true || event === 'test' || event === 'callback.test';
}

export function resolveBestStoreWebhookReference(payload = {}, searchParams = null) {
  const query = searchParams instanceof URLSearchParams ? Object.fromEntries(searchParams.entries()) : (searchParams || {});
  const sources = [query, payload, payload?.data, payload?.order, payload?.data?.order]
    .filter(value => value && typeof value === 'object' && !Array.isArray(value));
  const valuesFor = keys => sources.flatMap(source => keys
    .map(key => source[key])
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(value => String(value).trim()));
  const uuidValues = valuesFor(['order_uuid', 'orderUuid', 'client_order_uuid', 'clientOrderUuid', 'uuid']);
  const uniqueUuids = [...new Set(uuidValues)];
  if (uniqueUuids.length > 1 || uniqueUuids.some(value => !UUID_V4.test(value))) {
    throw Object.assign(new Error('BEST_STORE_WEBHOOK_INVALID_ORDER_UUID'), { status:400 });
  }
  if (uniqueUuids.length === 1) return { kind:'uuid', value:uniqueUuids[0] };

  const merchantValues = valuesFor(['nexa_order_id', 'nexaOrderId', 'merchant_order_id', 'merchantOrderId', 'client_order_id', 'clientOrderId']);
  const uniqueMerchantValues = [...new Set(merchantValues)];
  if (uniqueMerchantValues.length > 1 || uniqueMerchantValues.some(value => !SAFE_PROVIDER_ID.test(value))) {
    throw Object.assign(new Error('BEST_STORE_WEBHOOK_INVALID_MERCHANT_ORDER_ID'), { status:400 });
  }
  if (uniqueMerchantValues.length === 1) return { kind:'merchant', value:uniqueMerchantValues[0] };

  const providerValues = valuesFor(['supplier_order_id', 'supplierOrderId', 'provider_order_id', 'providerOrderId', 'order_id', 'orderId']);
  const uniqueProviderValues = [...new Set(providerValues)];
  if (uniqueProviderValues.length > 1 || uniqueProviderValues.some(value => !SAFE_PROVIDER_ID.test(value))) {
    throw Object.assign(new Error('BEST_STORE_WEBHOOK_INVALID_PROVIDER_ORDER_ID'), { status:400 });
  }
  if (uniqueProviderValues.length === 1) return { kind:'provider', value:uniqueProviderValues[0] };
  return null;
}
