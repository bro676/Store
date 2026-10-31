import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { httpStatusForResult, isHttpErrorResult, safeHttpStatus } from './http-status.js';
import { convertSypMinorToUsdMinor } from './exchange-rate.js';
import {
  createAdminSession, verifyAdminSession, encryptSecret, decryptSecret,
  validateCatalog, mergeCatalog, upsertCatalogProduct, isSafeCatalogImage, getJsonPath, normalizeFxRate, validateCatalogApiUrl,
} from './admin-core.js';
import { createSeagmClient } from './seagm-api.js';
import { createWamdaClient } from './wamda-api.js';
import { wamdaOrderDecision, classifyWamdaError } from './wamda-fulfillment.js';
import { normalizeWamdaMargin, normalizeWamdaPricingRule, resolveWamdaPricingRule, calculateWamdaSellPriceSyp, updateWamdaPublishedProduct, markWamdaProductUnavailable } from './wamda-pricing.js';
import { parseSeagmCallbackBody, mergeSeagmCallbackParams, verifySeagmCallbackSignature } from './seagm-webhook.js';
import { seagmOrderMetadata, evaluateSeagmOrder, classifySeagmFulfillmentError } from './seagm-fulfillment.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
let catalog = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'catalog.json'), 'utf8'));
let storeSettings = null;
let fxApiTokenRuntime = '';
let catalogApiTokenRuntime = '';
let catalogWriteApiTokenRuntime = '';
let catalogApiSyncInProgress = false;
let seagmSecretRuntime = '';
let wamdaApiTokenRuntime = '';
let wamdaWebhookSecretRuntime = '';
let nexaAiApiKeyRuntime = '';
let wamdaCatalogSyncInProgress = false;
let wamdaBulkPublishInProgress = false;
let seagmCatalogSyncInProgress = false;
let seagmFulfillmentWorkerBusy = false;
const { Pool } = pg;
const cfg = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: String(process.env.DATABASE_SSL || 'true').toLowerCase() === 'true',
  paymentsEnabled: String(process.env.PAYMENTS_ENABLED || 'false').toLowerCase() === 'true',
  maxAgeMs: Number(process.env.PAYMENT_MAX_AGE_MINUTES || 15) * 60_000,
  futureSkewMs: Number(process.env.PAYMENT_FUTURE_SKEW_SECONDS || 90) * 1000,
  orderTtlMinutes: Number(process.env.PAYMENT_ORDER_TTL_MINUTES || 15),
  currency: (process.env.PAYMENT_CURRENCY || 'SYP').toUpperCase(),
  apiBase: (process.env.SHAM_API_BASE_URL || 'https://apis-shamcash.com/api').replace(/\/$/, ''),
  apiToken: process.env.SHAM_API_TOKEN || '',
  adminApiKey: process.env.ADMIN_API_KEY || '',
  settingsEncryptionKey: process.env.STORE_SETTINGS_ENCRYPTION_KEY || process.env.ADMIN_API_KEY || '',
  walletId: process.env.SHAM_WALLET_ID || '',
  receiverLabel: process.env.SHAM_RECEIVER_LABEL || 'محفظة Nexa Store',
  receiverAddress: process.env.SHAM_RECEIVER_ADDRESS || '',
  timezoneOffsetMinutes: Number(process.env.SHAM_TIMEZONE_OFFSET_MINUTES || 180),
};

const providerConfigReady = Boolean(cfg.apiToken && Buffer.byteLength(cfg.apiToken) <= 256 && cfg.walletId &&
  Number.isInteger(cfg.orderTtlMinutes) && cfg.orderTtlMinutes >= 5 && cfg.orderTtlMinutes <= 1440 &&
  cfg.maxAgeMs > 0 && cfg.futureSkewMs >= 0 && Number.isInteger(cfg.timezoneOffsetMinutes) &&
  Math.abs(cfg.timezoneOffsetMinutes) <= 840);
let paymentsReady = false;
function refreshPaymentsReady() {
  paymentsReady = Boolean(cfg.paymentsEnabled && cfg.databaseUrl && cfg.apiToken && Buffer.byteLength(cfg.apiToken) <= 256 && cfg.walletId &&
    Number.isInteger(cfg.orderTtlMinutes) && cfg.orderTtlMinutes >= 5 && cfg.orderTtlMinutes <= 1440 &&
    cfg.maxAgeMs > 0 && cfg.futureSkewMs >= 0 && Number.isInteger(cfg.timezoneOffsetMinutes) && Math.abs(cfg.timezoneOffsetMinutes) <= 840);
  return paymentsReady;
}
let pool;
if (cfg.databaseUrl) {
  pool = new Pool({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
  for (const migration of ['001_init.sql', '002_shamcash_invoices.sql', '003_store_admin.sql', '004_seagm_fulfillment.sql', '005_seagm_fulfillment_reliability.sql', '006_customer_wallet.sql']) {
    await pool.query(await fs.readFile(path.join(__dirname, '..', 'migrations', migration), 'utf8'));
  }
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const rate = new Map();
let cachedShamWallet = null;
let cachedShamWalletAt = 0;
const MAX_BODY = 16 * 1024;

class ProviderError extends Error {
  constructor(status, payload) { super(payload?.message || payload?.error || 'SHAM_PROVIDER_ERROR'); this.name = 'ProviderError'; this.status = status; this.code = payload?.error || payload?.code || 'PROVIDER_ERROR'; }
}
function send(res, status, data, extraHeaders = {}) {
  const safeStatus = safeHttpStatus(status);
  const body = JSON.stringify(data);
  res.writeHead(safeStatus, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self' data: blob: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    ...extraHeaders,
  });
  res.end(body);
}

function sendText(res, status, value) {
  const body = String(value);
  res.writeHead(safeHttpStatus(status), {
    'Content-Type':'text/plain; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
  });
  res.end(body);
}
async function bodyText(req, maxBytes = 32 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw Object.assign(new Error('BODY_TOO_LARGE'), { status:413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rateLimit(req, res, key, max = 12, windowMs = 60_000) {
  const now = Date.now(); const old = rate.get(key);
  if (!old || now >= old.until) { rate.set(key, { count: 1, until: now + windowMs }); return false; }
  old.count += 1;
  if (old.count > max) {
    const retry = Math.max(1, Math.ceil((old.until - now) / 1000));
    send(res, 429, { error:'RATE_LIMIT', message:'تجاوزت عدد المحاولات المسموح. حاول لاحقاً.' }, { 'Retry-After': String(retry) });
    return true;
  }
  return false;
}
async function bodyJson(req, maxBytes = MAX_BODY) {
  let data = ''; for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > maxBytes) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }); }
  try { return data ? JSON.parse(data) : {}; } catch { throw Object.assign(new Error('INVALID_JSON'), { status: 400 }); }
}
async function reserveProviderQuota(key, { maxRequests, windowMs, minIntervalMs = 0 }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO nexa_api_throttles (throttle_key,window_started_at,request_count,next_allowed_at)
      VALUES ($1,NOW(),0,NOW()) ON CONFLICT (throttle_key) DO NOTHING`, [key]);
    const result = await client.query('SELECT window_started_at,request_count,next_allowed_at FROM nexa_api_throttles WHERE throttle_key=$1 FOR UPDATE', [key]);
    const row = result.rows[0]; const now = Date.now();
    const windowStart = new Date(row.window_started_at).getTime();
    const nextAllowed = new Date(row.next_allowed_at).getTime();
    let count = Number(row.request_count);
    let start = windowStart;
    if (now - windowStart >= windowMs) { count = 0; start = now; }
    const retryAfter = Math.max(0, nextAllowed - now, count >= maxRequests ? start + windowMs - now : 0);
    if (retryAfter > 0) {
      await client.query('UPDATE nexa_api_throttles SET window_started_at=$2,request_count=$3 WHERE throttle_key=$1', [key, new Date(start), count]);
      await client.query('COMMIT');
      return { allowed:false, retryAfter:Math.max(1,Math.ceil(retryAfter/1000)) };
    }
    await client.query(`UPDATE nexa_api_throttles SET window_started_at=$2,request_count=$3,next_allowed_at=$4 WHERE throttle_key=$1`,
      [key, new Date(start), count + 1, new Date(now + minIntervalMs)]);
    await client.query('COMMIT');
    return { allowed:true };
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
}
function decimalMinor(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const [whole, fraction = ''] = s.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}
function asAmount(minor) { return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`; }
function findPack(categoryId, productId, optionId, packIndex) {
  const category = catalog.find(c => c.id === categoryId);
  const product = category?.items.find(p => p.id === productId);
  const option = product?.options.find(o => o.id === optionId);
  const pack = Number.isInteger(packIndex) ? option?.packs[packIndex] : null;
  if (!category || !product || !option || !pack || !Number.isFinite(pack[1]) || pack[1] <= 0) return null;
  const amountMinor = decimalMinor(pack[1]);
  if (amountMinor === null || amountMinor <= 0n) return null;
  return { label: `${product.name} — ${option.name} — ${pack[0]}`, amountMinor };
}
function pricePack(pack, currency) {
  if (currency === 'SYP') return { ...pack, currency, amountMinor:pack.amountMinor };
  if (currency !== 'USD' || !fxRateReady()) return null;
  const amountMinor = convertSypMinorToUsdMinor(pack.amountMinor, Number(storeSettings?.fxRate || 145));
  if (amountMinor < 1n) return null;
  return { ...pack, currency, amountMinor };
}

function publicCatalog() {
  return catalog.map(category => ({
    ...category,
    items: category.items.map(product => {
      const { seagm, wamda, manualOverrides, apiSource, ...publicProduct } = product;
      if (seagm?.provider === 'seagm') {
        return {
          ...publicProduct,
          seagm: {
            provider:'seagm',kind:seagm.kind === 'recharge' ? 'recharge' : 'card',
            minimumQuantity:Number(seagm.minimumQuantity || 1),maximumQuantity:Number(seagm.maximumQuantity || 1),
            fields:Array.isArray(seagm.fields) ? seagm.fields.map(field=>({
              name:String(field.name || ''),submitField:String(field.submitField || field.name || ''),label:String(field.label || field.name || ''),
              type:String(field.type || 'input'),placeholder:String(field.placeholder || ''),prefix:String(field.prefix || ''),
              tips:String(field.tips || ''),required:field.required !== false,multiline:field.multiline === true,
              options:Array.isArray(field.options) ? field.options.map(option=>({
                label:String(option.label || ''),value:String(option.value || ''),
                child:Array.isArray(option.child) ? option.child.map(child=>({
                  name:String(child.name || ''),label:String(child.label || child.name || ''),prefix:String(child.prefix || ''),
                  options:Array.isArray(child.options) ? child.options.filter(dependency=>String(dependency.parent_value ?? '')===String(option.value ?? '')).flatMap(dependency=>Array.isArray(dependency.child_options)?dependency.child_options:[]).map(childOption=>({label:String(childOption.label || ''),value:String(childOption.value || '')})) : [],
                })) : [],
              })) : [],
            })) : [],
          },
        };
      }
      if (wamda?.provider === 'wamda') {
        return {...publicProduct,wamda:{
          provider:'wamda',minimumQuantity:Number(wamda.minimumQuantity || 1),maximumQuantity:Number(wamda.maximumQuantity || 1),available:wamda.available!==false,
          fields:Array.isArray(wamda.fields)?wamda.fields.map(field=>({
            name:String(field.key || ''),submitField:String(field.key || ''),label:String(field.label || field.key || ''),
            type:String(field.type || 'text'),required:field.required !== false,
            min:field.min!==null&&field.min!==undefined&&field.min!==''&&Number.isFinite(Number(field.min))?Number(field.min):null,max:field.max!==null&&field.max!==undefined&&field.max!==''&&Number.isFinite(Number(field.max))?Number(field.max):null,
          })):[],
        }};
      }
      return publicProduct;
    }),
  }));
}
function validateWamdaCustomerFields(product, rawFields) {
  if(!rawFields||typeof rawFields!=='object'||Array.isArray(rawFields))throw Object.assign(new Error('بيانات الحقول المطلوبة للمنتج غير صالحة.'),{status:400});
  const definitions=Array.isArray(product.wamda?.fields)?product.wamda.fields:[];
  const output={},allowed=new Set(),reserved=new Set(['quantity','qty','order_uuid','api_token']);
  for(const field of definitions){
    const key=String(field?.key||'').trim();
    if(!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key)||reserved.has(key.toLowerCase()))throw Object.assign(new Error('إعدادات حقول منتج ومضة غير صالحة.'),{status:409});
    allowed.add(key);
    const value=String(rawFields[key]??'').trim();
    if(!value&&field.required!==false)throw Object.assign(new Error('يرجى تعبئة الحقل: '+String(field.label||key)),{status:400});
    if(!value)continue;
    if(value.length>500||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value))throw Object.assign(new Error('إحدى بيانات المنتج أطول من المسموح أو تحتوي محارف غير صالحة.'),{status:400});
    if(String(field.type||'text')==='number'){
      const number=Number(value);
      if(!Number.isFinite(number)||(field.min!==null&&field.min!==undefined&&field.min!==''&&Number.isFinite(Number(field.min))&&number<Number(field.min))||(field.max!==null&&field.max!==undefined&&field.max!==''&&Number.isFinite(Number(field.max))&&number>Number(field.max)))throw Object.assign(new Error('القيمة الرقمية للحقل '+String(field.label||key)+' خارج الحدود المسموحة.'),{status:400});
    }
    if(String(field.type||'')==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw Object.assign(new Error('البريد الإلكتروني في الحقل '+String(field.label||key)+' غير صالح.'),{status:400});
    if(String(field.type||'')==='url'){
      try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol))throw new Error();}
      catch{throw Object.assign(new Error('الرابط في الحقل '+String(field.label||key)+' غير صالح.'),{status:400});}
    }
    output[key]=value;
  }
  for(const key of Object.keys(rawFields))if(!allowed.has(key))throw Object.assign(new Error('تم إرسال حقل غير معروف لمنتج ومضة.'),{status:400});
  return output;
}

function validateSeagmCustomerFields(product, rawFields) {
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) {
    throw Object.assign(new Error('بيانات الحقول المطلوبة للمنتج غير صالحة.'), { status:400 });
  }
  const definitions = Array.isArray(product.seagm?.fields) ? product.seagm.fields : [];
  const allowedKeys = new Set();
  const output = {};
  const reserved = new Set(['uid','timestamp','signature','type_id','buy_amount','mch_order_id']);
  for (const field of definitions) {
    const name = String(field?.name || '').trim();
    const submitField = String(field?.submitField || name).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(submitField) || reserved.has(submitField)) {
      throw Object.assign(new Error('إعدادات حقول المورد غير صالحة؛ راجع المنتج من الداشبورد.'), { status:409 });
    }
    allowedKeys.add(submitField);
    const provided = Object.prototype.hasOwnProperty.call(rawFields, submitField)
      ? rawFields[submitField] : rawFields[name];
    const value = String(provided ?? '').trim();
    if (!value && field.required !== false) {
      throw Object.assign(new Error('يرجى تعبئة الحقل: ' + String(field.label || name || submitField)), { status:400 });
    }
    if (!value) continue;
    if (value.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
      throw Object.assign(new Error('إحدى بيانات المنتج أطول من المسموح أو تحتوي محارف غير صالحة.'), { status:400 });
    }
    const choices = Array.isArray(field.options) ? field.options : [];
    if (choices.length && !choices.some(option => String(option?.value ?? '') === value)) {
      throw Object.assign(new Error('القيمة المختارة للحقل ' + String(field.label || name) + ' غير موجودة ضمن الخيارات.'), { status:400 });
    }
    output[submitField] = value;
    if (value) {
      const selectedOption = choices.find(option => String(option?.value ?? '') === value);
      for (const child of Array.isArray(selectedOption?.child) ? selectedOption.child : []) {
        const childName = String(child?.name || '').trim();
        if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(childName) || reserved.has(childName)) {
          throw Object.assign(new Error('إعدادات الحقول التابعة للمنتج غير صالحة.'), { status:409 });
        }
        allowedKeys.add(childName);
        const childValue = String(rawFields[childName] ?? '').trim();
        if (!childValue) throw Object.assign(new Error('يرجى تعبئة الحقل: ' + String(child.label || childName)), { status:400 });
        if (childValue.length > 500 || /[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/.test(childValue)) {
          throw Object.assign(new Error('إحدى بيانات المنتج أطول من المسموح أو تحتوي محارف غير صالحة.'), { status:400 });
        }
        const childChoices = Array.isArray(child.options)
          ? child.options.filter(dependency => String(dependency?.parent_value ?? '') === value)
            .flatMap(dependency => Array.isArray(dependency.child_options) ? dependency.child_options : [])
          : [];
        if (childChoices.length && !childChoices.some(option => String(option?.value ?? '') === childValue)) {
          throw Object.assign(new Error('القيمة المختارة للحقل ' + String(child.label || childName) + ' غير موجودة ضمن الخيارات.'), { status:400 });
        }
        output[childName] = childValue;
      }
    }
  }
  for (const key of Object.keys(rawFields)) {
    if (!allowedKeys.has(key)) throw Object.assign(new Error('تم إرسال حقل غير معروف للمنتج.'), { status:400 });
  }
  return output;
}

function parseProviderDate(value) {
  if (typeof value !== 'string' || !value.trim()) return new Date(NaN);
  const s = value.trim();
  // Sham Cash transaction examples use "YYYY-MM-DD HH:mm:ss" without an offset.
  // Interpret these using the explicitly configurable provider/local offset.
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (m) {
    const [, y, mo, d, h, mi, sec, ms = '0'] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec, Number((ms + '00').slice(0, 3))) - cfg.timezoneOffsetMinutes * 60_000);
  }
  return new Date(s);
}
async function shamApi(method, route, body) {
  if (!cfg.apiToken) throw new ProviderError(503, { error:'API_TOKEN_MISSING', message:'مفتاح API غير مضبوط على الخادم.' });
  const url = new URL(route.replace(/^\//, ''), cfg.apiBase + '/');
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      method,
      headers: { Authorization:`Bearer ${cfg.apiToken}`, Accept:'application/json', ...(body ? {'Content-Type':'application/json'} : {}) },
      ...(body ? { body:JSON.stringify(body) } : {}), signal:controller.signal, redirect:'error',
    });
    let payload = {};
    try { payload = await response.json(); } catch { throw new ProviderError(response.status, { error:'INVALID_PROVIDER_RESPONSE', message:'أعاد مزوّد شام كاش استجابة غير مفهومة.' }); }
    if (!response.ok) throw new ProviderError(response.status, payload);
    if (payload?.success === false || payload?.ok === false) throw new ProviderError(response.status, payload);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new ProviderError(504, { error:'PROVIDER_TIMEOUT', message:'انتهت مهلة الاتصال بمزوّد شام كاش.' });
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(502, { error:'PROVIDER_UNAVAILABLE', message:'تعذر الاتصال بمزوّد شام كاش.' });
  } finally { clearTimeout(timeout); }
}
async function getWallet(forceRefresh = false) {
  if (!forceRefresh && cachedShamWallet && Date.now() - cachedShamWalletAt < 20_000) return cachedShamWallet;
  const payload = await shamApi('GET', '/v1/wallets');
  const wallets = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : null;
  if (!wallets) throw new ProviderError(502, { error:'INVALID_WALLETS_RESPONSE', message:'صيغة قائمة المحافظ غير مطابقة للتوثيق.' });
  const wallet = wallets.find(w => String(w.id) === cfg.walletId || String(w.walletAddress || '') === cfg.walletId || String(w.accountNumber || '') === cfg.walletId);
  if (!wallet || String(wallet.provider).toLowerCase() !== 'shamcash' || String(wallet.status).toLowerCase() !== 'active') {
    throw new ProviderError(409, { error:'SHAM_WALLET_NOT_ACTIVE', message:'محفظة شام كاش المحددة غير موجودة أو غير نشطة. تحقق من SHAM_WALLET_ID وربط المحفظة.' });
  }
  if (!wallet.walletAddress) throw new ProviderError(502, { error:'SHAM_WALLET_ADDRESS_MISSING', message:'المحفظة لا تحتوي على walletAddress في استجابة المزوّد.' });
  cachedShamWallet = wallet; cachedShamWalletAt = Date.now();
  return wallet;
}
async function createShamInvoice(orderId, pack, wallet) {
  const payload = await shamApi('POST', '/v1/invoices', {
    amount: asAmount(pack.amountMinor), currency:pack.currency, walletAddress:String(wallet.id), provider:'shamcash',
    expiresInMinutes:cfg.orderTtlMinutes, note:`Nexa Store ${orderId}: ${pack.label}`,
    metadata:{ orderId, source:'nexa-store' },
  });
  const invoiceNumber = String(payload.invoiceNumber || '');
  const identifier = String(payload.identifier || '');
  const expiry = new Date(payload.expiresAt || '');
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(invoiceNumber) || payload.status !== 'pending' || String(payload.method).toLowerCase() !== 'shamcash' ||
      String(payload.currency).toUpperCase() !== pack.currency || decimalMinor(payload.amount) !== pack.amountMinor ||
      !identifier || !Number.isFinite(expiry.getTime())) {
    throw new ProviderError(502, { error:'INVALID_INVOICE_RESPONSE', message:'لم تتطابق الفاتورة التي أنشأها المزوّد مع الطلب؛ أوقفنا إكماله للحماية.' });
  }
  const receiverIdentifiers = [wallet.walletAddress, wallet.id, wallet.accountNumber].filter(Boolean).map(String);
  if (!receiverIdentifiers.includes(identifier)) {
    throw new ProviderError(502, { error:'INVOICE_RECEIVER_MISMATCH', message:'معرّف الاستلام في الفاتورة لا يطابق محفظة المتجر المحددة.' });
  }
  const remaining = expiry.getTime() - Date.now();
  if (remaining < 60_000 || remaining > (cfg.orderTtlMinutes + 5) * 60_000) {
    throw new ProviderError(502, { error:'INVALID_INVOICE_EXPIRY', message:'مدة صلاحية الفاتورة التي أعادها المزوّد غير متوقعة.' });
  }
  return { invoiceNumber, identifier, expiresAt:expiry, walletLabel:String(wallet.label || cfg.receiverLabel), walletAddress:String(wallet.walletAddress) };
}
function providerMessage(error) {
  const code = error?.code || '';
  const map = {
    TRANSACTION_NOT_FOUND:'لم يعثر شام كاش على رقم العملية. تأكد من الرقم أو انتظر ظهور التحويل في السجل.',
    TRAN_ID_USED:'رقم العملية مستخدم مسبقاً لفاتورة أخرى ولا يمكن استخدامه مرة ثانية.',
    ALREADY_PAID:'هذه الفاتورة مدفوعة مسبقاً.',
    EXPIRED:'انتهت صلاحية فاتورة الدفع. أنشئ طلباً جديداً.',
    AMOUNT_MISMATCH:'المبلغ المحوّل لا يطابق مبلغ الطلب.',
    WALLET_NOT_FOUND:'لم يتمكن المزوّد من العثور على محفظة الاستلام.',
    WALLET_INACTIVE:'محفظة الاستلام غير نشطة.',
    INVALID_API_KEY:'مفتاح API غير صالح.',
    MISSING_API_KEY:'مفتاح API غير مضبوط.',
    SUBSCRIPTION_EXPIRED:'اشتراك واجهة شام كاش منتهٍ.',
    FORBIDDEN:'صلاحيات مفتاح API لا تسمح بهذه العملية. تحقق من الصلاحيات المطلوبة في الإعدادات.',
    RATE_LIMIT:'تم بلوغ حد الاستخدام لدى مزوّد شام كاش. انتظر ثم أعد المحاولة.',
  };
  if (map[code]) return map[code];
  if (error?.status === 401 || error?.status === 403) return 'رفض مزوّد شام كاش الطلب. تحقق من المفتاح والصلاحيات والاشتراك.';
  if (error?.status === 429) return 'حد الاستخدام لدى مزوّد شام كاش ممتلئ مؤقتاً. انتظر قبل المحاولة.';
  if (error?.status >= 500) return 'مزوّد شام كاش غير متاح حالياً. لم يتم تأكيد الدفع.';
  return 'تعذر التحقق من العملية عبر شام كاش. لم يتم تأكيد الدفع.';
}
async function createOrder(input, customer = null) {
  const paymentMethod=String(input.paymentMethod || 'shamcash').trim().toLowerCase();
  if (!['shamcash','wallet'].includes(paymentMethod)) return {error:'INVALID_PAYMENT_METHOD',status:400,message:'طريقة الدفع المختارة غير مدعومة.'};
  if (!pool) return {error:'DATABASE_NOT_CONFIGURED',status:503,message:'قاعدة بيانات المتجر غير جاهزة.'};
  if (paymentMethod==='wallet' && !customer) return {error:'CUSTOMER_LOGIN_REQUIRED',status:401,message:'سجّل الدخول إلى حسابك لاستخدام الرصيد.'};
  if (paymentMethod==='shamcash' && !paymentsReady) return { error:'PAYMENTS_NOT_READY', status:503, message:'الدفع المباشر غير متاح حتى تكتمل إعدادات API وقاعدة البيانات على الخادم.' };
  const pack = findPack(input.categoryId, input.productId, input.optionId, Number(input.packIndex));
  if (!pack) return { error:'INVALID_PRODUCT', status:400, message:'الباقة غير متاحة أو سعرها غير محدد.' };
  const sourceCategory = catalog.find(category => category.id === input.categoryId);
  const sourceProduct = sourceCategory?.items?.find(product => product.id === input.productId);
  const supplier = sourceProduct?.wamda?.provider === 'wamda' ? sourceProduct.wamda : (sourceProduct?.seagm?.provider === 'seagm' ? sourceProduct.seagm : null);
  const supplierProvider=supplier?.provider||'';
  let quantity=1,supplierFields={};
  if(supplierProvider==='wamda'){
    if(!Number.isSafeInteger(Number(supplier.productId))||Number(supplier.productId)<=0||!Number.isSafeInteger(Number(supplier.categoryId))||Number(supplier.categoryId)<0) return {error:'INVALID_WAMDA_PRODUCT',status:409,message:'بيانات ربط المنتج مع ومضة غير مكتملة. أعد مزامنته ونشره من لوحة الإدارة.'};
    if(supplier.available===false) return {error:'WAMDA_PRODUCT_UNAVAILABLE',status:409,message:'هذا المنتج غير متوفر حالياً لدى ومضة. حدّث الكتالوج واختر منتجاً متاحاً.'};
    if(!wamdaApiTokenRuntime) return {error:'WAMDA_NOT_CONFIGURED',status:503,message:'أدخل API Token الخاص بومضة من لوحة الإدارة ثم اختبر الاتصال.'};
    const min=Math.max(1,Number(supplier.minimumQuantity||1)),max=Math.min(1000,Math.max(min,Number(supplier.maximumQuantity||1)));
    quantity=Number(input.quantity??1);
    if(!Number.isSafeInteger(quantity)||quantity<min||quantity>max) return {error:'INVALID_QUANTITY',status:400,message:`الكمية يجب أن تكون بين ${min} و${max}.`};
    try{supplierFields=validateWamdaCustomerFields(sourceProduct,input.supplierFields||{});}
    catch(error){return {error:'INVALID_SUPPLIER_FIELDS',status:error.status||400,message:error.message};}
  } else if(supplierProvider==='seagm'){
    if(!['card','recharge'].includes(supplier.kind)||!Number.isSafeInteger(Number(supplier.typeId))||Number(supplier.typeId)<=0||!Number.isSafeInteger(Number(supplier.categoryId))||Number(supplier.categoryId)<=0) return {error:'INVALID_SEAGM_PRODUCT',status:409,message:'بيانات ربط المنتج مع SEAGM غير مكتملة. أعد مزامنته ونشره من لوحة الإدارة.'};
    if(!storeSettings?.seagmUid||!seagmSecretRuntime) return {error:'SEAGM_NOT_CONFIGURED',status:503,message:'منتج المورد غير متاح حالياً حتى يتم ضبط UID وSecret Key من لوحة الإدارة.'};
    const min=Math.max(1,Number(supplier.minimumQuantity||1)),max=Math.min(1000,Math.max(min,Number(supplier.maximumQuantity||1)));
    quantity=Number(input.quantity??1);
    if(!Number.isSafeInteger(quantity)||quantity<min||quantity>max) return {error:'INVALID_QUANTITY',status:400,message:`الكمية يجب أن تكون بين ${min} و${max}.`};
    try{supplierFields=validateSeagmCustomerFields(sourceProduct,input.supplierFields||{});}
    catch(error){return {error:'INVALID_SUPPLIER_FIELDS',status:error.status||400,message:error.message};}
  }
  const currency = String(input.currency || 'SYP').trim().toUpperCase();
  if (!['SYP','USD'].includes(currency)) return { error:'INVALID_CURRENCY', status:400, message:'اختر الليرة السورية أو الدولار الأمريكي.' };
  const totalPack = { ...pack, label:supplier ? `${pack.label} × ${quantity}` : pack.label, amountMinor:pack.amountMinor * BigInt(quantity) };
  const pricedPack = pricePack(totalPack, currency);
  if (!pricedPack) return { error:'INVALID_PRICE', status:400, message:'تعذر حساب السعر بالعملة المختارة.' };
  const name = String(input.customerName || customer?.full_name || '').trim().slice(0,70);
  const phone = String(input.customerPhone || customer?.phone || '').trim().slice(0,25);
  const gameAccount = String(input.accountId || '').trim().slice(0,80);
  const notes = String(input.notes || '').trim().slice(0,500);
  if (name.length < 2 || !/^\+?[0-9\s()-]{7,20}$/.test(phone)) return {error:'INVALID_CUSTOMER',status:400,message:'يرجى إدخال الاسم ورقم هاتف صحيح.'};
  if(paymentMethod==='wallet'){
    if(currency!=='SYP')return {error:'WALLET_CURRENCY_UNSUPPORTED',status:400,message:'الرصيد الداخلي حالياً بالليرة السورية الجديدة فقط. اختر SYP للدفع من الرصيد.'};
    const client=await pool.connect();
    const id=\`NX-\${crypto.randomBytes(10).toString('hex').toUpperCase()}\`;
    const supplierOrderUuid=supplierProvider==='wamda'?crypto.randomUUID():id;
    try{
      await client.query('BEGIN');
      const locked=await client.query('SELECT balance_minor::text FROM nexa_customers WHERE id=$1 FOR UPDATE',[customer.id]);
      if(!locked.rowCount){await client.query('ROLLBACK');return {error:'CUSTOMER_NOT_FOUND',status:401,message:'انتهت جلسة حسابك. سجّل الدخول مجدداً.'};}
      const balance=BigInt(locked.rows[0].balance_minor);
      if(balance<pricedPack.amountMinor){await client.query('ROLLBACK');return {error:'WALLET_INSUFFICIENT_FUNDS',status:409,message:'رصيدك غير كافٍ لإتمام هذا الطلب. اشحن رصيدك أو اختر الدفع المباشر.',balanceMinor:balance.toString(),requiredMinor:pricedPack.amountMinor.toString()};}
      const debited=await client.query('UPDATE nexa_customers SET balance_minor=balance_minor-$2 WHERE id=$1 RETURNING balance_minor::text',[customer.id,pricedPack.amountMinor.toString()]);
      const nextBalance=String(debited.rows[0].balance_minor);
      const supplierStatus=supplier?'pending':'not_applicable';
      const supplierMessage=supplierProvider==='wamda'?'تم الدفع من رصيد الحساب. سيتم إرسال الطلب إلى ومضة.':(supplierProvider==='seagm'?'تم الدفع من رصيد الحساب. سيتم إرسال الطلب إلى SEAGM.':'');
      await client.query(\`INSERT INTO nexa_orders (
        id,category_id,product_id,option_id,pack_index,product_label,amount_minor,currency,
        customer_name,customer_phone,game_account,notes,status,expires_at,paid_at,
        supplier_provider,supplier_kind,supplier_category_id,supplier_type_id,supplier_quantity,
        supplier_fields,supplier_mch_order_id,supplier_status,supplier_message,customer_id,payment_method
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,'SYP',$8,$9,$10,$11,'paid',NOW()+INTERVAL '365 days',NOW(),
        $12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,'wallet'
      )\`,[
        id,input.categoryId,input.productId,input.optionId,Number(input.packIndex),pricedPack.label,pricedPack.amountMinor.toString(),
        name,phone,gameAccount,notes,supplierProvider,supplier?.kind||'',supplier?Number(supplier.categoryId):null,
        supplier?Number(supplier.typeId||supplier.productId):null,quantity,JSON.stringify(supplierFields),
        supplier?supplierOrderUuid:null,supplierStatus,supplierMessage,customer.id
      ]);
      await client.query(\`INSERT INTO nexa_wallet_ledger(customer_id,kind,amount_minor,balance_after_minor,reference_order_id,note)
        VALUES($1,'purchase',$2,$3,$4,$5)\`,[customer.id,pricedPack.amountMinor.toString(),nextBalance,id,pricedPack.label]);
      if(['seagm','wamda'].includes(supplierProvider)){
        await client.query(\`INSERT INTO nexa_fulfillment_jobs(order_id,status,next_attempt_at)
          VALUES($1,'pending',NOW()) ON CONFLICT(order_id) DO NOTHING\`,[id]);
      }
      await client.query('COMMIT');
      if(['seagm','wamda'].includes(supplierProvider))runSeagmFulfillmentWorker().catch(error=>console.error('wallet purchase fulfillment failed',String(error?.message||'unknown').slice(0,120)));
      return {
        orderId:id,product:pricedPack.label,amountMinor:pricedPack.amountMinor.toString(),currency:'SYP',
        status:'paid',paymentMethod:'wallet',walletBalanceMinor:nextBalance,
        deliveryProvider:supplierProvider==='wamda'?'WAMDA':(supplier?'SEAGM':null),
        deliveryStatus:supplier?'pending':null,
        receipt:{orderId:id,product:pricedPack.label,amountMinor:pricedPack.amountMinor.toString(),currency:'SYP',customerName:name,paymentMethod:'wallet',paidAt:new Date().toISOString(),...(supplier?{delivery:{provider:supplierProvider==='wamda'?'WAMDA':'SEAGM',status:'pending',message:supplierMessage}}:{})}
      };
    }catch(error){
      await client.query('ROLLBACK').catch(()=>{});
      if(error.code==='23505')return {error:'WALLET_ORDER_CONFLICT',status:409,message:'تعذر تثبيت الطلب بسبب تكرار في المرجع. لم يتغير رصيدك.'};
      throw error;
    }finally{client.release();}
  }
  let wallet, invoice, id, persisted = false;
  try {
    wallet = await getWallet(true);
    id = `NX-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
    const supplierOrderUuid=supplierProvider==='wamda'?crypto.randomUUID():id;
    invoice = await createShamInvoice(id, pricedPack, wallet);
    await pool.query(`INSERT INTO nexa_orders (
      id,category_id,product_id,option_id,pack_index,product_label,amount_minor,currency,
      customer_name,customer_phone,game_account,notes,expires_at,invoice_number,invoice_identifier,
      wallet_label,wallet_address,supplier_provider,supplier_kind,supplier_category_id,supplier_type_id,
      supplier_quantity,supplier_fields,supplier_mch_order_id,supplier_status,supplier_message,customer_id,payment_method
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,$22,$23::jsonb,$24,$25,$26,$27,$28
    )`,
    [
      id,input.categoryId,input.productId,input.optionId,Number(input.packIndex),pricedPack.label,
      pricedPack.amountMinor.toString(),pricedPack.currency,name,phone,gameAccount,notes,
      invoice.expiresAt,invoice.invoiceNumber,invoice.identifier,invoice.walletLabel,invoice.walletAddress,
      supplierProvider,supplier?.kind || '',supplier ? Number(supplier.categoryId) : null,
      supplier ? Number(supplier.typeId || supplier.productId) : null,quantity,JSON.stringify(supplierFields),
      supplier ? supplierOrderUuid : null,supplier ? 'pending_payment' : 'not_applicable',
      supplierProvider==='wamda'?'بانتظار تأكيد الدفع من شام كاش؛ سيتم إرسال الطلب إلى ومضة بعد التحقق.':(supplier?'بانتظار تأكيد الدفع من شام كاش.':''),
      customer?.id || null,'shamcash',
    ]);
    persisted = true;
    return {
      orderId:id, product:pricedPack.label, amountMinor:pricedPack.amountMinor.toString(), currency:pricedPack.currency,
      expiresAt:invoice.expiresAt.toISOString(),invoiceNumber:invoice.invoiceNumber,invoiceIdentifier:invoice.identifier,
      receiverLabel:invoice.walletLabel,receiverAddress:invoice.identifier,status:'pending_payment',
      deliveryProvider:supplierProvider==='wamda'?'WAMDA':(supplier?'SEAGM':null),deliveryStatus:supplier?'queued_after_payment':null,
    };
  } catch (error) {
    if (invoice?.invoiceNumber && !persisted) {
      try { await shamApi('DELETE', `/v1/invoices/${encodeURIComponent(invoice.invoiceNumber)}`); }
      catch (cleanupError) { console.error('could not cancel orphaned Sham Cash invoice', cleanupError.code || cleanupError.message); }
    }
    if (error instanceof ProviderError) return {error:error.code,status:error.status >= 500 ? 502 : error.status,message:providerMessage(error)};
    throw error;
  }
}
async function getShamcashTransaction(wallet, transactionRef) {
  // Provider docs impose an additional 1 request / 12 seconds for transaction details per API key.
  const quota = await reserveProviderQuota('shamcash:transaction-detail', { maxRequests:10000, windowMs:24*60*60_000, minIntervalMs:12_000 });
  if (!quota.allowed) throw Object.assign(new Error('PROVIDER_LOOKUP_COOLDOWN'), { code:'PROVIDER_LOOKUP_COOLDOWN', retryAfter:quota.retryAfter });
  const route = `/v1/wallets/shamcash/${encodeURIComponent(wallet.id)}/transactions/${encodeURIComponent(transactionRef)}`;
  const payload = await shamApi('GET', route);
  if (payload?.success !== true || payload?.data?.found !== true || !payload?.data?.transaction) return null;
  const tx = payload.data.transaction;
  const accountAddress = String(payload?.data?.account?.account_address || '');
  return {
    transactionId:String(tx.tran_id || ''), type:String(tx.type || '').toLowerCase(), amountMinor:decimalMinor(tx.amount),
    currency:String(tx.currency || '').toUpperCase(), occurredAt:parseProviderDate(tx.datetime),
    receiverAddress:accountAddress, raw:tx,
  };
}
async function verifyProviderInvoice(order, transactionRef) {
  const path = `/v1/invoices/${encodeURIComponent(order.invoice_number)}`;
  let verifyError = null;
  try {
    const quota = await reserveProviderQuota('shamcash:invoice-verify', { maxRequests:8, windowMs:5*60_000 });
    if (!quota.allowed) throw Object.assign(new Error('PROVIDER_VERIFY_COOLDOWN'), { code:'PROVIDER_VERIFY_COOLDOWN', retryAfter:quota.retryAfter });
    const result = await shamApi('POST', `${path}/verify`, { transactionRef });
    if (result?.success !== true || result?.status !== 'paid' || String(result?.invoiceNumber || '') !== order.invoice_number || String(result?.transactionRef || '') !== transactionRef) {
      throw new ProviderError(502, { error:'INVALID_VERIFY_RESPONSE', message:'استجابة التحقق من الفاتورة غير مكتملة.' });
    }
  } catch (error) {
    // A retry after provider-side success may return ALREADY_PAID. Re-read invoice and only recover if it is the same payment.
    if (!(error instanceof ProviderError) || !['ALREADY_PAID','INVALID_STATUS'].includes(error.code)) throw error;
    verifyError = error;
  }
  const invoice = await shamApi('GET', path);
  const ok = String(invoice.status).toLowerCase() === 'paid' &&
    String(invoice.method).toLowerCase() === 'shamcash' && String(invoice.invoiceNumber) === order.invoice_number &&
    String(invoice.transactionRef || '') === transactionRef && String(invoice.identifier || '') === String(order.invoice_identifier || '') &&
    String(invoice.currency || '').toUpperCase() === order.currency && decimalMinor(invoice.amount) === BigInt(order.amount_minor) &&
    decimalMinor(invoice.paidAmount) === BigInt(order.amount_minor);
  if (!ok) {
    if (verifyError) throw verifyError;
    throw new ProviderError(422, { error:'INVOICE_NOT_EXACTLY_PAID', message:'لم تؤكد بيانات الفاتورة استلام المبلغ كاملاً وبشكل مطابق.' });
  }
  return invoice;
}

function supplierDeliveryForOrder(order) {
  if (!['seagm','wamda'].includes(order?.supplier_provider)) return null;
  let result = null;
  if (order.supplier_status === 'completed' && order.supplier_result_encrypted) {
    try { result = JSON.parse(decryptSecret(order.supplier_result_encrypted, cfg.settingsEncryptionKey)); } catch {}
  }
  return {
    provider:order.supplier_provider==='wamda'?'WAMDA':'SEAGM',status:String(order.supplier_status || 'pending'),
    message:String(order.supplier_message || ''),
    orderId:order.supplier_order_id ? String(order.supplier_order_id) : null,
    ...(result || {}),
  };
}

async function verifyPayment(input) {
  if (!paymentsReady) return {error:'PAYMENTS_NOT_READY',status:503,message:'التحقق من الدفع غير متاح حتى تكتمل إعدادات API على الخادم.'};
  const orderId = String(input.orderId || '').trim().toUpperCase();
  const transactionRef = String(input.transactionId || '').trim();
  if (!/^NX-[A-F0-9]{20}$/.test(orderId)) return {error:'INVALID_ORDER',status:400,message:'رقم طلب Nexa غير صحيح.'};
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(transactionRef)) return {error:'INVALID_TRANSACTION_ID',status:400,message:'أدخل رقم العملية كما يظهر في شام كاش (حتى 64 حرفاً أو رقماً).'};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM nexa_orders WHERE id=$1 FOR UPDATE',[orderId]);
    if (!locked.rowCount) { await client.query('ROLLBACK'); return {error:'ORDER_NOT_FOUND',status:404,message:'لم يتم العثور على الطلب.'}; }
    const order = locked.rows[0];
    if (order.status === 'paid') {
      const used = await client.query('SELECT transaction_id FROM nexa_payments WHERE order_id=$1',[orderId]);
      await client.query('COMMIT');
      if (used.rowCount && used.rows[0].transaction_id === transactionRef) return {ok:true,alreadyPaid:true,orderId,transactionId:transactionRef,status:'paid',receipt:{orderId,product:order.product_label,amountMinor:String(order.amount_minor),currency:order.currency,customerName:order.customer_name,invoiceNumber:order.invoice_number,transactionId:transactionRef,paidAt:order.paid_at ? new Date(order.paid_at).toISOString() : new Date().toISOString(),receiverLabel:order.wallet_label,receiverAddress:order.invoice_identifier,...(['seagm','wamda'].includes(order.supplier_provider)?{delivery:supplierDeliveryForOrder(order)}:{})}};
      return {error:'ORDER_ALREADY_PAID',status:409,message:'هذا الطلب مدفوع مسبقاً ولا يقبل رقم عملية آخر.'};
    }
    if (order.status !== 'pending_payment' || new Date(order.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE nexa_orders SET status='expired' WHERE id=$1 AND status='pending_payment'",[orderId]);
      await client.query('COMMIT');
      return {error:'ORDER_EXPIRED',status:410,message:'انتهت صلاحية الطلب أو فاتورة شام كاش. أنشئ طلباً جديداً.'};
    }
    const prior = await client.query('SELECT order_id FROM nexa_payments WHERE transaction_id=$1',[transactionRef]);
    if (prior.rowCount) { await client.query('ROLLBACK'); return {error:'TRAN_ID_USED',status:409,message:'رقم العملية مستخدم مسبقاً ولا يمكن استخدامه مرة ثانية.'}; }

    let wallet, tx, invoice;
    try {
      wallet = await getWallet(true);
      tx = await getShamcashTransaction(wallet, transactionRef);
      if (!tx) { await client.query('ROLLBACK'); return {error:'TRANSACTION_NOT_FOUND',status:422,message:'لم يعثر مزوّد شام كاش على العملية بهذا الرقم. انتظر ظهورها في السجل ثم أعد المحاولة.'}; }
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === 'PROVIDER_LOOKUP_COOLDOWN') return {error:error.code,status:429,message:`يوجد حد من شام كاش لاستعلام تفاصيل عملية واحدة كل 12 ثانية. أعد المحاولة بعد ${error.retryAfter} ثانية.`,retryAfter:error.retryAfter};
      if (error instanceof ProviderError) return {error:error.code,status:error.status >= 500 ? 502 : error.status,message:providerMessage(error)};
      throw error;
    }
    if (tx.transactionId !== transactionRef) { await client.query('ROLLBACK'); return {error:'TRANSACTION_ID_MISMATCH',status:422,message:'رقم العملية المسترجع لا يطابق الرقم الذي أدخلته.'}; }
    if (tx.type !== 'credit') { await client.query('ROLLBACK'); return {error:'NOT_INCOMING',status:422,message:'هذه ليست حوالة واردة إلى محفظة المتجر.'}; }
    if (!tx.receiverAddress || tx.receiverAddress.toLowerCase() !== String(wallet.walletAddress).toLowerCase() || tx.receiverAddress.toLowerCase() !== String(order.invoice_identifier).toLowerCase()) {
      await client.query('ROLLBACK'); return {error:'WRONG_RECEIVER',status:422,message:'العملية لم تصل إلى عنوان محفظة Nexa Store الذي صدر لهذه الفاتورة.'};
    }
    if (tx.currency !== order.currency || tx.amountMinor === null || tx.amountMinor !== BigInt(order.amount_minor)) {
      await client.query('ROLLBACK'); return {error:'AMOUNT_MISMATCH',status:422,message:'المبلغ أو العملة لا يطابقان قيمة الطلب تماماً. لا نقبل فرقاً أو تقريباً.'};
    }
    if (Number.isNaN(tx.occurredAt.getTime())) { await client.query('ROLLBACK'); return {error:'INVALID_TRANSACTION_DATE',status:422,message:'تاريخ العملية الذي أعاده المزوّد غير صالح.'}; }
    const now = Date.now(), txTime = tx.occurredAt.getTime(), age = now - txTime;
    if (age > cfg.maxAgeMs) { await client.query('ROLLBACK'); return {error:'STALE_TRANSACTION',status:422,message:'العملية قديمة وخارج المهلة المسموحة.'}; }
    if (age < -cfg.futureSkewMs) { await client.query('ROLLBACK'); return {error:'FUTURE_TRANSACTION',status:422,message:'وقت العملية يقع في المستقبل؛ لم يتم قبولها.'}; }
    if (txTime < new Date(order.created_at).getTime() - 60_000 || txTime > new Date(order.expires_at).getTime() + 60_000) {
      await client.query('ROLLBACK'); return {error:'TRANSACTION_OUTSIDE_ORDER_WINDOW',status:422,message:'وقت التحويل خارج فترة صلاحية هذا الطلب.'};
    }
    try { invoice = await verifyProviderInvoice(order, transactionRef); }
    catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof ProviderError) return {error:error.code,status:error.status >= 500 ? 502 : error.status,message:providerMessage(error)};
      if (error.code === 'PROVIDER_VERIFY_COOLDOWN') return {error:error.code,status:429,message:`تم بلوغ حد التحقق الرسمي لدى شام كاش. أعد المحاولة بعد ${error.retryAfter} ثانية.`,retryAfter:error.retryAfter};
      throw error;
    }
    const paidAt = new Date(invoice.paidAt || '');
    if (!Number.isFinite(paidAt.getTime())) { await client.query('ROLLBACK'); return {error:'INVALID_PAID_AT',status:422,message:'وقت تأكيد الفاتورة غير موجود أو غير صالح في سجل المزوّد.'}; }
    const paidAtAge = Date.now() - paidAt.getTime();
    if (paidAtAge < -cfg.futureSkewMs || paidAt.getTime() < new Date(order.created_at).getTime() - 60_000 || paidAt.getTime() > new Date(order.expires_at).getTime() + 60_000) {
      await client.query('ROLLBACK'); return {error:'PAID_AT_OUTSIDE_WINDOW',status:422,message:'وقت تأكيد الفاتورة خارج فترة صلاحية الطلب.'};
    }
    const inserted = await client.query(`INSERT INTO nexa_payments (transaction_id,order_id,amount_minor,currency,receiver_wallet_id,occurred_at,provider_payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
      [transactionRef,orderId,tx.amountMinor.toString(),tx.currency,String(wallet.id),tx.occurredAt,JSON.stringify({invoiceNumber:order.invoice_number,transactionId:transactionRef,amountMinor:tx.amountMinor.toString(),currency:tx.currency,receiverAddress:tx.receiverAddress,type:tx.type,occurredAt:tx.occurredAt.toISOString(),paidAt:paidAt.toISOString()})]);
    if (!inserted.rowCount) { await client.query('ROLLBACK'); return {error:'TRAN_ID_USED',status:409,message:'رقم العملية مستخدم مسبقاً ولا يمكن استخدامه مرة ثانية.'}; }
    await client.query("UPDATE nexa_orders SET status='paid',paid_at=$2,supplier_status=CASE WHEN supplier_provider IN ('seagm','wamda') THEN 'pending' ELSE supplier_status END,supplier_message=CASE WHEN supplier_provider='wamda' THEN 'تم التحقق من الدفع. سيتم إرسال الطلب إلى ومضة.' WHEN supplier_provider='seagm' THEN 'تم التحقق من الدفع. سيتم إرسال الطلب إلى SEAGM.' ELSE supplier_message END WHERE id=$1",[orderId,paidAt]);
    let walletBalanceMinor=null;
    if(order.wallet_topup_customer_id){
      const credited=await client.query('UPDATE nexa_customers SET balance_minor=balance_minor+$2 WHERE id=$1 RETURNING balance_minor::text',[order.wallet_topup_customer_id,String(order.amount_minor)]);
      if(!credited.rowCount){await client.query('ROLLBACK');return {error:'WALLET_ACCOUNT_NOT_FOUND',status:409,message:'تعذر ربط شحنة الرصيد بالحساب. تواصل مع الدعم مع رقم الطلب.'};}
      walletBalanceMinor=String(credited.rows[0].balance_minor);
      await client.query(`INSERT INTO nexa_wallet_ledger(customer_id,kind,amount_minor,balance_after_minor,reference_order_id,note)
        VALUES($1,'topup',$2,$3,$4,'شحن رصيد عبر شام كاش')`,[order.wallet_topup_customer_id,String(order.amount_minor),walletBalanceMinor,orderId]);
    }
    if (['seagm','wamda'].includes(order.supplier_provider)) {
      await client.query(`INSERT INTO nexa_fulfillment_jobs(order_id,status,next_attempt_at)
        VALUES($1,'pending',NOW()) ON CONFLICT(order_id) DO NOTHING`,[orderId]);
    }
    await client.query('COMMIT');
    return {ok:true,orderId,invoiceNumber:order.invoice_number,transactionId:transactionRef,status:'paid',verifiedAt:new Date().toISOString(),
      ...(walletBalanceMinor!==null?{walletBalanceMinor}:{}),
      receipt:{orderId,product:order.product_label,amountMinor:String(order.amount_minor),currency:order.currency,customerName:order.customer_name,
        paymentMethod:order.wallet_topup_customer_id?'shamcash_topup':'shamcash',
        ...(walletBalanceMinor!==null?{walletBalanceMinor}:{}),
        invoiceNumber:order.invoice_number,transactionId:transactionRef,paidAt:paidAt.toISOString(),receiverLabel:order.wallet_label,receiverAddress:order.invoice_identifier,
        ...(order.supplier_provider==='wamda'?{delivery:{provider:'WAMDA',status:'pending',message:'تم التحقق من الدفع. سيتم إرسال الطلب إلى ومضة.'}}:(order.supplier_provider==='seagm'?{delivery:{provider:'SEAGM',status:'pending',message:'تم التحقق من الدفع. سيتم إرسال الطلب إلى SEAGM.'}}:{}))}};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    if (error.code === '23505') return {error:'TRAN_ID_USED',status:409,message:'رقم العملية مستخدم مسبقاً ولا يمكن استخدامه مرة ثانية.'};
    throw error;
  } finally { client.release(); }
}
async function serveStatic(req, res, pathname) {
  if (!(pathname === '/' || pathname === '/index.html' || pathname === '/admin' || pathname === '/admin.html' || pathname.startsWith('/assets/'))) return send(res,404,{error:'NOT_FOUND'});
  let target = pathname === '/' ? '/index.html' : pathname === '/admin' ? '/admin.html' : decodeURIComponent(pathname);
  const abs = path.resolve(ROOT, '.' + target);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return send(res,404,{error:'NOT_FOUND'});
  try {
    const data = await fs.readFile(abs);
    res.writeHead(200, {'Content-Type':mime[path.extname(abs)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self' data: blob: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"});
    res.end(data);
  } catch { send(res,404,{error:'NOT_FOUND'}); }
}

function defaultStoreSettings() {
  return {
    storeName:'Nexa Store', storeLogo:'assets/brand/logo.svg', announcement:'وجهتك للألعاب والبطاقات والاشتراكات الرقمية',
    themePrimary:'#397fda', themeSecondary:'#65b8d7', themeAccent:'#8076d6', themeDark:'#193957',
    fxMode:'manual', fxRate:145, fxApiUrl:'', fxJsonPath:'', fxUnit:'new',
    fxAuthHeader:'Authorization', fxAuthPrefix:'Bearer', fxUpdatedAt:null, fxLastError:'',
    catalogApiMode:'manual', catalogApiUrl:'', catalogApiJsonPath:'catalog',
    catalogApiAuthHeader:'Authorization', catalogApiAuthPrefix:'Bearer', catalogApiSyncMode:'merge',
    catalogApiIntervalMinutes:15, catalogApiLastSyncAt:null, catalogApiLastAttemptAt:null, catalogApiLastError:'',
    catalogApiTokenEncrypted:'', catalogApiTokenCleared:false,
    seagmEnvironment:'sandbox', seagmUid:'', seagmSecretEncrypted:'', seagmSecretCleared:false,
    seagmCatalogCache:[], seagmAccountInfo:null, seagmLastSyncAt:null, seagmLastTestAt:null, seagmLastError:'',
    wamdaApiTokenEncrypted:'',wamdaApiTokenCleared:false,wamdaWebhookSecretEncrypted:'',
    wamdaCatalogCache:[],wamdaAccountInfo:null,wamdaLastSyncAt:null,wamdaLastRefreshAttemptAt:null,wamdaLastTestAt:null,wamdaLastError:'',
    wamdaProfitMarginPercent:0,wamdaPricingPolicy:{mode:'percent',value:0},wamdaCategoryPricingPolicies:{},wamdaAutoRefreshEnabled:true,wamdaRefreshIntervalMinutes:15,
    nexaAiProvider:'gemini',nexaAiModel:'gemini-3.6-flash',nexaAiApiKeyEncrypted:'',nexaAiApiKeyCleared:false,
    catalogWriteApiTokenEncrypted:'', catalogWriteApiTokenCleared:false, catalogWriteApiKeys:[],
    paymentEnabled:cfg.paymentsEnabled, shamApiBase:cfg.apiBase, walletId:cfg.walletId,
    receiverLabel:cfg.receiverLabel, timezoneOffsetMinutes:cfg.timezoneOffsetMinutes,
    orderTtlMinutes:cfg.orderTtlMinutes, maxAgeMinutes:Math.round(cfg.maxAgeMs/60_000),
    futureSkewSeconds:Math.round(cfg.futureSkewMs/1000), shamApiTokenEncrypted:'',
    fxApiTokenEncrypted:'',
  };
}
function applyStoreSettings() {
  if (!storeSettings) return;
  cfg.paymentsEnabled = Boolean(storeSettings.paymentEnabled);
  cfg.apiBase = String(storeSettings.shamApiBase || 'https://apis-shamcash.com/api').replace(/\/$/, '');
  cfg.walletId = String(storeSettings.walletId || '');
  cfg.receiverLabel = String(storeSettings.receiverLabel || 'Nexa Store');
  cfg.orderTtlMinutes = Number(storeSettings.orderTtlMinutes || 15);
  cfg.maxAgeMs = Number(storeSettings.maxAgeMinutes || 15) * 60_000;
  cfg.futureSkewMs = Number(storeSettings.futureSkewSeconds ?? 90) * 1000;
  cfg.timezoneOffsetMinutes = Number(storeSettings.timezoneOffsetMinutes ?? 180);
  try {
    if (storeSettings.shamApiTokenCleared) cfg.apiToken = '';
    else if (storeSettings.shamApiTokenEncrypted) cfg.apiToken = decryptSecret(storeSettings.shamApiTokenEncrypted, cfg.settingsEncryptionKey);
  } catch { cfg.apiToken = ''; }
  try {
    fxApiTokenRuntime = storeSettings.fxApiTokenCleared ? '' : (storeSettings.fxApiTokenEncrypted ? decryptSecret(storeSettings.fxApiTokenEncrypted, cfg.settingsEncryptionKey) : '');
  } catch { fxApiTokenRuntime = ''; }
  try {
    catalogApiTokenRuntime = storeSettings.catalogApiTokenCleared ? '' : (storeSettings.catalogApiTokenEncrypted ? decryptSecret(storeSettings.catalogApiTokenEncrypted, cfg.settingsEncryptionKey) : '');
  } catch { catalogApiTokenRuntime = ''; }
  try {
    catalogWriteApiTokenRuntime = storeSettings.catalogWriteApiTokenCleared ? '' : (storeSettings.catalogWriteApiTokenEncrypted ? decryptSecret(storeSettings.catalogWriteApiTokenEncrypted, cfg.settingsEncryptionKey) : '');
  } catch { catalogWriteApiTokenRuntime = ''; }
  try {
    seagmSecretRuntime = storeSettings.seagmSecretCleared ? '' : (storeSettings.seagmSecretEncrypted ? decryptSecret(storeSettings.seagmSecretEncrypted, cfg.settingsEncryptionKey) : '');
  } catch { seagmSecretRuntime = ''; }
  try { wamdaApiTokenRuntime=storeSettings.wamdaApiTokenCleared?'':(storeSettings.wamdaApiTokenEncrypted?decryptSecret(storeSettings.wamdaApiTokenEncrypted,cfg.settingsEncryptionKey):''); } catch { wamdaApiTokenRuntime=''; }
  try { wamdaWebhookSecretRuntime=storeSettings.wamdaWebhookSecretEncrypted?decryptSecret(storeSettings.wamdaWebhookSecretEncrypted,cfg.settingsEncryptionKey):''; } catch { wamdaWebhookSecretRuntime=''; }
  try { nexaAiApiKeyRuntime=storeSettings.nexaAiApiKeyCleared?'':(storeSettings.nexaAiApiKeyEncrypted?decryptSecret(storeSettings.nexaAiApiKeyEncrypted,cfg.settingsEncryptionKey):''); } catch { nexaAiApiKeyRuntime=''; }
  cachedShamWallet = null;
  cachedShamWalletAt = 0;
  refreshPaymentsReady();
}
async function persistStoreSettings() {
  if (!pool) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'), { status:503 });
  await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(storeSettings)]);
}
async function initializeStoreState() {
  if (cfg.settingsEncryptionKey.length < 24) throw new Error('STORE_SETTINGS_ENCRYPTION_KEY must be at least 24 characters.');
  storeSettings = defaultStoreSettings();
  if (!pool) { refreshPaymentsReady(); return; }
  const result = await pool.query('SELECT catalog,settings FROM nexa_store_state WHERE singleton=TRUE');
  if (!result.rowCount) {
    if (cfg.adminApiKey.length >= 24 && cfg.apiToken) storeSettings.shamApiTokenEncrypted = encryptSecret(cfg.apiToken, cfg.settingsEncryptionKey);
    await pool.query('INSERT INTO nexa_store_state(singleton,catalog,settings) VALUES(TRUE,$1::jsonb,$2::jsonb) ON CONFLICT(singleton) DO NOTHING',
      [JSON.stringify(catalog),JSON.stringify(storeSettings)]);
  } else {
    const row = result.rows[0];
    if (row.catalog) catalog = validateCatalog(row.catalog);
    storeSettings = { ...defaultStoreSettings(), ...(row.settings || {}) };
    let themeMigrated = false;
    if ((storeSettings.themePrimary === '#e23b57' && storeSettings.themeSecondary === '#547ee8' && storeSettings.themeDark === '#101a2e') ||
        (storeSettings.themePrimary === '#376f5f' && storeSettings.themeSecondary === '#8ba995' && storeSettings.themeDark === '#24433a') ||
        (storeSettings.themePrimary === '#4d92eb' && storeSettings.themeSecondary === '#9ccaff' && storeSettings.themeDark === '#1e4c7c')) {
      storeSettings.themePrimary = '#397fda';
      storeSettings.themeSecondary = '#65b8d7';
      storeSettings.themeAccent = '#8076d6';
      storeSettings.themeDark = '#193957';
      themeMigrated = true;
    }
    if (!storeSettings.themeAccent) { storeSettings.themeAccent = '#8076d6'; themeMigrated = true; }
    if (themeMigrated) {
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(storeSettings)]);
    }
  }
  if(!storeSettings.wamdaWebhookSecretEncrypted){
    storeSettings.wamdaWebhookSecretEncrypted=encryptSecret(crypto.randomBytes(36).toString('base64url'),cfg.settingsEncryptionKey);
    await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(storeSettings)]);
  }
  applyStoreSettings();
}
function adminCookie(req, token, maxAge = 8 * 60 * 60) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.NODE_ENV === 'production';
  return `nexa_admin_session=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const [key,...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}
function customerCookie(req, token, maxAge = 30 * 24 * 60 * 60) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.NODE_ENV === 'production';
  return \`nexa_customer_session=\${token}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=\${maxAge}\${secure ? '; Secure' : ''}\`;
}
function customerSessionHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}
function customerPasswordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
async function currentCustomer(req) {
  if (!pool) return null;
  const token = readCookie(req,'nexa_customer_session');
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) return null;
  const result = await pool.query(\`SELECT c.id,c.full_name,c.phone,c.balance_minor::text,c.created_at
    FROM nexa_customer_sessions s JOIN nexa_customers c ON c.id=s.customer_id
    WHERE s.session_hash=$1 AND s.expires_at>NOW() LIMIT 1\`,[customerSessionHash(token)]);
  return result.rows[0] || null;
}
async function createCustomerSession(req,res,customerId) {
  const token=crypto.randomBytes(32).toString('base64url');
  await pool.query(\`INSERT INTO nexa_customer_sessions(session_hash,customer_id,expires_at)
    VALUES($1,$2,NOW()+INTERVAL '30 days')\`,[customerSessionHash(token),customerId]);
  res.setHeader('Set-Cookie',customerCookie(req,token));
}
function adminAuthorized(req) {
  const supplied = Buffer.from(String(req.headers['x-admin-key'] || ''));
  const expected = Buffer.from(cfg.adminApiKey);
  if (cfg.adminApiKey && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)) return true;
  if (!verifyAdminSession(readCookie(req,'nexa_admin_session'), cfg.adminApiKey)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== String(req.headers.host || '')) return false; } catch { return false; }
  }
  return true;
}
function catalogWriteAuthorized(req) {
  const raw = String(req.headers['x-catalog-key'] || '');
  if (!raw || raw.length > 256) return false;
  const supplied = Buffer.from(raw);
  const legacy = Buffer.from(catalogWriteApiTokenRuntime);
  if (catalogWriteApiTokenRuntime && supplied.length === legacy.length && crypto.timingSafeEqual(supplied,legacy)) return true;
  const hash = crypto.createHash('sha256').update(raw).digest();
  return (storeSettings?.catalogWriteApiKeys || []).some(entry => {
    let expected;
    try { expected = Buffer.from(String(entry.hash || ''),'hex'); } catch { return false; }
    return expected.length === hash.length && crypto.timingSafeEqual(hash,expected);
  });
}
function fxRateReady() {
  if (!storeSettings || !Number.isFinite(Number(storeSettings.fxRate)) || Number(storeSettings.fxRate) <= 0) return false;
  if (storeSettings.fxMode !== 'api') return true;
  const age = Date.now() - new Date(storeSettings.fxUpdatedAt || 0).getTime();
  return Number.isFinite(age) && age >= -90_000 && age <= 30 * 60_000;
}
function publicSettings() {
  return {
    storeName:String(storeSettings?.storeName || 'Nexa Store'),
    storeLogo:String(storeSettings?.storeLogo || 'assets/brand/logo.svg'),
    announcement:String(storeSettings?.announcement || ''),
    themePrimary:String(storeSettings?.themePrimary || '#397fda'),
    themeSecondary:String(storeSettings?.themeSecondary || '#65b8d7'),
    themeAccent:String(storeSettings?.themeAccent || '#8076d6'),
    themeDark:String(storeSettings?.themeDark || '#193957'),
    fxRate:Number(storeSettings?.fxRate || 145),
    fxMode:storeSettings?.fxMode || 'manual',
    fxReady:fxRateReady(),
    fxUpdatedAt:storeSettings?.fxUpdatedAt || null,
  };
}
async function refreshAutomaticFx() {
  if (!storeSettings || storeSettings.fxMode !== 'api') return { ok:false, message:'وضع سعر الصرف ليس تلقائياً.' };
  try {
    const url = new URL(String(storeSettings.fxApiUrl || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'api-v2.sp-today.com' || url.username || url.password) {
      throw new Error('يجب أن يكون رابط الصرف HTTPS ومن نطاق api-v2.sp-today.com حصراً.');
    }
    if (!storeSettings.fxJsonPath) throw new Error('أدخل مسار حقل السعر في استجابة JSON.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response;
    try {
      const headerName = ['Authorization','x-api-key'].includes(storeSettings.fxAuthHeader) ? storeSettings.fxAuthHeader : 'Authorization';
      const headers = { Accept:'application/json' };
      if (fxApiTokenRuntime) headers[headerName] = headerName === 'Authorization' ? `${storeSettings.fxAuthPrefix || 'Bearer'} ${fxApiTokenRuntime}` : fxApiTokenRuntime;
      response = await fetch(url, { headers, signal:controller.signal, redirect:'error' });
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error(`SP Today API أعاد HTTP ${response.status}`);
    const payload = await response.json();
    const rawRate = getJsonPath(payload, String(storeSettings.fxJsonPath));
    const rate = normalizeFxRate(rawRate, storeSettings.fxUnit === 'old' ? 'old' : 'new');
    const updatedAt = new Date().toISOString();
    const nextSettings = { ...storeSettings, fxRate:rate, fxUpdatedAt:updatedAt, fxLastError:'' };
    await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
    storeSettings = nextSettings;
    return { ok:true, rate, updatedAt, message:'تم تحديث سعر الصرف من SP Today API V2.' };
  } catch (error) {
    storeSettings = { ...storeSettings, fxLastError:String(error?.message || 'FX_REFRESH_FAILED').slice(0,300) };
    await persistStoreSettings().catch(()=>{});
    return { ok:false, message:storeSettings.fxLastError };
  }
}
function safeSettingsForAdmin() {
  const {shamApiTokenEncrypted,fxApiTokenEncrypted,catalogApiTokenEncrypted,catalogWriteApiTokenEncrypted,seagmSecretEncrypted,seagmCatalogCache=[],catalogWriteApiKeys=[],wamdaApiTokenEncrypted,wamdaWebhookSecretEncrypted,wamdaCatalogCache=[],nexaAiApiKeyEncrypted,...settings}=storeSettings||{};
  const publicBase=String(process.env.PUBLIC_BASE_URL||'https://nexa-store-9st4.onrender.com').replace(/\/+$/,'');
  return {...settings,catalogWriteApiKeys:catalogWriteApiKeys.map(({id,name,createdAt})=>({id,name,createdAt})),
    shamApiTokenConfigured:Boolean(cfg.apiToken),fxApiTokenConfigured:Boolean(fxApiTokenRuntime),catalogApiTokenConfigured:Boolean(catalogApiTokenRuntime),
    catalogWriteApiTokenConfigured:Boolean(catalogWriteApiTokenRuntime||catalogWriteApiKeys.length),seagmSecretConfigured:Boolean(seagmSecretRuntime),
    seagmProductCount:seagmCatalogCache.reduce((sum,category)=>sum+(category.products||[]).length,0),
    wamdaApiTokenConfigured:Boolean(wamdaApiTokenRuntime),wamdaWebhookConfigured:Boolean(wamdaWebhookSecretRuntime),
    wamdaWebhookUrl:wamdaWebhookSecretRuntime?publicBase+'/api/webhooks/wamda/'+encodeURIComponent(wamdaWebhookSecretRuntime):'',
    wamdaProductCount:wamdaCatalogCache.reduce((sum,category)=>sum+(category.products||[]).length,0),
    nexaAiConfigured:Boolean(nexaAiApiKeyRuntime),
  };
}
function validateAndApplySettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SETTINGS');
  if(wamdaBulkPublishInProgress&&['wamdaPricingPolicy','wamdaProfitMarginPercent','wamdaCategoryPricingPolicies','fxRate'].some(key=>input[key]!==undefined))throw Object.assign(new Error('لا يمكن تغيير سياسة الأسعار أو سعر الصرف أثناء النشر الجماعي.'),{status:409});
  const next = { ...storeSettings };
  const setText = (key, max, fallback = '') => {
    if (input[key] === undefined) return;
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error(`INVALID_${key.toUpperCase()}`);
    next[key] = input[key].trim() || fallback;
  };
  setText('storeName',80,'Nexa Store');
  setText('announcement',240,'');
  for (const key of ['themePrimary','themeSecondary','themeAccent','themeDark']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(input[key])) throw new Error(`INVALID_${key.toUpperCase()}`);
    next[key] = input[key].toLowerCase();
  }
  if (input.storeLogo !== undefined) {
    if (!isSafeCatalogImage(input.storeLogo)) throw new Error('INVALID_STORE_LOGO');
    next.storeLogo = input.storeLogo;
  }
  setText('receiverLabel',100,'Nexa Store');
  setText('walletId',200,'');
  setText('shamApiBase',200,'https://apis-shamcash.com/api');
  try { const apiUrl = new URL(next.shamApiBase); if (apiUrl.protocol !== 'https:' || apiUrl.hostname !== 'apis-shamcash.com' || apiUrl.pathname.replace(/\/$/,'') !== '/api') throw new Error(); } catch { throw new Error('INVALID_SHAM_API_BASE'); }
  setText('fxApiUrl',500,'');
  setText('fxJsonPath',160,'');
  setText('catalogApiUrl',1000,'');
  setText('seagmUid',30,'');
  if (next.seagmUid && !/^\d{1,20}$/.test(next.seagmUid)) throw new Error('INVALID_SEAGM_UID');
  if (input.seagmEnvironment !== undefined) {
    if (!['sandbox','production'].includes(input.seagmEnvironment)) throw new Error('INVALID_SEAGM_ENVIRONMENT');
    next.seagmEnvironment = input.seagmEnvironment;
  }
  if (input.seagmSecret !== undefined && input.seagmSecret !== '') {
    if (typeof input.seagmSecret !== 'string' || input.seagmSecret.length > 512 || !input.seagmSecret.trim()) throw new Error('INVALID_SEAGM_SECRET');
    next.seagmSecretEncrypted = encryptSecret(input.seagmSecret.trim(),cfg.settingsEncryptionKey);
    next.seagmSecretCleared = false;
  }
  if (input.clearSeagmSecret === true) {
    next.seagmSecretEncrypted = '';
    next.seagmSecretCleared = true;
  }
  if (input.catalogApiJsonPath !== undefined) {
    if (typeof input.catalogApiJsonPath !== 'string' || input.catalogApiJsonPath.length > 160) throw new Error('INVALID_CATALOG_API_JSON_PATH');
    const jsonPath = input.catalogApiJsonPath.trim();
    if (jsonPath && !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(jsonPath)) throw new Error('INVALID_CATALOG_API_JSON_PATH');
    if (jsonPath.split('.').some(key=>['__proto__','prototype','constructor'].includes(key))) throw new Error('INVALID_CATALOG_API_JSON_PATH');
    next.catalogApiJsonPath = jsonPath;
  }
  setText('catalogApiAuthPrefix',30,'Bearer');
  if (next.catalogApiUrl) validateCatalogApiUrl(next.catalogApiUrl);
  if (input.catalogApiMode !== undefined) {
    if (!['manual','auto'].includes(input.catalogApiMode)) throw new Error('INVALID_CATALOG_API_MODE');
    next.catalogApiMode = input.catalogApiMode;
  }
  if (input.catalogApiAuthHeader !== undefined) {
    if (!['Authorization','x-api-key','none'].includes(input.catalogApiAuthHeader)) throw new Error('INVALID_CATALOG_API_AUTH_HEADER');
    next.catalogApiAuthHeader = input.catalogApiAuthHeader;
  }
  if (input.catalogApiSyncMode !== undefined) {
    if (!['merge','replace'].includes(input.catalogApiSyncMode)) throw new Error('INVALID_CATALOG_API_SYNC_MODE');
    next.catalogApiSyncMode = input.catalogApiSyncMode;
  }
  if (input.catalogApiIntervalMinutes !== undefined) {
    const interval = Number(input.catalogApiIntervalMinutes);
    if (!Number.isInteger(interval) || interval < 5 || interval > 1440) throw new Error('INVALID_CATALOG_API_INTERVAL');
    next.catalogApiIntervalMinutes = interval;
  }
  setText('fxAuthPrefix',20,'Bearer');
  if (input.fxAuthHeader !== undefined) {
    if (!['Authorization','x-api-key'].includes(input.fxAuthHeader)) throw new Error('INVALID_FX_AUTH_HEADER');
    next.fxAuthHeader = input.fxAuthHeader;
  }
  if (input.fxMode !== undefined) {
    if (!['manual','api'].includes(input.fxMode)) throw new Error('INVALID_FX_MODE');
    next.fxMode = input.fxMode;
  }
  if (input.fxUnit !== undefined) {
    if (!['new','old'].includes(input.fxUnit)) throw new Error('INVALID_FX_UNIT');
    next.fxUnit = input.fxUnit;
  }
  if (input.fxRate !== undefined) {
    const n = Number(input.fxRate);
    if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new Error('INVALID_FX_RATE');
    next.fxRate = Math.round(n * 1_000_000) / 1_000_000;
  }
  const numeric = [
    ['orderTtlMinutes',5,1440],['maxAgeMinutes',1,1440],['futureSkewSeconds',0,900],['timezoneOffsetMinutes',-840,840],
  ];
  for (const [key,min,max] of numeric) if (input[key] !== undefined) {
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`INVALID_${key.toUpperCase()}`);
    next[key] = n;
  }
  if (input.paymentEnabled !== undefined) {
    if (typeof input.paymentEnabled !== 'boolean') throw new Error('INVALID_PAYMENT_ENABLED');
    next.paymentEnabled = input.paymentEnabled;
  }
  if (input.shamApiToken !== undefined && input.shamApiToken !== '') {
    if (typeof input.shamApiToken !== 'string' || input.shamApiToken.length > 256) throw new Error('INVALID_SHAM_API_TOKEN');
    next.shamApiTokenEncrypted = encryptSecret(input.shamApiToken,cfg.settingsEncryptionKey);
    next.shamApiTokenCleared = false;
  }
  if (input.clearShamApiToken === true) { next.shamApiTokenEncrypted = ''; next.shamApiTokenCleared = true; }
  if (input.fxApiToken !== undefined && input.fxApiToken !== '') {
    if (typeof input.fxApiToken !== 'string' || input.fxApiToken.length > 512) throw new Error('INVALID_FX_API_TOKEN');
    next.fxApiTokenEncrypted = encryptSecret(input.fxApiToken,cfg.settingsEncryptionKey);
    next.fxApiTokenCleared = false;
  }
  if (input.clearFxApiToken === true) { next.fxApiTokenEncrypted = ''; next.fxApiTokenCleared = true; }
  if (input.catalogApiToken !== undefined && input.catalogApiToken !== '') {
    if (typeof input.catalogApiToken !== 'string' || input.catalogApiToken.length > 1024) throw new Error('INVALID_CATALOG_API_TOKEN');
    next.catalogApiTokenEncrypted = encryptSecret(input.catalogApiToken,cfg.settingsEncryptionKey);
    next.catalogApiTokenCleared = false;
  }
  if (input.clearCatalogApiToken === true) { next.catalogApiTokenEncrypted = ''; next.catalogApiTokenCleared = true; }
  if(input.wamdaApiToken!==undefined&&input.wamdaApiToken!==''){
    if(typeof input.wamdaApiToken!=='string'||input.wamdaApiToken.length>1024||!input.wamdaApiToken.trim()) throw new Error('INVALID_WAMDA_API_TOKEN');
    next.wamdaApiTokenEncrypted=encryptSecret(input.wamdaApiToken.trim(),cfg.settingsEncryptionKey);next.wamdaApiTokenCleared=false;
  }
  if(input.clearWamdaApiToken===true){next.wamdaApiTokenEncrypted='';next.wamdaApiTokenCleared=true;}
  if(input.nexaAiApiKey!==undefined&&input.nexaAiApiKey!==''){
    if(typeof input.nexaAiApiKey!=='string'||input.nexaAiApiKey.length>1024||!input.nexaAiApiKey.trim())throw new Error('INVALID_NEXA_AI_API_KEY');
    next.nexaAiApiKeyEncrypted=encryptSecret(input.nexaAiApiKey.trim(),cfg.settingsEncryptionKey);next.nexaAiApiKeyCleared=false;
  }
  if(input.clearNexaAiApiKey===true){next.nexaAiApiKeyEncrypted='';next.nexaAiApiKeyCleared=true;}
  if(input.nexaAiProvider!==undefined){if(input.nexaAiProvider!=='gemini')throw new Error('UNSUPPORTED_NEXA_AI_PROVIDER');next.nexaAiProvider='gemini';}
  if(input.nexaAiModel!==undefined){if(!['gemini-3.6-flash','gemini-3.5-flash','gemini-3.5-flash-lite','gemini-3.1-flash-lite'].includes(input.nexaAiModel))throw new Error('INVALID_NEXA_AI_MODEL');next.nexaAiModel=input.nexaAiModel;}
  if(input.wamdaProfitMarginPercent!==undefined){
    next.wamdaProfitMarginPercent=normalizeWamdaMargin(input.wamdaProfitMarginPercent);
    if(input.wamdaPricingPolicy===undefined)next.wamdaPricingPolicy={mode:'percent',value:next.wamdaProfitMarginPercent};
  }
  if(input.wamdaPricingPolicy!==undefined){
    const rule=normalizeWamdaPricingRule(input.wamdaPricingPolicy);
    if(!['percent','fixed_profit','fixed_price'].includes(rule.mode))throw new Error('INVALID_WAMDA_GLOBAL_PRICING_MODE');
    next.wamdaPricingPolicy=rule;
    next.wamdaProfitMarginPercent=rule.mode==='percent'?rule.value:0;
  }
  if(input.wamdaAutoRefreshEnabled!==undefined){
    if(typeof input.wamdaAutoRefreshEnabled!=='boolean')throw new Error('INVALID_WAMDA_AUTO_REFRESH_ENABLED');
    next.wamdaAutoRefreshEnabled=input.wamdaAutoRefreshEnabled;
  }
  if(input.wamdaRefreshIntervalMinutes!==undefined){
    const minutes=Number(input.wamdaRefreshIntervalMinutes);
    if(!Number.isInteger(minutes)||minutes<5||minutes>1440)throw new Error('INVALID_WAMDA_REFRESH_INTERVAL');
    next.wamdaRefreshIntervalMinutes=minutes;
  }
  return next;
}

async function responseTextLimited(response, maxBytes = 4_000_000) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error('CATALOG_API_RESPONSE_TOO_LARGE');
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('CATALOG_API_RESPONSE_TOO_LARGE');
    return buffer.toString('utf8');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('CATALOG_API_RESPONSE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock?.(); }
  return Buffer.concat(chunks,total).toString('utf8');
}
async function fetchExternalCatalog() {
  if (!storeSettings?.catalogApiUrl) throw new Error('أدخل رابط API المنتجات أولاً.');
  const url = validateCatalogApiUrl(storeSettings.catalogApiUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const headers = { Accept:'application/json' };
    if (catalogApiTokenRuntime && storeSettings.catalogApiAuthHeader !== 'none') {
      const header = storeSettings.catalogApiAuthHeader === 'x-api-key' ? 'x-api-key' : 'Authorization';
      headers[header] = header === 'Authorization' ? `${storeSettings.catalogApiAuthPrefix || 'Bearer'} ${catalogApiTokenRuntime}` : catalogApiTokenRuntime;
    }
    const response = await fetch(url,{method:'GET',headers,signal:controller.signal,redirect:'error'});
    if (!response.ok) throw new Error(`Catalog API HTTP ${response.status}`);
    const raw = await responseTextLimited(response);
    let payload;
    try { payload = JSON.parse(raw); } catch { throw new Error('Catalog API did not return valid JSON.'); }
    const source = storeSettings.catalogApiJsonPath ? getJsonPath(payload,storeSettings.catalogApiJsonPath) : payload;
    const imported = validateCatalog(source);
    return imported;
  } finally { clearTimeout(timeout); }
}
async function persistCatalog(nextCatalog) {
  if (!pool) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  await pool.query('UPDATE nexa_store_state SET catalog=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE',[JSON.stringify(nextCatalog)]);
  catalog = nextCatalog;
}
function catalogStats(items) {
  return { categories:items.length, products:items.reduce((sum,category)=>sum+(category.items||[]).length,0) };
}
async function syncCatalogFromApi({ preview = false } = {}) {
  if (catalogApiSyncInProgress) throw Object.assign(new Error('CATALOG_SYNC_IN_PROGRESS'),{status:409});
  catalogApiSyncInProgress = true;
  try {
    const incoming = await fetchExternalCatalog();
    const nextCatalog = storeSettings.catalogApiSyncMode === 'replace'
      ? mergeCatalog(catalog,incoming,'replace')
      : mergeCatalog(catalog,incoming,'merge');
    const stats = catalogStats(incoming);
    const currentStats = catalogStats(catalog);
    const result = { ok:true,preview,source:validateCatalogApiUrl(storeSettings.catalogApiUrl).hostname,
      imported:stats,current:currentStats,result:catalogStats(nextCatalog),mode:storeSettings.catalogApiSyncMode,
      sample:incoming.slice(0,3).map(category=>({id:category.id,name:category.name,products:category.items.length})) };
    if (preview) return result;
    const updatedAt = new Date().toISOString();
    const nextSettings = { ...storeSettings,catalogApiLastSyncAt:updatedAt,catalogApiLastAttemptAt:updatedAt,catalogApiLastError:'' };
    if (!pool) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE nexa_store_state SET catalog=$1::jsonb,settings=$2::jsonb,updated_at=NOW() WHERE singleton=TRUE',
        [JSON.stringify(nextCatalog),JSON.stringify(nextSettings)]);
      await client.query('COMMIT');
      catalog = nextCatalog;
      storeSettings = nextSettings;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return { ...result,updatedAt,message:'تمت مزامنة كتالوج المنتجات بنجاح.' };
  } catch (error) {
    if (!preview && pool) {
      const nextSettings = { ...storeSettings,catalogApiLastAttemptAt:new Date().toISOString(),catalogApiLastError:String(error?.message || 'CATALOG_API_SYNC_FAILED').slice(0,300) };
      try {
        await pool.query('UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE',[JSON.stringify(nextSettings)]);
        storeSettings = nextSettings;
      } catch {}
    }
    throw error;
  } finally { catalogApiSyncInProgress = false; }
}


function seagmClient() {
  if (!storeSettings?.seagmUid || !seagmSecretRuntime) {
    throw Object.assign(new Error('أدخل SEAGM UID وSecret Key واحفظهما أولاً.'),{status:400});
  }
  return createSeagmClient({
    uid:storeSettings.seagmUid,
    secretKey:seagmSecretRuntime,
    environment:storeSettings.seagmEnvironment || 'sandbox',
  });
}
async function persistSeagmSettings(nextSettings) {
  if (!pool) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
  storeSettings = nextSettings;
}
function wamdaClient(){
  if(!wamdaApiTokenRuntime)throw Object.assign(new Error('أدخل Wamda API Token من لوحة الإدارة أولاً.'),{status:400,code:'WAMDA_TOKEN_MISSING'});
  return createWamdaClient({apiToken:wamdaApiTokenRuntime});
}
async function persistWamdaSettings(nextSettings){
  if(!pool)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
  storeSettings=nextSettings;applyStoreSettings();
}
function getWamdaPricingContext(settings=storeSettings){
  const stored=settings?.wamdaPricingPolicy;
  const globalRule=stored&&['percent','fixed_profit','fixed_price'].includes(stored.mode)
    ?normalizeWamdaPricingRule(stored)
    :{mode:'percent',value:normalizeWamdaMargin(settings?.wamdaProfitMarginPercent??0)};
  return {
    fxRate:Number(settings?.fxRate||145),
    globalRule,
    categoryPolicies:settings?.wamdaCategoryPricingPolicies&&typeof settings.wamdaCategoryPricingPolicies==='object'?settings.wamdaCategoryPricingPolicies:{},
  };
}
function getWamdaProductOverride(source,existing){
  if(source?.pricingOverride)return source.pricingOverride;
  if(existing?.wamda?.pricingOverride)return existing.wamda.pricingOverride;
  if(existing?.wamda?.priceMode==='manual'&&Number(existing.wamda.manualPriceSyp)>0){
    return {mode:'fixed_price',value:Number(existing.wamda.manualPriceSyp)};
  }
  return {mode:'inherit'};
}
function resolveWamdaProductPricing(source,settings=storeSettings,existing=null){
  const context=getWamdaPricingContext(settings);
  const categoryRule=context.categoryPolicies[String(source?.categoryId??existing?.wamda?.categoryId??'')];
  return resolveWamdaPricingRule({
    globalRule:context.globalRule,
    categoryRule:categoryRule||null,
    productRule:getWamdaProductOverride(source,existing),
  });
}
function buildWamdaAdminCategories(categories,publishedCatalog=catalog,settings=storeSettings){
  const published=new Map();
  for(const category of publishedCatalog||[]) for(const product of category.items||[]){
    if(product.wamda?.provider==='wamda')published.set(Number(product.wamda.productId),product);
  }
  const context=getWamdaPricingContext(settings);
  return (Array.isArray(categories)?categories:[]).map(category=>{
    const categoryPricingPolicy=context.categoryPolicies[String(category.id)]||{mode:'inherit'};
    return {
      ...category,
      pricingPolicy:categoryPricingPolicy,
      products:(category.products||[]).map(source=>{
        const existing=published.get(Number(source.id));
        const resolved=resolveWamdaProductPricing(source,settings,existing);
        let calculatedSellPriceSyp=Number(source.calculatedSellPriceSyp||0);
        try{calculatedSellPriceSyp=calculateWamdaSellPriceSyp({unitPriceUsd:source.unitPrice,fxRate:context.fxRate,pricingRule:resolved.rule});}catch{}
        const pricingOverride=getWamdaProductOverride(source,existing);
        return {...source,pricingOverride,resolvedPricingRule:resolved.rule,pricingSource:resolved.source,
          calculatedSellPriceSyp,published:Boolean(existing),
          currentPriceSyp:existing?.options?.[0]?.packs?.[0]?.[1]??calculatedSellPriceSyp,
          priceMode:resolved.rule.mode==='fixed_price'?'manual':'auto',
          manualPriceSyp:pricingOverride.mode==='fixed_price'?pricingOverride.value:null,
          available:source.available!==false};
      }),
    };
  });
}
async function persistWamdaSnapshot(nextCatalog,nextSettings){
  if(!pool)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  await pool.query("UPDATE nexa_store_state SET catalog=$1::jsonb,settings=$2::jsonb,updated_at=NOW() WHERE singleton=TRUE",
    [JSON.stringify(nextCatalog),JSON.stringify(nextSettings)]);
  catalog=nextCatalog;storeSettings=nextSettings;applyStoreSettings();
}
async function repricePublishedWamdaProducts(nextSettings=storeSettings){
  const context=getWamdaPricingContext(nextSettings);
  const sources=new Map();
  for(const category of nextSettings?.wamdaCatalogCache||[])for(const product of category.products||[])sources.set(Number(product.id),product);
  let changed=false;
  const nextCatalog=catalog.map(category=>({
    ...category,
    items:(category.items||[]).map(existing=>{
      if(existing.wamda?.provider!=='wamda')return existing;
      const source=sources.get(Number(existing.wamda.productId))||{
        id:existing.wamda.productId,categoryId:existing.wamda.categoryId,unitPrice:existing.wamda.unitPrice,
        pricingOverride:existing.wamda.pricingOverride||{mode:'inherit'},available:existing.wamda.available,
      };
      try{
        const updated=updateWamdaPublishedProduct(existing,source,{
          fxRate:context.fxRate,globalRule:context.globalRule,
          categoryRule:context.categoryPolicies[String(source.categoryId??existing.wamda.categoryId)]||null,
          syncedAt:nextSettings?.wamdaLastSyncAt||new Date().toISOString(),
        });
        if(JSON.stringify(updated)!==JSON.stringify(existing))changed=true;
        return updated;
      }catch(error){return {...existing,wamda:{...existing.wamda,pricingError:String(error?.code||error?.message||'WAMDA_PRICE_ERROR').slice(0,120)}};}
    }),
  }));
  if(changed||nextSettings!==storeSettings)await persistWamdaSnapshot(nextCatalog,nextSettings);
  return {updated:changed};
}

async function testWamdaConnection(){
  const account=await wamdaClient().getProfile(),testedAt=new Date().toISOString();
  await persistWamdaSettings({...storeSettings,wamdaAccountInfo:account,wamdaLastTestAt:testedAt,wamdaLastError:''});
  return {ok:true,account,testedAt};
}
async function refreshWamdaCatalog({source='manual'}={}){
  if(wamdaCatalogSyncInProgress||wamdaBulkPublishInProgress)throw Object.assign(new Error('توجد عملية مزامنة أو نشر جماعي قيد التنفيذ.'),{status:409});
  if(!wamdaApiTokenRuntime)throw Object.assign(new Error('أدخل Wamda API Token من لوحة الإدارة أولاً.'),{status:400,code:'WAMDA_TOKEN_MISSING'});
  wamdaCatalogSyncInProgress=true;
  const attemptedAt=new Date().toISOString();
  try{
    await persistWamdaSettings({...storeSettings,wamdaLastRefreshAttemptAt:attemptedAt,wamdaLastError:''});
    const client=wamdaClient();
    const [account,snapshot]=await Promise.all([client.getProfile(),client.getProducts({limit:1000})]);
    const groups=new Map(),remoteIds=new Set();
    for(const product of snapshot.products){
      const categoryId=Number(product.categoryId||0);
      remoteIds.add(Number(product.id));
      if(!groups.has(categoryId))groups.set(categoryId,{id:categoryId,name:product.categoryName||'متفرقات',products:[]});
      groups.get(categoryId).products.push(product);
    }
    const categories=Array.from(groups.values()).sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    const previous=Array.isArray(storeSettings?.wamdaCatalogCache)?storeSettings.wamdaCatalogCache:[];
    const previousProducts=new Map(previous.flatMap(category=>(category.products||[]).map(product=>[Number(product.id),product])));
    for(const category of categories)category.products=category.products.map(product=>({
      ...product,...(previousProducts.get(Number(product.id))?.pricingOverride?{pricingOverride:previousProducts.get(Number(product.id)).pricingOverride}:{ }),
    }));
    const categoryById=new Map(categories.map(category=>[Number(category.id),category]));
    for(const oldCategory of previous){
      for(const oldProduct of oldCategory.products||[]){
        if(remoteIds.has(Number(oldProduct.id)))continue;
        let target=categoryById.get(Number(oldProduct.categoryId||oldCategory.id));
        if(!target){
          target={id:Number(oldProduct.categoryId||oldCategory.id),name:String(oldProduct.categoryName||oldCategory.name||'متفرقات'),products:[]};
          categories.push(target);categoryById.set(Number(target.id),target);
        }
        target.products.push({...oldProduct,available:false,missingFromLatestSync:true});
      }
    }
    const syncedAt=new Date().toISOString();
    const pricingContext=getWamdaPricingContext();
    const {fxRate,globalRule,categoryPolicies}=pricingContext;
    const remoteById=new Map(snapshot.products.map(product=>[Number(product.id),product]));
    let updatedPublished=0,unavailablePublished=0,manualOverrides=0;
    const nextCatalog=catalog.map(category=>({
      ...category,
      items:(category.items||[]).map(existing=>{
        if(existing.wamda?.provider!=='wamda')return existing;
        const current=remoteById.get(Number(existing.wamda.productId));
        if(!current){
          unavailablePublished++;
          const next=markWamdaProductUnavailable(existing,syncedAt);
          if(JSON.stringify(next)!==JSON.stringify(existing))updatedPublished++;
          return next;
        }
        try{
          const next=updateWamdaPublishedProduct(existing,current,{
            fxRate,globalRule,categoryRule:categoryPolicies[String(current.categoryId)]||null,syncedAt,
          });
          updatedPublished++;
          if(next.wamda.priceMode==='manual')manualOverrides++;
          if(!next.wamda.available)unavailablePublished++;
          return next;
        }catch(error){
          unavailablePublished++;
          return {...existing,wamda:{...existing.wamda,available:false,pricingError:String(error?.code||error?.message||'WAMDA_PRICE_ERROR').slice(0,120),lastSyncedAt:syncedAt}};
        }
      }),
    }));
    const enriched=buildWamdaAdminCategories(categories,nextCatalog,storeSettings);
    if(Buffer.byteLength(JSON.stringify(enriched),'utf8')>4_000_000)throw new Error('WAMDA_CATALOG_TOO_LARGE');
    const nextSettings={...storeSettings,wamdaAccountInfo:account,wamdaCatalogCache:enriched,
      wamdaLastSyncAt:syncedAt,wamdaLastRefreshAttemptAt:attemptedAt,wamdaLastError:''};
    await persistWamdaSnapshot(nextCatalog,nextSettings);
    return {ok:true,source,account,syncedAt,pagesFetched:snapshot.pagesFetched,
      stats:{categories:categories.length,products:snapshot.products.length,
        available:snapshot.products.filter(row=>row.available).length,updatedPublished,unavailablePublished,manualOverrides},
      categories:enriched};
  }catch(error){
    await persistWamdaSettings({...storeSettings,wamdaLastRefreshAttemptAt:attemptedAt,wamdaLastError:String(error?.message||'WAMDA_SYNC_FAILED').slice(0,300)}).catch(()=>{});
    throw error;
  }finally{wamdaCatalogSyncInProgress=false;}
}
async function publishWamdaProduct(input){
  if(wamdaBulkPublishInProgress)throw Object.assign(new Error('انتظر انتهاء النشر الجماعي قبل تعديل منتج منفرد.'),{status:409});
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('INVALID_WAMDA_PUBLISH_REQUEST');
  const categoryId=Number(input.categoryId),productId=Number(input.productId);
  if(!Number.isSafeInteger(categoryId)||categoryId<0||!Number.isSafeInteger(productId)||productId<=0)throw new Error('INVALID_WAMDA_PRODUCT_ID');
  const categories=Array.isArray(storeSettings?.wamdaCatalogCache)?storeSettings.wamdaCatalogCache:[];
  const sourceCategory=categories.find(row=>Number(row.id)===categoryId);
  const sourceProduct=sourceCategory?.products?.find(row=>Number(row.id)===productId);
  if(!sourceProduct)throw Object.assign(new Error('المنتج غير موجود في آخر مزامنة ومضة. حدّث المنتجات أولاً.'),{status:404});
  if(!sourceProduct.available)throw Object.assign(new Error('المنتج غير متاح حالياً لدى ومضة.'),{status:409});
  const hasManualPrice=input.sellPriceSyp!==undefined&&String(input.sellPriceSyp).trim()!=='';
  let manualPriceSyp=null;
  if(hasManualPrice){
    const priceText=String(input.sellPriceSyp).trim();
    if(!/^[0-9]{1,9}(?:\.[0-9]{1,2})?$/.test(priceText))throw new Error('INVALID_WAMDA_SELL_PRICE');
    manualPriceSyp=Number(priceText);
    if(!Number.isFinite(manualPriceSyp)||manualPriceSyp<=0||manualPriceSyp>1_000_000_000)throw new Error('INVALID_WAMDA_SELL_PRICE');
  }
  const localCategoryId='wamda-category-'+categoryId,localProductId='wamda-'+productId;
  let workingCatalog=catalog;
  if(!workingCatalog.some(row=>row.id===localCategoryId))workingCatalog=validateCatalog([...workingCatalog,{id:localCategoryId,name:String(sourceCategory.name||'منتجات ومضة').slice(0,100),desc:'منتجات رقمية متزامنة مع ومضة ستور.',image:'assets/brand/logo.svg',icon:'⚡',items:[]}]);
  const existing=workingCatalog.flatMap(category=>category.items||[]).find(product=>product.id===localProductId);
  const previousOverride=getWamdaProductOverride(sourceProduct,existing);
  const pricingOverride=hasManualPrice?{mode:'fixed_price',value:manualPriceSyp}
    :(input.resetToAutomatic===true?{mode:'inherit'}:previousOverride);
  const updatedSource={...sourceProduct,pricingOverride};
  const nextSettings={
    ...storeSettings,
    wamdaCatalogCache:categories.map(category=>Number(category.id)!==categoryId?category:{
      ...category,products:(category.products||[]).map(product=>Number(product.id)===productId?updatedSource:product),
    }),
  };
  const base=existing||{
    id:localProductId,name:String(sourceProduct.name||('Wamda product '+productId)).slice(0,120),
    desc:String(sourceProduct.description||'منتج رقمي مرتبط بمصدر ومضة.').slice(0,700),image:'assets/brand/logo.svg',
    options:[{id:'wamda-default',name:'الخيار الأساسي',desc:'منتج مرتبط بمصدر ومضة',flag:'⚡',packs:[['سعر البيع',1]]}],
  };
  const updated=updateWamdaPublishedProduct({...base,wamda:{...(base.wamda||{}),provider:'wamda',pricingOverride}},
    updatedSource,{
      fxRate:Number(nextSettings.fxRate||145),
      globalRule:getWamdaPricingContext(nextSettings).globalRule,
      categoryRule:getWamdaPricingContext(nextSettings).categoryPolicies[String(categoryId)]||null,
      forceAutomatic:input.resetToAutomatic===true,
    });
  const result=upsertCatalogProduct(workingCatalog,localCategoryId,updated);
  await persistWamdaSnapshot(result.catalog,nextSettings);
  const finalPrice=updated.options?.[0]?.packs?.[0]?.[1]??null;
  return {ok:true,created:result.created,categoryId:localCategoryId,productId:result.productId,sellPriceSyp:finalPrice,
    priceMode:updated.wamda.priceMode,calculatedPriceSyp:updated.wamda.calculatedPriceSyp,
    message:result.created?'تم نشر المنتج وفق سياسة التسعير التلقائية الحالية.':(updated.wamda.priceMode==='manual'?'تم تثبيت سعر البيع لهذا المنتج.':'تم إرجاع المنتج إلى تسعير القسم أو المتجر التلقائي.')};
}
function parseWamdaPricingOverride(mode,value){
  if(mode==='inherit')return {mode:'inherit'};
  return normalizeWamdaPricingRule({mode,value});
}
async function setWamdaProductPricing(input){
  if(wamdaBulkPublishInProgress)throw Object.assign(new Error('انتظر انتهاء النشر الجماعي قبل تعديل تسعير منتج.'),{status:409});
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('INVALID_WAMDA_PRODUCT_PRICING');
  const categoryId=Number(input.categoryId),productId=Number(input.productId);
  if(!Number.isSafeInteger(categoryId)||categoryId<0||!Number.isSafeInteger(productId)||productId<=0)throw new Error('INVALID_WAMDA_PRODUCT_ID');
  const override=parseWamdaPricingOverride(String(input.mode||''),input.value);
  const categories=Array.isArray(storeSettings?.wamdaCatalogCache)?storeSettings.wamdaCatalogCache:[];
  const sourceCategory=categories.find(row=>Number(row.id)===categoryId);
  const sourceProduct=sourceCategory?.products?.find(row=>Number(row.id)===productId);
  if(!sourceProduct)throw Object.assign(new Error('المنتج غير موجود في الكتالوج المستورد.'),{status:404});
  const updatedSource={...sourceProduct,pricingOverride:override};
  const nextSettings={...storeSettings,wamdaCatalogCache:categories.map(category=>Number(category.id)!==categoryId?category:{
    ...category,products:(category.products||[]).map(product=>Number(product.id)===productId?updatedSource:product),
  })};
  const productKey='wamda-'+productId;
  let nextCatalog=catalog;
  let sellPriceSyp=null;
  let resolvedPricingRule=null;
  nextCatalog=catalog.map(category=>({...category,items:(category.items||[]).map(existing=>{
    if(existing.wamda?.provider!=='wamda'||Number(existing.wamda.productId)!==productId)return existing;
    const updated=updateWamdaPublishedProduct({...existing,wamda:{...existing.wamda,pricingOverride:override}},updatedSource,{
      fxRate:Number(nextSettings.fxRate||145),globalRule:getWamdaPricingContext(nextSettings).globalRule,
      categoryRule:getWamdaPricingContext(nextSettings).categoryPolicies[String(categoryId)]||null,
    });
    sellPriceSyp=updated.options?.[0]?.packs?.[0]?.[1]??null;
    resolvedPricingRule=updated.wamda.resolvedPricingRule;
    return updated;
  })}));
  await persistWamdaSnapshot(nextCatalog,nextSettings);
  return {ok:true,productId:productKey,pricingOverride:override,sellPriceSyp,resolvedPricingRule,
    message:override.mode==='inherit'?'تم ربط المنتج بتسعير القسم أو المتجر.':override.mode==='fixed_price'?'تم تثبيت سعر البيع لهذا المنتج.':'تم حفظ قاعدة التسعير التلقائي الخاصة بالمنتج.'};
}
async function setWamdaCategoryPricing(input){
  if(wamdaBulkPublishInProgress)throw Object.assign(new Error('انتظر انتهاء النشر الجماعي قبل تعديل سياسة قسم.'),{status:409});
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('INVALID_WAMDA_CATEGORY_PRICING');
  const categoryId=Number(input.categoryId);
  if(!Number.isSafeInteger(categoryId)||categoryId<0)throw new Error('INVALID_WAMDA_CATEGORY_ID');
  const mode=String(input.mode||'');
  if(!['inherit','percent','fixed_profit','fixed_price'].includes(mode))throw new Error('INVALID_WAMDA_CATEGORY_PRICING_MODE');
  const rule=parseWamdaPricingOverride(mode,input.value);
  const policies={...(storeSettings?.wamdaCategoryPricingPolicies||{})};
  if(mode==='inherit')delete policies[String(categoryId)];
  else policies[String(categoryId)]=rule;
  const nextSettings={...storeSettings,wamdaCategoryPricingPolicies:policies};
  await repricePublishedWamdaProducts(nextSettings);
  return {ok:true,categoryId,pricingPolicy:rule,message:mode==='inherit'?'القسم يستخدم تسعير المتجر العام الآن.':mode==='fixed_price'?'تم تثبيت سعر البيع نفسه لكل منتجات هذا القسم.':'تم حفظ سياسة التسعير التلقائي للقسم.'};
}
async function applyWamdaGlobalPricingToAll(){
  if(wamdaBulkPublishInProgress||wamdaCatalogSyncInProgress)
    throw Object.assign(new Error('توجد عملية مزامنة أو نشر جماعي قيد التنفيذ. حاول بعد انتهائها.'),{status:409});
  if(!pool)throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  const cached=Array.isArray(storeSettings?.wamdaCatalogCache)?storeSettings.wamdaCatalogCache:[];
  if(!cached.length)throw Object.assign(new Error('WAMDA_CATALOG_CACHE_EMPTY'),{status:409});
  wamdaBulkPublishInProgress=true;
  const syncedAt=storeSettings?.wamdaLastSyncAt||new Date().toISOString();
  try{
    const categories=cached.map(category=>({...category,products:(category.products||[]).map(product=>({...product,pricingOverride:{mode:'inherit'}}))}));
    const nextSettings={...storeSettings,wamdaCategoryPricingPolicies:{},wamdaCatalogCache:categories};
    const context=getWamdaPricingContext(nextSettings);
    const nextCatalog=catalog.map(category=>({...category,items:[...(category.items||[])]}));
    const categoryIndexes=new Map(nextCatalog.map((category,index)=>[category.id,index]));
    const productLocations=new Map();
    for(let categoryIndex=0;categoryIndex<nextCatalog.length;categoryIndex++){
      const items=nextCatalog[categoryIndex].items||[];
      for(let itemIndex=0;itemIndex<items.length;itemIndex++){
        const item=items[itemIndex];
        if(item.wamda?.provider==='wamda')productLocations.set(Number(item.wamda.productId),{categoryIndex,itemIndex});
      }
    }
    let availableProducts=0,publishedNew=0,updatedExisting=0,skippedUnavailable=0,skippedInvalidPrice=0,skippedInvalidProduct=0;
    for(const sourceCategory of categories){
      const categoryId=Number(sourceCategory.id);
      if(!Number.isSafeInteger(categoryId)||categoryId<0){skippedInvalidProduct+=(sourceCategory.products||[]).length;continue;}
      const localCategoryId='wamda-category-'+categoryId;
      for(const rawProduct of sourceCategory.products||[]){
        if(rawProduct.available!==true){skippedUnavailable++;continue;}
        availableProducts++;
        const productId=Number(rawProduct.id);
        if(!Number.isSafeInteger(productId)||productId<=0){skippedInvalidProduct++;continue;}
        const source={...rawProduct,id:productId,categoryId:Number(rawProduct.categoryId??categoryId),pricingOverride:{mode:'inherit'}};
        const localProductId='wamda-'+productId;
        const location=productLocations.get(productId);
        const existing=location?nextCatalog[location.categoryIndex].items[location.itemIndex]:null;
        const base=existing||{
          id:localProductId,
          name:String(source.name||('Wamda product '+productId)).slice(0,120),
          desc:String(source.description||'منتج رقمي متزامن مع مورد ومضة.').slice(0,700),
          image:'assets/brand/logo.svg',
          options:[{id:'wamda-default',name:'الخيار الأساسي',desc:'منتج مرتبط بمصدر ومضة',flag:'⚡',packs:[['سعر البيع',1]]}],
        };
        let updated;
        try{
          updated=updateWamdaPublishedProduct({...base,wamda:{...(base.wamda||{}),provider:'wamda',pricingOverride:{mode:'inherit'}}},source,{
            fxRate:context.fxRate,globalRule:context.globalRule,categoryRule:null,
            syncedAt,forceAutomatic:true,
          });
          const calculated=Number(updated?.wamda?.calculatedPriceSyp);
          const actual=Number(updated?.options?.[0]?.packs?.[0]?.[1]);
          if(!Number.isFinite(calculated)||calculated<=0||!Number.isFinite(actual)||actual<=0)throw new Error('INVALID_WAMDA_CALCULATED_PRICE');
        }catch{
          skippedInvalidPrice++;
          continue;
        }
        if(location){
          nextCatalog[location.categoryIndex].items[location.itemIndex]=updated;
          updatedExisting++;
        }else{
          let categoryIndex=categoryIndexes.get(localCategoryId);
          if(categoryIndex===undefined){
            const displayName=String(sourceCategory.name||'منتجات ومضة').slice(0,100)||'منتجات ومضة';
            nextCatalog.push({id:localCategoryId,name:displayName,desc:'منتجات رقمية متزامنة مع ومضة ستور.',image:'assets/brand/logo.svg',icon:'⚡',items:[]});
            categoryIndex=nextCatalog.length-1;
            categoryIndexes.set(localCategoryId,categoryIndex);
          }
          const itemIndex=nextCatalog[categoryIndex].items.push(updated)-1;
          productLocations.set(productId,{categoryIndex,itemIndex});
          publishedNew++;
        }
      }
    }
    const validatedCatalog=validateCatalog(nextCatalog);
    const catalogBytes=Buffer.byteLength(JSON.stringify(validatedCatalog),'utf8');
    if(catalogBytes>15_000_000)throw Object.assign(new Error('WAMDA_PUBLISHED_CATALOG_TOO_LARGE'),{status:413});
    await persistWamdaSnapshot(validatedCatalog,nextSettings);
    const publishedTotal=validatedCatalog.reduce((sum,category)=>sum+(category.items||[]).filter(item=>item.wamda?.provider==='wamda').length,0);
    return {
      ok:true,
      stats:{categories:categories.length,cachedProducts:categories.reduce((sum,category)=>sum+(category.products||[]).length,0),
        availableProducts,publishedNew,updatedExisting,publishedTotal,skippedUnavailable,skippedInvalidPrice,skippedInvalidProduct,
        fxRate:context.fxRate,globalPricingRule:context.globalRule,catalogBytes},
      syncedAt,
      message:'تم تطبيق سياسة الربح العامة وإعادة حساب أسعار المنتجات المؤهلة ونشرها في المتجر.',
    };
  }finally{wamdaBulkPublishInProgress=false;}
}
async function testSeagmConnection() {
  const account = await seagmClient().getAccount();
  const testedAt = new Date().toISOString();
  const nextSettings = { ...storeSettings,seagmAccountInfo:account,seagmLastTestAt:testedAt,seagmLastError:'' };
  await persistSeagmSettings(nextSettings);
  return { ok:true,account,testedAt,environment:storeSettings.seagmEnvironment || 'sandbox' };
}
async function refreshSeagmCatalog() {
  if (seagmCatalogSyncInProgress) throw Object.assign(new Error('SEAGM_SYNC_IN_PROGRESS'),{status:409});
  seagmCatalogSyncInProgress = true;
  try {
    const client = seagmClient();
    const account = await client.getAccount();
    const snapshot = await client.getCatalog();
    const serialized = JSON.stringify(snapshot.categories);
    if (Buffer.byteLength(serialized,'utf8') > 3000000) throw new Error('SEAGM_CATALOG_SNAPSHOT_TOO_LARGE');
    const syncedAt = new Date().toISOString();
    const nextSettings = {
      ...storeSettings,
      seagmAccountInfo:account,
      seagmCatalogCache:snapshot.categories,
      seagmLastSyncAt:syncedAt,
      seagmLastError:'',
    };
    await persistSeagmSettings(nextSettings);
    return { ok:true,stats:snapshot.stats,syncedAt,account,environment:storeSettings.seagmEnvironment || 'sandbox',categories:snapshot.categories };
  } catch (error) {
    const nextSettings = { ...storeSettings,seagmLastError:String(error?.message || 'SEAGM_SYNC_FAILED').slice(0,300) };
    await persistSeagmSettings(nextSettings).catch(()=>{});
    throw error;
  } finally {
    seagmCatalogSyncInProgress = false;
  }
}
async function publishSeagmProduct(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SEAGM_PUBLISH_REQUEST');
  const kind = String(input.kind || '');
  if (!['card','recharge'].includes(kind)) throw new Error('INVALID_SEAGM_PRODUCT_KIND');
  const categoryId = Number(input.categoryId);
  const productId = Number(input.productId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0 || !Number.isSafeInteger(productId) || productId <= 0) {
    throw new Error('INVALID_SEAGM_PRODUCT_ID');
  }
  const priceText = String(input.sellPriceSyp ?? '').trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(priceText)) throw new Error('INVALID_SEAGM_SELL_PRICE');
  const sellPrice = Number(priceText);
  if (!Number.isFinite(sellPrice) || sellPrice <= 0 || sellPrice > 1000000000) throw new Error('INVALID_SEAGM_SELL_PRICE');

  const categories = Array.isArray(storeSettings?.seagmCatalogCache) ? storeSettings.seagmCatalogCache : [];
  const sourceCategory = categories.find(row => row.kind === kind && Number(row.id) === categoryId);
  const sourceProduct = sourceCategory?.products?.find(row => Number(row.id) === productId);
  if (!sourceProduct) throw Object.assign(new Error('المنتج غير موجود في آخر مزامنة SEAGM. حدّث المنتجات أولاً.'),{status:404});
  if (sourceProduct.inStock === false) throw Object.assign(new Error('المنتج غير متوفر حالياً لدى SEAGM.'),{status:409});

  const localCategoryId = 'seagm-' + kind + '-' + categoryId;
  const localProductId = 'seagm-' + kind + '-' + productId;
  let workingCatalog = catalog;
  if (!workingCatalog.some(row => row.id === localCategoryId)) {
    workingCatalog = validateCatalog([...workingCatalog,{
      id:localCategoryId,
      name:String(sourceCategory.name || (kind === 'card' ? 'بطاقات SEAGM' : 'شحن SEAGM')).slice(0,100),
      desc:'منتجات مستوردة من مورد SEAGM. حدّد سعر البيع المحلي من لوحة الإدارة.',
      image:'assets/brand/logo.svg',
      icon:kind === 'card' ? '▣' : '◈',
      items:[],
    }]);
  }
  const sourceCurrency = String(sourceProduct.currency || '').slice(0,12).toUpperCase();
  const retailProduct = {
    id:localProductId,
    name:String(sourceProduct.name || ('SEAGM product ' + productId)).slice(0,120),
    desc:('SEAGM ' + (kind === 'card' ? 'بطاقة رقمية' : 'شحن مباشر') + ' · Supplier #' + productId + (sourceCurrency ? ' · تكلفة المورد ' + sourceProduct.unitPrice + ' ' + sourceCurrency : '')).slice(0,700),
    image:'assets/brand/logo.svg',
    options:[{
      id:'seagm-default',
      name:'الخيار الأساسي',
      desc:'منتج مرتبط بمصدر SEAGM',
      flag:'✦',
      packs:[['سعر البيع',sellPrice]],
    }],
    seagm:{
      provider:'seagm',
      kind,
      categoryId,
      typeId:productId,
      sourceCurrency,
      sourceUnitPrice:Number(sourceProduct.unitPrice || 0),
      minimumQuantity:Number(sourceProduct.minAmount || 1),
      maximumQuantity:Number(sourceProduct.maxAmount || 1),
      fields:Array.isArray(sourceProduct.fields) ? sourceProduct.fields : [],
      autoDelivery:sourceProduct.autoDelivery === true,
    },
  };
  const result = upsertCatalogProduct(workingCatalog,localCategoryId,retailProduct);
  await persistCatalog(result.catalog);
  return {
    ok:true,
    created:result.created,
    categoryId:localCategoryId,
    productId:result.productId,
    sellPriceSyp:sellPrice,
    supplier:{kind,categoryId,productId,currency:sourceCurrency,unitPrice:sourceProduct.unitPrice},
    message:result.created ? 'تم نشر المنتج في كتالوج المتجر.' : 'تم تحديث المنتج وسعر بيعه في كتالوج المتجر.',
  };
}


function seagmErrorMessage(error) {
  const code=Number(error?.code);
  const messages={
    20062:'المنتج غير متاح لدى SEAGM حالياً.',
    20071:'خدمة البطاقات غير مفعّلة لحساب SEAGM.',
    20072:'خدمة الشحن المباشر غير مفعّلة لحساب SEAGM.',
    20073:'حساب SEAGM لا يملك صلاحية شراء هذا المنتج.',
    20077:'نوع البطاقة غير موجود لدى SEAGM.',
    20079:'المنتج غير موجود لدى SEAGM.',
    20080:'لم يعثر SEAGM على الطلب السابق.',
    20107:'الكمية المطلوبة تتجاوز المخزون.',
    20115:'الحساب غير مسموح له بإجراء عملية الشراء.',
    20116:'حساب الشحن مقيّد لدى المورد.',
    20121:'الكمية أقل من الحد الأدنى المسموح.',
    20124:'كمية الشراء غير صالحة لدى المورد.',
    20125:'نفد مخزون المنتج لدى المورد.',
    20126:'نوع المنتج لا يقبل الشحن المباشر.',
    20129:'رصيد Credits لدى SEAGM غير كافٍ أو مبلغ الطلب غير صالح.',
    20133:'بيانات اللاعب أو الحساب غير مقبولة لدى المورد.',
    20134:'فشل التحقق من بيانات حساب الشحن.',
    20135:'رقم طلب المتجر موجود مسبقاً لدى المورد؛ جارٍ استعادة الطلب الأصلي.',
  };
  return messages[code]||String(error?.message||'تعذر تنفيذ طلب المورد.').slice(0,240);
}

async function claimSeagmFulfillmentJob() {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const result=await client.query(`
      SELECT j.order_id,j.attempt_count,j.failure_count,o.supplier_kind,o.supplier_type_id,o.supplier_quantity,
        o.supplier_fields,o.supplier_mch_order_id,o.supplier_order_id,o.supplier_provider
      FROM nexa_fulfillment_jobs j
      JOIN nexa_orders o ON o.id=j.order_id
      WHERE j.status IN ('pending','retry','processing')
        AND j.next_attempt_at<=NOW()
        AND (j.status<>'processing' OR j.locked_at<NOW()-INTERVAL '4 minutes')
      ORDER BY j.next_attempt_at ASC,j.created_at ASC
      FOR UPDATE OF j SKIP LOCKED LIMIT 1`);
    if(!result.rowCount){await client.query('COMMIT');return null;}
    const job=result.rows[0];
    await client.query(`UPDATE nexa_fulfillment_jobs
      SET status='processing',attempt_count=attempt_count+1,locked_at=NOW(),updated_at=NOW()
      WHERE order_id=$1`,[job.order_id]);
    await client.query('COMMIT');
    return {...job,attempt_count:Number(job.attempt_count)+1,failure_count:Number(job.failure_count||0)};
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}

async function saveSeagmFulfillmentState(job,{jobStatus,orderStatus,message,errorText='',metadata=null,resultEncrypted='',delaySeconds=0,failureCount=null}={}) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE nexa_fulfillment_jobs SET
      status=$2,last_error=$3,provider_order_id=$4,provider_status_code=$5,provider_status=$6,
      provider_response=$7::jsonb,next_attempt_at=NOW()+($8::text || ' seconds')::interval,
      failure_count=COALESCE($9,failure_count),locked_at=NULL,updated_at=NOW()
      WHERE order_id=$1`,[
        job.order_id,jobStatus,String(errorText||'').slice(0,500),
        metadata?.id||job.provider_order_id||null,metadata?.status_code??null,
        metadata?.status||'',JSON.stringify(metadata||{}),Math.max(0,Number(delaySeconds)||0),
        failureCount === null ? null : Math.max(0,Number(failureCount)||0),
      ]);
    await client.query(`UPDATE nexa_orders SET
      supplier_status=$2,supplier_message=$3,
      supplier_order_id=COALESCE($4,supplier_order_id),
      supplier_result_encrypted=CASE WHEN $5<>'' THEN $5 ELSE supplier_result_encrypted END,
      supplier_completed_at=CASE WHEN $2='completed' THEN NOW() ELSE supplier_completed_at END
      WHERE id=$1`,[
        job.order_id,orderStatus,String(message||'').slice(0,500),
        metadata?.id||null,resultEncrypted,
      ]);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}

async function processWamdaFulfillmentJob(job){
  if(!wamdaApiTokenRuntime){await saveSeagmFulfillmentState(job,{jobStatus:'manual_review',orderStatus:'manual_review',message:'مفتاح API الخاص بومضة غير مضبوط حالياً. أدخله من لوحة الإدارة لمتابعة الطلب.',errorText:'WAMDA_TOKEN_MISSING'});return;}
  const client=wamdaClient(),orderUuid=String(job.supplier_mch_order_id||'');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderUuid)){await saveSeagmFulfillmentState(job,{jobStatus:'manual_review',orderStatus:'manual_review',message:'معرّف طلب ومضة غير صالح؛ تم تحويل الطلب لمراجعة الإدارة.',errorText:'INVALID_WAMDA_ORDER_UUID'});return;}
  let providerOrder=await client.checkOrder(orderUuid,{uuid:true});
  if(!providerOrder)providerOrder=await client.createOrder(Number(job.supplier_type_id),{quantity:Number(job.supplier_quantity||1),fields:job.supplier_fields||{},orderUuid});
  const decision=wamdaOrderDecision(providerOrder),metadata={...decision.metadata,id:decision.metadata?.orderId||decision.metadata?.orderCode||orderUuid};
  if(decision.action==='completed'){await saveSeagmFulfillmentState(job,{jobStatus:'completed',orderStatus:'completed',message:decision.message,metadata,resultEncrypted:encryptSecret(JSON.stringify(decision.result),cfg.settingsEncryptionKey),failureCount:0});return;}
  if(decision.action==='retry'){await saveSeagmFulfillmentState(job,{jobStatus:'retry',orderStatus:'waiting',message:decision.message,metadata,delaySeconds:decision.delaySeconds,failureCount:0});return;}
  await saveSeagmFulfillmentState(job,{jobStatus:'manual_review',orderStatus:'manual_review',message:decision.message,errorText:decision.errorCode,metadata,failureCount:0});
}
async function processSeagmFulfillmentJob(job) {
  if(job.supplier_provider==='wamda')return processWamdaFulfillmentJob(job);
  if(job.supplier_provider!=='seagm'||!['card','recharge'].includes(job.supplier_kind)||
      !Number.isSafeInteger(Number(job.supplier_type_id))||Number(job.supplier_type_id)<=0) {
    await saveSeagmFulfillmentState(job,{
      jobStatus:'manual_review',orderStatus:'manual_review',
      message:'بيانات ربط المنتج مع المورد غير مكتملة. تواصل مع إدارة المتجر.',
      errorText:'INVALID_STORED_SUPPLIER_PRODUCT',
    });
    return;
  }

  const client=seagmClient();
  const merchantOrderId=String(job.supplier_mch_order_id||job.order_id);
  // Always reconcile by the same merchant order ID before creating anything.
  // This makes retries safe when a previous POST timed out after SEAGM accepted it.
  let providerOrder=await client.getOrderByMerchantId(job.supplier_kind,merchantOrderId);
  if(!providerOrder) {
    try {
      providerOrder=job.supplier_kind==='card'
        ? await client.createCardOrder({typeId:Number(job.supplier_type_id),quantity:Number(job.supplier_quantity||1),merchantOrderId})
        : await client.createRechargeOrder({typeId:Number(job.supplier_type_id),quantity:Number(job.supplier_quantity||1),merchantOrderId,fields:job.supplier_fields||{}});
    } catch(createError) {
      // The provider may have accepted the order even if our request timed out or
      // returned a duplicate merchant-order code. Reconcile before considering failure.
      providerOrder=await client.getOrderByMerchantId(job.supplier_kind,merchantOrderId);
      if(!providerOrder) throw createError;
    }
  }

  const decision=evaluateSeagmOrder({
    providerOrder,
    kind:job.supplier_kind,
    merchantOrderId,
    typeId:Number(job.supplier_type_id),
    quantity:Number(job.supplier_quantity||1),
    attemptCount:Number(job.attempt_count||1),
  });

  if(decision.action==='completed') {
    await saveSeagmFulfillmentState(job,{
      jobStatus:'completed',orderStatus:'completed',
      message:decision.message,
      metadata:decision.metadata,
      resultEncrypted:encryptSecret(JSON.stringify(decision.result),cfg.settingsEncryptionKey),
      failureCount:0,
    });
    return;
  }

  if(decision.action==='retry') {
    await saveSeagmFulfillmentState(job,{
      jobStatus:'retry',orderStatus:'waiting',
      message:decision.message,
      metadata:decision.metadata,
      delaySeconds:decision.delaySeconds,
      failureCount:0,
    });
    return;
  }

  await saveSeagmFulfillmentState(job,{
    jobStatus:'manual_review',orderStatus:'manual_review',
    message:decision.message,
    errorText:decision.errorText,
    metadata:decision.metadata,
    failureCount:0,
  });
}
async function runSeagmFulfillmentWorker() {
  if(!pool||seagmFulfillmentWorkerBusy||(!storeSettings?.seagmUid||!seagmSecretRuntime)&&!wamdaApiTokenRuntime)return;
  seagmFulfillmentWorkerBusy=true;
  let job=null;
  try {
    job=await claimSeagmFulfillmentJob();
    if(!job)return;
    await processSeagmFulfillmentJob(job);
  } catch(error) {
    if(!job) {
      console.error('SEAGM fulfillment worker failed to claim a job',String(error?.code||error?.message||'unknown').slice(0,120));
      return;
    }
    const decision=job.supplier_provider==='wamda'?classifyWamdaError(error,Number(job.failure_count||0)):classifySeagmFulfillmentError(error,Number(job.failure_count||0));
    if(decision.action==='retry') {
      await saveSeagmFulfillmentState(job,{
        jobStatus:'retry',orderStatus:'waiting',
        message:decision.message,
        errorText:decision.errorText,
        delaySeconds:decision.delaySeconds,
        failureCount:decision.failureCount,
      }).catch(saveError=>console.error('could not schedule SEAGM retry',String(saveError?.message||'unknown').slice(0,120)));
    } else {
      await saveSeagmFulfillmentState(job,{
        jobStatus:'manual_review',orderStatus:'manual_review',
        message:decision.message,
        errorText:decision.errorText,
        failureCount:decision.failureCount,
      }).catch(saveError=>console.error('could not mark SEAGM manual review',String(saveError?.message||'unknown').slice(0,120)));
    }
  } finally {seagmFulfillmentWorkerBusy=false;}
}
async function cancelPendingOrder(orderId) {
  if (!pool) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  const found = await pool.query("SELECT id,invoice_number FROM nexa_orders WHERE id=$1 AND status='pending_payment' AND expires_at>NOW()",[orderId]);
  if (!found.rowCount) return false;
  if (found.rows[0].invoice_number) await shamApi('DELETE',`/v1/invoices/${encodeURIComponent(found.rows[0].invoice_number)}`);
  const result = await pool.query("UPDATE nexa_orders SET status='cancelled' WHERE id=$1 AND status='pending_payment' AND expires_at>NOW() RETURNING id",[orderId]);
  return Boolean(result.rowCount);
}


const nexaAssistantTools=[
  {type:'function',name:'search_store_catalog',description:'Search publicly visible products in the live Nexa Store catalogue. Use this to find items by product name, game, app, service or category. Never invent availability or prices.',parameters:{type:'object',properties:{query:{type:'string',description:'A product, service, game or category name to search for.'}},required:['query']}},
  {type:'function',name:'get_store_product_details',description:'Get the current public details, options, price packs and availability for a product from the published store catalogue.',parameters:{type:'object',properties:{product_id:{type:'string',description:'The exact product ID returned by search_store_catalog.'}},required:['product_id']}},
  {type:'function',name:'get_store_help_information',description:'Get verified public store information about how ordering and Sham Cash payment verification work, plus support channels.',parameters:{type:'object',properties:{},required:[]}},
];
function publicAssistantProducts(){
  return (Array.isArray(catalog)?catalog:[]).flatMap(category=>(category.items||[]).map(product=>({categoryId:String(category.id),categoryName:String(category.name||''),product})));
}
function assistantToolResult(name,args){
  const rows=publicAssistantProducts();
  if(name==='search_store_catalog'){
    const query=String(args?.query||'').trim().toLowerCase();
    if(!query||query.length>100)return {ok:false,message:'اكتب اسم المنتج أو الخدمة المراد البحث عنها.'};
    const found=rows.map(row=>({...row,score:[row.product.name,row.product.desc,row.categoryName,row.product.id].filter(Boolean).some(value=>String(value).toLowerCase().includes(query))?1:0}))
      .filter(row=>row.score).slice(0,8).map(row=>({id:String(row.product.id),name:String(row.product.name),description:String(row.product.desc||'').slice(0,240),category:row.categoryName,
        available:row.product.wamda?.available!==false,options:(row.product.options||[]).map(option=>({name:option.name,packs:(option.packs||[]).slice(0,12).map(pack=>({name:String(pack[0]),price:Number(pack[1])}))}))}));
    return {ok:true,results:found,total:found.length};
  }
  if(name==='get_store_product_details'){
    const productId=String(args?.product_id||'');
    const row=rows.find(item=>String(item.product.id)===productId);
    if(!row)return {ok:false,message:'لم يتم العثور على هذا المنتج ضمن الكتالوج المنشور.'};
    return {ok:true,product:{id:String(row.product.id),name:String(row.product.name),description:String(row.product.desc||'').slice(0,700),
      category:row.categoryName,available:row.product.wamda?.available!==false,
      options:(row.product.options||[]).map(option=>({name:String(option.name),description:String(option.desc||''),packs:(option.packs||[]).map(pack=>({name:String(pack[0]),price:Number(pack[1])}))}))}};
  }
  if(name==='get_store_help_information'){
    return {ok:true,store:'Nexa Store',currency:'الليرة السورية الجديدة',payment:'تُنشأ فاتورة شام كاش من الخادم، ولا يعتمد الدفع إلا بعد التحقق من رقم العملية والمبلغ والعملة ومحفظة الفاتورة وصلاحيتها. لا ترسل كلمة المرور أو OTP أو بيانات البطاقة إلى الدعم أو المساعد.',
      fulfillment:'بعد تأكيد الدفع يرسل الخادم طلب المورد المرتبط بالمنتج ويتابع حالته. قد يحتاج الطلب إلى مراجعة عند وجود مشكلة لدى المورد؛ لا تعد العميل بتسليم فوري قبل تأكيد الحالة.',
      support:{whatsapp:'https://wa.me/963936382101',email:'support.nsde@gmail.com'},
      steps:['اختر منتجاً منشوراً ومتوفراً','اختر المنطقة أو الخطة والباقة','أنشئ الطلب واستلم فاتورة الخادم','حوّل المبلغ الظاهر إلى محفظة الفاتورة','أدخل رقم العملية للتحقق من الدفع']};
  }
  return {ok:false,message:'الأداة المطلوبة غير متاحة.'};
}
function assistantTextFromInteraction(payload){
  if(typeof payload?.output_text==='string'&&payload.output_text.trim())return payload.output_text.trim();
  const steps=Array.isArray(payload?.steps)?payload.steps:[];
  for(let i=steps.length-1;i>=0;i--){
    const content=steps[i]?.content;
    if(Array.isArray(content)){
      const text=content.filter(part=>part?.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n').trim();
      if(text&&steps[i].type!=='function_call')return text;
    }
  }
  return '';
}
async function callNexaGeminiInteraction(history,{test=false}={}){
  if(!nexaAiApiKeyRuntime)throw Object.assign(new Error('مساعد Nexa غير مفعّل بعد. أضف مفتاح Gemini API من لوحة الإدارة.'),{status:503,code:'NEXA_AI_NOT_CONFIGURED'});
  const model=String(storeSettings?.nexaAiModel||'gemini-3.6-flash');
  const systemInstruction=[
    'أنت مساعد Nexa Store لخدمة العملاء باللغة العربية، ويمكنك استخدام لهجة عربية بسيطة ومفهومة.',
    'اعتمد على أدوات الكتالوج والمعلومات الموثوقة فقط عند الحديث عن منتجات المتجر أو الأسعار أو التوفر أو الدفع.',
    'لا تخترع منتجات أو أسعاراً أو مواعيد تسليم أو حالة طلبات. إذا لم تظهر معلومة في نتيجة الأداة فقل إنك لا تستطيع تأكيدها.',
    'لا تطلب كلمة مرور أو رمز OTP أو بيانات بطاقة أو رقم معاملة الدفع في المحادثة. لا تحاول إنشاء فاتورة أو إجراء دفع أو تعديل أسعار أو الوصول لطلبات الأفراد.',
    'أنت لا تملك صلاحية إنشاء طلب أو إلغاء طلب أو تغيير بيانات الحساب. وجّه المستخدم إلى صفحة الدعم عند الحاجة.',
    'استخدم search_store_catalog عند البحث عن منتجات، ثم get_store_product_details عند الحاجة إلى تفاصيل وأسعار أدق. استخدم get_store_help_information للأسئلة عن الطلب والدفع والدعم.',
    'كن مختصراً وودوداً، واذكر أن سعر العرض النهائي يؤخذ من صفحة المنتج وفاتورة الخادم.'
  ].join('\n');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),18_000);
  const steps=Array.isArray(history)?history.slice(-12):[];
  const input=steps.length?steps:[{type:'user_input',content:[{type:'text',text:'مرحباً'}]}];
  try{
    for(let round=0;round<4;round++){
      const response=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
        method:'POST',headers:{'content-type':'application/json','x-goog-api-key':nexaAiApiKeyRuntime},
        body:JSON.stringify({model,input,tools:test?[]:nexaAssistantTools,system_instruction:systemInstruction,store:false,generation_config:{temperature:0.25}}),
        signal:controller.signal,redirect:'error',
      });
      const raw=await response.text();
      let payload;try{payload=JSON.parse(raw);}catch{throw new Error('تعذر قراءة استجابة Gemini API.');}
      if(!response.ok)throw Object.assign(new Error(String(payload?.error?.message||'تعذر الاتصال بخدمة الذكاء الاصطناعي.').slice(0,260)),{status:response.status>=500?502:422});
      const modelSteps=Array.isArray(payload.steps)?payload.steps:[];
      input.push(...modelSteps);
      const functionCalls=modelSteps.filter(step=>step?.type==='function_call');
      if(!functionCalls.length){
        const reply=assistantTextFromInteraction(payload);
        if(!reply)throw new Error('لم يُرجع المساعد إجابة نصية.');
        return {reply:reply.slice(0,3000),model};
      }
      for(const step of functionCalls){
        const name=String(step.name||''),args=step.arguments&&typeof step.arguments==='object'?step.arguments:{};
        const result=assistantToolResult(name,args);
        input.push({type:'function_result',name,call_id:String(step.id||''),result:[{type:'text',text:JSON.stringify(result)}]});
      }
    }
    throw new Error('تجاوز المساعد الحد المسموح لاستدعاء أدوات المتجر.');
  }catch(error){
    if(error?.name==='AbortError')throw Object.assign(new Error('تأخر رد المساعد. حاول مرة أخرى.'),{status:504});
    throw error;
  }finally{clearTimeout(timeout);}
}
async function testNexaAiConnection(){
  const history=[{type:'user_input',content:[{type:'text',text:'أجب بكلمة واحدة: جاهز'}]}];
  const result=await callNexaGeminiInteraction(history,{test:true});
  return {ok:true,model:result.model,reply:result.reply.slice(0,100),testedAt:new Date().toISOString()};
}

await initializeStoreState();
const legacyDefaultProductIds={
  games:new Set(['freefire','pubg','roblox','codm']),
  apps:new Set(['tiktok','likee']),
  giftcards:new Set(['googleplay','playstation','steam']),
  subscriptions:new Set(['netflix','youtube','spotify','chatgpt']),
  design:new Set(['logo','video']),
  marketing:new Set(['ads','seo']),
  websites:new Set(['website','landing']),
  custom:new Set(['custom']),
};
const migratedCatalog=catalog.map(category=>({
  ...category,
  items:(category.items||[]).filter(product=>{
    const remove=legacyDefaultProductIds[category.id]?.has(String(product.id))&&!product.wamda&&!product.seagm;
    return !remove;
  }),
})).filter(category=>!legacyDefaultProductIds[category.id]||(category.items||[]).length>0);
const legacyItemsRemoved=catalog.reduce((sum,category)=>sum+(category.items||[]).filter(product=>legacyDefaultProductIds[category.id]?.has(String(product.id))&&!product.wamda&&!product.seagm).length,0);
if(legacyItemsRemoved>0){
  await persistCatalog(migratedCatalog);
  console.log('Removed '+legacyItemsRemoved+' legacy sample products from the live catalogue; supplier products and order records were preserved.');
}
const seagmFulfillmentTimer=setInterval(()=>runSeagmFulfillmentWorker().catch(error=>console.error('SEAGM worker loop failed',String(error?.message||'unknown').slice(0,120))),5_000);
seagmFulfillmentTimer.unref?.();
runSeagmFulfillmentWorker().catch(error=>console.error('initial SEAGM fulfillment run failed',String(error?.message||'unknown').slice(0,120)));
if (storeSettings?.fxMode === 'api') refreshAutomaticFx().catch(error=>console.error('initial FX refresh failed',error.message));
if (storeSettings?.catalogApiMode === 'auto') syncCatalogFromApi().catch(error=>console.error('initial catalogue API sync failed',error.message));
if(storeSettings?.wamdaAutoRefreshEnabled!==false&&wamdaApiTokenRuntime)refreshWamdaCatalog({source:'startup'}).catch(error=>console.error('initial Wamda catalogue refresh failed',String(error?.code||error?.message||'unknown').slice(0,160)));
const fxRefreshTimer = setInterval(()=>{ if (storeSettings?.fxMode === 'api') refreshAutomaticFx().catch(error=>console.error('scheduled FX refresh failed',error.message)); },5*60_000);
fxRefreshTimer.unref?.();
const catalogSyncTimer = setInterval(()=>{
  if (storeSettings?.catalogApiMode !== 'auto' || catalogApiSyncInProgress) return;
  const last = new Date(storeSettings.catalogApiLastAttemptAt || storeSettings.catalogApiLastSyncAt || 0).getTime();
  const interval = Math.max(5,Number(storeSettings.catalogApiIntervalMinutes || 15))*60_000;
  if (!Number.isFinite(last) || Date.now()-last >= interval) syncCatalogFromApi().catch(error=>console.error('scheduled catalogue API sync failed',error.message));
},60_000);
catalogSyncTimer.unref?.();
const wamdaCatalogRefreshTimer=setInterval(()=>{
  if(storeSettings?.wamdaAutoRefreshEnabled===false||!wamdaApiTokenRuntime||wamdaCatalogSyncInProgress)return;
  const last=new Date(storeSettings.wamdaLastRefreshAttemptAt||storeSettings.wamdaLastSyncAt||0).getTime();
  const interval=Math.max(5,Number(storeSettings.wamdaRefreshIntervalMinutes||15))*60_000;
  if(!Number.isFinite(last)||Date.now()-last>=interval){
    refreshWamdaCatalog({source:'scheduled'}).catch(error=>console.error('scheduled Wamda refresh failed',String(error?.code||error?.message||'unknown').slice(0,160)));
  }
},60_000);
wamdaCatalogRefreshTimer.unref?.();

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = String(process.env.TRUST_PROXY === 'true' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true,service:'nexa-shamcash-gateway',paymentsReady,dbReady:Boolean(pool),walletReady:Boolean(pool)});

    if(req.method==='POST'&&url.pathname==='/api/account/register'){
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED',message:'خدمة الحسابات غير جاهزة حالياً.'});
      if(rateLimit(req,res,'account-register:'+ip,5,10*60_000))return;
      const input=await bodyJson(req,4096);
      const name=String(input.name||'').trim().slice(0,70);
      const phone=String(input.phone||'').replace(/[\s()-]/g,'').trim();
      const password=String(input.password||'');
      if(name.length<2||!/^\+?[0-9]{8,18}$/.test(phone)||password.length<8||password.length>128)
        return send(res,400,{ok:false,error:'INVALID_ACCOUNT_DETAILS',message:'أدخل اسماً ورقم هاتف صحيحاً وكلمة مرور من 8 أحرف على الأقل.'});
      const id=crypto.randomUUID(),salt=crypto.randomBytes(16).toString('hex'),hash=customerPasswordHash(password,salt);
      try{
        await pool.query('INSERT INTO nexa_customers(id,full_name,phone,password_salt,password_hash) VALUES($1,$2,$3,$4,$5)',[id,name,phone,salt,hash]);
        await createCustomerSession(req,res,id);
        const customer=await pool.query('SELECT id,full_name,phone,balance_minor::text,created_at FROM nexa_customers WHERE id=$1',[id]);
        return send(res,201,{ok:true,customer:customer.rows[0]});
      }catch(error){
        if(error.code==='23505')return send(res,409,{ok:false,error:'PHONE_ALREADY_REGISTERED',message:'رقم الهاتف مسجل مسبقاً. سجّل الدخول إلى حسابك.'});
        throw error;
      }
    }
    if(req.method==='POST'&&url.pathname==='/api/account/login'){
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED',message:'خدمة الحسابات غير جاهزة حالياً.'});
      if(rateLimit(req,res,'account-login:'+ip,8,10*60_000))return;
      const input=await bodyJson(req,4096),phone=String(input.phone||'').replace(/[\s()-]/g,'').trim(),password=String(input.password||'');
      if(!/^\+?[0-9]{8,18}$/.test(phone)||!password||password.length>128)return send(res,400,{ok:false,error:'INVALID_LOGIN',message:'تحقق من رقم الهاتف وكلمة المرور.'});
      const found=await pool.query('SELECT id,password_salt,password_hash FROM nexa_customers WHERE phone=$1 LIMIT 1',[phone]);
      if(!found.rowCount)return send(res,401,{ok:false,error:'INVALID_CREDENTIALS',message:'رقم الهاتف أو كلمة المرور غير صحيحة.'});
      const expected=Buffer.from(found.rows[0].password_hash,'hex'),supplied=Buffer.from(customerPasswordHash(password,found.rows[0].password_salt),'hex');
      if(expected.length!==supplied.length||!crypto.timingSafeEqual(expected,supplied))return send(res,401,{ok:false,error:'INVALID_CREDENTIALS',message:'رقم الهاتف أو كلمة المرور غير صحيحة.'});
      await pool.query('UPDATE nexa_customers SET last_login_at=NOW() WHERE id=$1',[found.rows[0].id]);
      await createCustomerSession(req,res,found.rows[0].id);
      const customer=await pool.query('SELECT id,full_name,phone,balance_minor::text,created_at FROM nexa_customers WHERE id=$1',[found.rows[0].id]);
      return send(res,200,{ok:true,customer:customer.rows[0]});
    }
    if(req.method==='POST'&&url.pathname==='/api/account/logout'){
      const token=readCookie(req,'nexa_customer_session');
      if(pool&&token)await pool.query('DELETE FROM nexa_customer_sessions WHERE session_hash=$1',[customerSessionHash(token)]);
      return send(res,200,{ok:true},{'Set-Cookie':customerCookie(req,'',0)});
    }
    if(req.method==='GET'&&url.pathname==='/api/account/me'){
      const customer=await currentCustomer(req);
      if(!customer)return send(res,401,{ok:false,error:'CUSTOMER_LOGIN_REQUIRED',message:'سجّل الدخول إلى حسابك.'});
      return send(res,200,{ok:true,customer});
    }
    if(req.method==='GET'&&url.pathname==='/api/account/orders'){
      const customer=await currentCustomer(req);
      if(!customer)return send(res,401,{ok:false,error:'CUSTOMER_LOGIN_REQUIRED',message:'سجّل الدخول إلى حسابك.'});
      const result=await pool.query(\`SELECT o.id,o.product_label,o.amount_minor::text AS "amountMinor",o.currency,o.status,
        o.payment_method AS "paymentMethod",o.created_at AS "createdAt",o.paid_at AS "paidAt",
        o.supplier_status AS "supplierStatus",o.supplier_message AS "supplierMessage"
        FROM nexa_orders o WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 100\`,[customer.id]);
      return send(res,200,{ok:true,orders:result.rows});
    }
    if(req.method==='GET'&&url.pathname==='/api/wallet/transactions'){
      const customer=await currentCustomer(req);
      if(!customer)return send(res,401,{ok:false,error:'CUSTOMER_LOGIN_REQUIRED',message:'سجّل الدخول إلى حسابك.'});
      const result=await pool.query(\`SELECT kind,amount_minor::text AS "amountMinor",balance_after_minor::text AS "balanceAfterMinor",
        reference_order_id AS "referenceOrderId",note,created_at AS "createdAt"
        FROM nexa_wallet_ledger WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 40\`,[customer.id]);
      return send(res,200,{ok:true,transactions:result.rows});
    }
    if(req.method==='POST'&&url.pathname==='/api/wallet/topups'){
      if(!paymentsReady)return send(res,503,{ok:false,error:'PAYMENTS_NOT_READY',message:'شحن الرصيد عبر شام كاش غير متاح حالياً.'});
      const customer=await currentCustomer(req);
      if(!customer)return send(res,401,{ok:false,error:'CUSTOMER_LOGIN_REQUIRED',message:'سجّل الدخول قبل شحن الرصيد.'});
      if(rateLimit(req,res,'wallet-topup:'+customer.id,5,10*60_000))return;
      const input=await bodyJson(req,4096),amountMinor=decimalMinor(input.amount);
      if(amountMinor===null||amountMinor<100000n||amountMinor>500000000n)
        return send(res,400,{ok:false,error:'INVALID_TOPUP_AMOUNT',message:'قيمة الشحن يجب أن تكون بين 1,000 و5,000,000 ليرة سورية جديدة.'});
      const id=\`NX-\${crypto.randomBytes(10).toString('hex').toUpperCase()}\`;
      let invoice=null,persisted=false;
      try{
        const wallet=await getWallet(true);
        invoice=await createShamInvoice(id,{amountMinor,currency:'SYP',label:'شحن رصيد حساب Nexa'},wallet);
        await pool.query(\`INSERT INTO nexa_orders(
          id,category_id,product_id,option_id,pack_index,product_label,amount_minor,currency,
          customer_name,customer_phone,game_account,notes,expires_at,invoice_number,invoice_identifier,
          wallet_label,wallet_address,wallet_topup_customer_id,customer_id,payment_method
        ) VALUES($1,'wallet','wallet-topup','wallet-topup',0,'شحن رصيد Nexa',$2,'SYP',$3,$4,'','',$5,$6,$7,$8,$9,$10,$10,'shamcash_topup')\`,[
          id,amountMinor.toString(),customer.full_name,customer.phone,invoice.expiresAt,invoice.invoiceNumber,
          invoice.identifier,invoice.walletLabel,invoice.walletAddress,customer.id
        ]);
        persisted=true;
        return send(res,201,{ok:true,orderId:id,product:'شحن رصيد Nexa',amountMinor:amountMinor.toString(),currency:'SYP',
          expiresAt:invoice.expiresAt.toISOString(),invoiceNumber:invoice.invoiceNumber,invoiceIdentifier:invoice.identifier,
          receiverLabel:invoice.walletLabel,receiverAddress:invoice.identifier,status:'pending_payment',paymentMethod:'shamcash_topup'});
      }catch(error){
        if(invoice?.invoiceNumber&&!persisted)await shamApi('DELETE',\`/v1/invoices/\${encodeURIComponent(invoice.invoiceNumber)}\`).catch(()=>{});
        if(error instanceof ProviderError)return send(res,error.status>=500?502:error.status,{ok:false,error:error.code,message:providerMessage(error)});
        throw error;
      }
    }

    const wamdaWebhookMatch=

    const wamdaWebhookMatch=url.pathname.match(/^\/api\/webhooks\/wamda\/([A-Za-z0-9_-]{40,80})$/);
    if(req.method==='POST'&&wamdaWebhookMatch){
      if(!pool||!wamdaWebhookSecretRuntime)return sendText(res,503,'store webhook is not configured');
      const supplied=Buffer.from(wamdaWebhookMatch[1]),expected=Buffer.from(wamdaWebhookSecretRuntime);
      if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return sendText(res,404,'not found');
      try{await bodyText(req,32*1024);}catch(error){return sendText(res,Number(error?.status)===413?413:400,'invalid callback body');}
      await pool.query(`UPDATE nexa_fulfillment_jobs j SET next_attempt_at=NOW(),updated_at=NOW()
        FROM nexa_orders o WHERE j.order_id=o.id AND o.supplier_provider='wamda' AND o.status='paid'
        AND j.status IN ('pending','retry','processing')`);
      runSeagmFulfillmentWorker().catch(error=>console.error('Wamda callback worker wake failed',String(error?.code||error?.message||'unknown').slice(0,120)));
      return sendText(res,200,'success');
    }

    if (req.method === 'POST' && url.pathname === '/api/webhooks/seagm') {
      if (!pool) return sendText(res,503,'store database is not ready');
      if (!storeSettings?.seagmUid || !seagmSecretRuntime) return sendText(res,503,'SEAGM callback is not configured');

      let callbackParams;
      try {
        const rawBody = await bodyText(req,32 * 1024);
        const bodyParams = parseSeagmCallbackBody(rawBody,req.headers['content-type'] || '');
        callbackParams = mergeSeagmCallbackParams(url.searchParams,bodyParams);
      } catch (error) {
        const status = Number(error?.status) === 413 ? 413 : 400;
        return sendText(res,status,'invalid callback payload');
      }

      if (!verifySeagmCallbackSignature(callbackParams,seagmSecretRuntime,{
        expectedUid:storeSettings.seagmUid,
        nowMs:Date.now(),
      })) {
        return sendText(res,401,'invalid callback signature');
      }

      const merchantOrderId = String(callbackParams.mch_order_id || '');
      if (!/^NX-[A-F0-9]{20}$/.test(merchantOrderId)) return sendText(res,400,'invalid merchant order id');

      const found = await pool.query(`
        SELECT o.id,o.status,o.supplier_provider,o.supplier_status,j.status AS job_status
        FROM nexa_orders o
        LEFT JOIN nexa_fulfillment_jobs j ON j.order_id=o.id
        WHERE o.id=$1 AND o.supplier_mch_order_id=$1
        LIMIT 1
      `,[merchantOrderId]);
      if (!found.rowCount || found.rows[0].supplier_provider !== 'seagm') {
        return sendText(res,404,'order not found');
      }

      const order = found.rows[0];
      if (order.status !== 'paid' || !order.job_status) {
        return sendText(res,409,'order is not eligible for supplier reconciliation');
      }

      // A callback is only a signed wake-up signal. The worker fetches the current
      // order from SEAGM and verifies merchant ID, product, quantity and final status.
      // It never trusts callback status fields or card data as proof of delivery.
      if (order.supplier_status !== 'completed' &&
          !['completed','manual_review'].includes(order.job_status)) {
        await pool.query(`
          UPDATE nexa_fulfillment_jobs
          SET next_attempt_at=NOW(),updated_at=NOW()
          WHERE order_id=$1 AND status IN ('pending','retry','processing')
        `,[merchantOrderId]);
        runSeagmFulfillmentWorker().catch(error =>
          console.error('SEAGM callback worker wake failed',String(error?.code || error?.message || 'unknown').slice(0,120))
        );
      }

      return sendText(res,200,'success');
    }


    if (req.method === 'POST' && url.pathname === '/api/admin/session') {
      if (rateLimit(req,res,`admin-login:${ip}`,6,10*60_000)) return;
      const input = await bodyJson(req, 4096);
      const supplied = Buffer.from(String(input.key || '')), expected = Buffer.from(cfg.adminApiKey);
      if (!cfg.adminApiKey || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) return send(res,401,{ok:false,error:'UNAUTHORIZED',message:'رمز الإدارة غير صحيح.'});
      const token = createAdminSession(cfg.adminApiKey);
      return send(res,200,{ok:true,expiresIn:8*60*60}, {'Set-Cookie':adminCookie(req,token)});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/session') {
      return adminAuthorized(req) ? send(res,200,{ok:true}) : send(res,401,{ok:false});
    }
    if (req.method === 'DELETE' && url.pathname === '/api/admin/session') {
      return send(res,200,{ok:true},{'Set-Cookie':adminCookie(req,'',0)});
    }
    if (url.pathname.startsWith('/api/admin/') && !adminAuthorized(req) && !(req.method === 'POST' && url.pathname === '/api/admin/catalog/products' && catalogWriteAuthorized(req))) {
      return send(res,401,{ok:false,error:'UNAUTHORIZED',message:'سجّل الدخول إلى لوحة الإدارة أولاً.'});
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return send(res,200,{ok:true,catalog:publicCatalog()});
    }
    if (req.method === 'GET' && url.pathname === '/api/storefront-config') {
      return send(res,200,{ok:true,...publicSettings()});
    }
    if(req.method==='POST'&&url.pathname==='/api/assistant/chat'){
      if(rateLimit(req,res,'nexa-assistant:'+ip,12,60_000))return;
      if(!nexaAiApiKeyRuntime)return send(res,503,{ok:false,error:'NEXA_AI_NOT_CONFIGURED',message:'مساعد Nexa الذكي لم يتم تفعيله بعد. يمكنك التواصل مع فريق الدعم حالياً.'});
      const input=await bodyJson(req,12_000);
      const message=String(input.message||'').trim();
      if(!message||message.length>1000)return send(res,400,{ok:false,error:'INVALID_ASSISTANT_MESSAGE',message:'اكتب سؤالاً من 1 إلى 1000 حرف.'});
      const prior=Array.isArray(input.history)?input.history.slice(-8):[];
      const redactAssistantText=value=>String(value||'')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[بريد محذوف]')
        .replace(/\bNX-[A-Z0-9-]{8,}\b/gi,'[رقم طلب محذوف]')
        .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g,'[رقم هاتف محذوف]');
      const safeMessage=redactAssistantText(message);
      const transcript=prior.map(item=>{
        const role=item?.role==='assistant'?'المساعد':'العميل';
        const content=redactAssistantText(item?.content).replace(/[\u0000-\u001f]/g,' ').slice(0,500);
        return content?role+': '+content:'';
      }).filter(Boolean).join('\n');
      const prompt=(transcript?('سياق المحادثة السابقة:\n'+transcript+'\n\n'):'')+'سؤال العميل الحالي:\n'+safeMessage;
      const history=[{type:'user_input',content:[{type:'text',text:prompt}]}];
      try{
        const result=await callNexaGeminiInteraction(history);
        return send(res,200,{ok:true,reply:result.reply,model:result.model});
      }catch(error){
        const status=error?.status||502;
        return send(res,status,{ok:false,error:error?.code||'NEXA_AI_REQUEST_FAILED',
          message:String(error?.message||'تعذر الحصول على رد من المساعد.').slice(0,260)});
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const [orders,products] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status='paid')::int AS paid,
          COUNT(*) FILTER (WHERE status='pending_payment')::int AS pending,
          COUNT(*) FILTER (WHERE status='expired')::int AS expired,
          COALESCE(SUM(amount_minor) FILTER (WHERE status='paid' AND currency='SYP'),0)::text AS paid_syp_minor,
          COALESCE(SUM(amount_minor) FILTER (WHERE status='paid' AND currency='USD'),0)::text AS paid_usd_minor
          FROM nexa_orders`),
        Promise.resolve(catalog.reduce((sum,c)=>sum+(c.items||[]).length,0)),
      ]);
      return send(res,200,{ok:true,orders:orders.rows[0],categories:catalog.length,products:products,fxRate:Number(storeSettings.fxRate||145),fxMode:storeSettings.fxMode,paymentsReady});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/write-keys') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,4096);
      const name = String(input.name || '').trim();
      if (!name || name.length > 60) return send(res,400,{ok:false,error:'INVALID_API_NAME',message:'اكتب اسماً واضحاً لمصدر API (حتى 60 حرفاً).'});
      const keys = Array.isArray(storeSettings.catalogWriteApiKeys) ? storeSettings.catalogWriteApiKeys : [];
      if (keys.length >= 20) return send(res,409,{ok:false,error:'API_LIMIT_REACHED',message:'يمكن ربط 20 مصدر API كحد أقصى.'});
      const key = crypto.randomBytes(32).toString('base64url');
      const entry = { id:'api_'+crypto.randomBytes(8).toString('hex'), name, hash:crypto.createHash('sha256').update(key).digest('hex'), createdAt:new Date().toISOString() };
      const nextSettings = { ...storeSettings,catalogWriteApiKeys:[...keys,entry] };
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
      storeSettings = nextSettings;
      return send(res,201,{ok:true,key,source:{id:entry.id,name:entry.name,createdAt:entry.createdAt},message:'تم إنشاء مصدر API. انسخ المفتاح الآن؛ لن يظهر مرة ثانية.'});
    }
    const apiKeyIdToDelete = url.pathname.startsWith('/api/admin/catalog/write-keys/') ? url.pathname.slice('/api/admin/catalog/write-keys/'.length) : '';
    const catalogApiKeyDelete = /^[a-z0-9_-]{1,60}$/i.test(apiKeyIdToDelete) ? [null,apiKeyIdToDelete] : null;
    if (req.method === 'DELETE' && catalogApiKeyDelete) {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const keys = Array.isArray(storeSettings.catalogWriteApiKeys) ? storeSettings.catalogWriteApiKeys : [];
      const nextKeys = keys.filter(entry=>entry.id!==catalogApiKeyDelete[1]);
      if (nextKeys.length === keys.length) return send(res,404,{ok:false,error:'API_SOURCE_NOT_FOUND'});
      const nextSettings = { ...storeSettings,catalogWriteApiKeys:nextKeys };
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
      storeSettings = nextSettings;
      return send(res,200,{ok:true,message:'تم حذف مصدر API وإلغاء مفتاحه.'});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/write-key/regenerate') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const key = crypto.randomBytes(32).toString('base64url');
      const nextSettings = { ...storeSettings,catalogWriteApiTokenEncrypted:encryptSecret(key,cfg.settingsEncryptionKey),catalogWriteApiTokenCleared:false };
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
      storeSettings = nextSettings;
      catalogWriteApiTokenRuntime = key;
      return send(res,200,{ok:true,key,message:'احفظ المفتاح الآن؛ لن يظهر مرة ثانية.'});
    }
    if (req.method === 'DELETE' && url.pathname === '/api/admin/catalog/write-key') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const nextSettings = { ...storeSettings,catalogWriteApiTokenEncrypted:'',catalogWriteApiTokenCleared:true };
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
      storeSettings = nextSettings;
      catalogWriteApiTokenRuntime = '';
      return send(res,200,{ok:true,message:'تم إلغاء مفتاح كتابة المنتجات.'});
    }
    const restoreProductApiMatch=url.pathname.match(/^\/api\/admin\/catalog\/([^/]+)\/([^/]+)\/restore-api$/);
    if(req.method==='POST'&&restoreProductApiMatch){
      if(!pool)return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const categoryId=decodeURIComponent(restoreProductApiMatch[1]),productId=decodeURIComponent(restoreProductApiMatch[2]);
      let found=false;
      const nextCatalog=catalog.map(category=>category.id!==categoryId?category:{
        ...category,items:category.items.map(product=>{
          if(product.id!==productId)return product;
          found=true;
          const source=product.apiSource;
          if(!source)return product;
          const restored={...product};
          for(const key of ['name','desc','image','options'])if(Object.prototype.hasOwnProperty.call(source,key))restored[key]=source[key];
          delete restored.manualOverrides;
          return restored;
        })
      });
      if(!found)return send(res,404,{ok:false,error:'PRODUCT_NOT_FOUND',message:'لم يتم العثور على المنتج.'});
      const category=nextCatalog.find(item=>item.id===categoryId),product=category?.items.find(item=>item.id===productId);
      if(!product?.apiSource)return send(res,409,{ok:false,error:'API_SOURCE_MISSING',message:'لا توجد نسخة مصدر محفوظة لهذا المنتج. أعد مزامنة المنتجات أولاً.'});
      await persistCatalog(nextCatalog);
      return send(res,200,{ok:true,message:'تمت استعادة بيانات المنتج من آخر نسخة API.',catalog});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/catalog') {
      return send(res,200,{ok:true,catalog});
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin/catalog') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,4_000_000);
      const requestedCatalog = validateCatalog(input.catalog);
      const nextCatalog = requestedCatalog.map(category=>{
        const previousCategory=catalog.find(item=>item.id===category.id);
        return {...category,items:category.items.map(product=>{
          const previous=previousCategory?.items.find(item=>item.id===product.id);
          if(!previous)return product;
          const apiSource=previous.apiSource||{name:previous.name,desc:previous.desc,image:previous.image,options:previous.options};
          const overrides={...(previous.manualOverrides||{})};
          for(const key of ['name','desc','image','options']){
            if(JSON.stringify(product[key])!==JSON.stringify(previous[key]))overrides[key]=product[key];
          }
          const next={...product,apiSource};
          if(Object.keys(overrides).length)next.manualOverrides=overrides;
          else delete next.manualOverrides;
          return next;
        })};
      });
      await persistCatalog(validateCatalog(nextCatalog));
      return send(res,200,{ok:true,message:'تم حفظ الكتالوج والتعديلات اليدوية مع الاحتفاظ ببيانات API.',catalog});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/products') {
      if (rateLimit(req,res,`catalog-write:${ip}`,40,60_000)) return;
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,2_800_000);
      let result;
      try {
        let workingCatalog = catalog;
        const categoryInput = input.category && typeof input.category === 'object' ? input.category : null;
        const categoryId = String(input.categoryId || categoryInput?.id || '');
        if (categoryInput && !workingCatalog.some(category=>category.id===categoryId)) {
          const category = { id:categoryId,name:String(categoryInput.name || ''),desc:String(categoryInput.desc || ''),image:categoryInput.image || 'assets/brand/logo.svg',items:[] };
          if (categoryInput.icon !== undefined) category.icon = categoryInput.icon;
          workingCatalog = validateCatalog([...workingCatalog,category]);
        }
        const productInput = { ...(input.product || {}) };
        if (productInput.desc === undefined) productInput.desc = String(productInput.description || '');
        if (!productInput.image) productInput.image = 'assets/brand/logo.svg';
        if (!Array.isArray(productInput.options) && productInput.price !== undefined) {
          const price = Number(productInput.price);
          if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000 || !/^[0-9]+([.][0-9]{1,2})?$/.test(String(productInput.price))) {
            throw Object.assign(new Error('سعر المنتج يجب أن يكون رقماً بالليرة السورية الجديدة وبحد أقصى منزلتين عشريتين.'),{status:400});
          }
          productInput.options = [{id:'default',name:'الخيار الأساسي',desc:'',packs:[[String(productInput.priceLabel || 'السعر الأساسي'),price]]}];
        }
        delete productInput.description; delete productInput.price; delete productInput.priceLabel;
        result = upsertCatalogProduct(workingCatalog,categoryId,productInput);
      } catch (error) { return send(res,error?.status || 400,{ok:false,error:'INVALID_CATALOG_PRODUCT',message:String(error?.message || 'بيانات المنتج غير صالحة.')}); }
      await persistCatalog(result.catalog);
      return send(res,result.created?201:200,{ok:true,created:result.created,productId:result.productId,message:result.created?'تمت إضافة المنتج عبر API.':'تم تحديث المنتج عبر API.'});
    }
    if(req.method==='GET'&&url.pathname==='/api/admin/wamda/catalog'){
      const sourceCategories=Array.isArray(storeSettings?.wamdaCatalogCache)?storeSettings.wamdaCatalogCache:[];
      const categories=buildWamdaAdminCategories(sourceCategories);
      const stats={categories:categories.length,products:categories.reduce((sum,category)=>sum+(category.products||[]).length,0),
        available:categories.reduce((sum,category)=>sum+(category.products||[]).filter(product=>product.available).length,0),
        published:categories.reduce((sum,category)=>sum+(category.products||[]).filter(product=>product.published).length,0)};
      return send(res,200,{ok:true,configured:Boolean(wamdaApiTokenRuntime),account:storeSettings?.wamdaAccountInfo||null,
        lastSyncAt:storeSettings?.wamdaLastSyncAt||null,lastRefreshAttemptAt:storeSettings?.wamdaLastRefreshAttemptAt||null,
        lastTestAt:storeSettings?.wamdaLastTestAt||null,lastError:storeSettings?.wamdaLastError||'',
        syncInProgress:wamdaCatalogSyncInProgress||wamdaBulkPublishInProgress,bulkPublishInProgress:wamdaBulkPublishInProgress,webhookUrl:safeSettingsForAdmin().wamdaWebhookUrl,stats,categories,
        pricing:{profitMarginPercent:Number(storeSettings?.wamdaProfitMarginPercent??0),
          globalPolicy:getWamdaPricingContext().globalRule,categoryPolicies:getWamdaPricingContext().categoryPolicies,
          fxRate:Number(storeSettings?.fxRate||145),autoRefreshEnabled:storeSettings?.wamdaAutoRefreshEnabled!==false,
          refreshIntervalMinutes:Number(storeSettings?.wamdaRefreshIntervalMinutes||15)}});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/test'){
      if(rateLimit(req,res,'wamda-test:'+ip,5,60_000))return;
      try{return send(res,200,await testWamdaConnection());}catch(error){return send(res,error?.status||422,{ok:false,error:'WAMDA_CONNECTION_FAILED',message:String(error?.message||'تعذر الاتصال بومضة.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/refresh'){
      if(rateLimit(req,res,'wamda-sync:'+ip,2,60_000))return;
      try{return send(res,200,await refreshWamdaCatalog());}catch(error){return send(res,error?.status||422,{ok:false,error:'WAMDA_CATALOG_SYNC_FAILED',message:String(error?.message||'تعذر جلب منتجات ومضة.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/publish'){
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const input=await bodyJson(req,16_384);
      try{return send(res,200,await publishWamdaProduct(input));}catch(error){return send(res,error?.status||400,{ok:false,error:'WAMDA_PRODUCT_PUBLISH_FAILED',message:String(error?.message||'تعذر نشر منتج ومضة.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/price'){
      if(rateLimit(req,res,'wamda-price:'+ip,40,60_000))return;
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const input=await bodyJson(req,16_384);
      try{return send(res,200,await publishWamdaProduct(input));}
      catch(error){return send(res,error?.status||400,{ok:false,error:'WAMDA_MANUAL_PRICE_FAILED',message:String(error?.message||'تعذر تثبيت السعر اليدوي.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/price/reset'){
      if(rateLimit(req,res,'wamda-price-reset:'+ip,40,60_000))return;
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const input=await bodyJson(req,16_384);
      try{return send(res,200,await publishWamdaProduct({...input,resetToAutomatic:true}));}
      catch(error){return send(res,error?.status||400,{ok:false,error:'WAMDA_AUTO_PRICE_RESET_FAILED',message:String(error?.message||'تعذر إعادة التسعير التلقائي.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/product-pricing'){
      if(rateLimit(req,res,'wamda-product-pricing:'+ip,60,60_000))return;
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const input=await bodyJson(req,16_384);
      try{return send(res,200,await setWamdaProductPricing(input));}
      catch(error){return send(res,error?.status||400,{ok:false,error:'WAMDA_PRODUCT_PRICING_FAILED',message:String(error?.message||'تعذر حفظ تسعير المنتج.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/category-pricing'){
      if(rateLimit(req,res,'wamda-category-pricing:'+ip,30,60_000))return;
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const input=await bodyJson(req,16_384);
      try{return send(res,200,await setWamdaCategoryPricing(input));}
      catch(error){return send(res,error?.status||400,{ok:false,error:'WAMDA_CATEGORY_PRICING_FAILED',message:String(error?.message||'تعذر حفظ تسعير القسم.').slice(0,300)});}
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/wamda/catalog/pricing/apply-all'){
      if(rateLimit(req,res,'wamda-apply-global-pricing:'+ip,5,60_000))return;
      if(!pool)return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      try{return send(res,200,await applyWamdaGlobalPricingToAll());}
      catch(error){return send(res,error?.status||400,{ok:false,error:'WAMDA_APPLY_GLOBAL_PRICING_FAILED',message:String(error?.message||'تعذر تطبيق التسعير العام على كل المنتجات.').slice(0,300)});}
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/seagm/catalog') {
      const categories = Array.isArray(storeSettings?.seagmCatalogCache) ? storeSettings.seagmCatalogCache : [];
      return send(res,200,{
        ok:true,
        configured:Boolean(storeSettings?.seagmUid && seagmSecretRuntime),
        uid:storeSettings?.seagmUid || '',
        environment:storeSettings?.seagmEnvironment || 'sandbox',
        account:storeSettings?.seagmAccountInfo || null,
        lastSyncAt:storeSettings?.seagmLastSyncAt || null,
        lastTestAt:storeSettings?.seagmLastTestAt || null,
        lastError:storeSettings?.seagmLastError || '',
        syncInProgress:seagmCatalogSyncInProgress,
        stats:{
          categories:categories.length,
          products:categories.reduce((sum,category)=>sum+(category.products||[]).length,0),
          cards:categories.filter(category=>category.kind==='card').reduce((sum,category)=>sum+(category.products||[]).length,0),
          recharge:categories.filter(category=>category.kind==='recharge').reduce((sum,category)=>sum+(category.products||[]).length,0),
        },
        categories,
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/seagm/test') {
      if (rateLimit(req,res,'seagm-test:' + ip,5,60_000)) return;
      try { return send(res,200,await testSeagmConnection()); }
      catch (error) {
        return send(res,error?.status || 422,{ok:false,error:'SEAGM_CONNECTION_FAILED',message:String(error?.message || 'تعذر الاتصال بحساب SEAGM.')});
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/seagm/catalog/refresh') {
      if (rateLimit(req,res,'seagm-sync:' + ip,2,60_000)) return;
      try {
        const result = await refreshSeagmCatalog();
        return send(res,200,result);
      } catch (error) {
        return send(res,error?.status || 422,{ok:false,error:'SEAGM_CATALOG_SYNC_FAILED',message:String(error?.message || 'تعذر جلب منتجات SEAGM.')});
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/seagm/catalog/publish') {
      if (!pool) return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,16_384);
      try { return send(res,200,await publishSeagmProduct(input)); }
      catch (error) {
        return send(res,error?.status || 400,{ok:false,error:'SEAGM_PRODUCT_PUBLISH_FAILED',message:String(error?.message || 'تعذر نشر المنتج.')});
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/catalog/sync-status') {
      return send(res,200,{ok:true,mode:storeSettings.catalogApiMode,lastSyncAt:storeSettings.catalogApiLastSyncAt||null,lastError:storeSettings.catalogApiLastError||'',syncInProgress:catalogApiSyncInProgress,configured:Boolean(storeSettings.catalogApiUrl),tokenConfigured:Boolean(catalogApiTokenRuntime)});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/sync-preview') {
      if (rateLimit(req,res,`catalog-sync:${ip}`,5,60_000)) return;
      try { const result = await syncCatalogFromApi({preview:true}); return send(res,200,result); }
      catch (error) { return send(res,error?.status || 422,{ok:false,error:'CATALOG_API_PREVIEW_FAILED',message:String(error?.message || 'تعذر فحص API المنتجات.')}); }
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/sync') {
      if (rateLimit(req,res,`catalog-sync:${ip}`,5,60_000)) return;
      try { const result = await syncCatalogFromApi(); return send(res,200,result); }
      catch (error) { return send(res,error?.status || 422,{ok:false,error:'CATALOG_API_SYNC_FAILED',message:String(error?.message || 'تعذرت مزامنة API المنتجات.')}); }
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/ai/test'){
      if(rateLimit(req,res,'nexa-ai-test:'+ip,5,60_000))return;
      try{return send(res,200,await testNexaAiConnection());}
      catch(error){return send(res,error?.status||422,{ok:false,error:error?.code||'NEXA_AI_TEST_FAILED',message:String(error?.message||'تعذر اختبار الاتصال بالمساعد.').slice(0,260)});}
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/settings') {
      return send(res,200,{ok:true,settings:safeSettingsForAdmin(),paymentsReady,fxReady:fxRateReady()});
    }
    if (req.method === 'PATCH' && url.pathname === '/api/admin/settings') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const previousSettings=storeSettings;
      const input = await bodyJson(req,3_000_000);
      const nextSettings = validateAndApplySettings(input);
      const pricingChanged=
        JSON.stringify(previousSettings?.wamdaPricingPolicy||{mode:'percent',value:Number(previousSettings?.wamdaProfitMarginPercent??0)})!==JSON.stringify(nextSettings.wamdaPricingPolicy||{mode:'percent',value:Number(nextSettings.wamdaProfitMarginPercent??0)})||
        JSON.stringify(previousSettings?.wamdaCategoryPricingPolicies||{})!==JSON.stringify(nextSettings.wamdaCategoryPricingPolicies||{})||
        previousSettings?.fxRate!==nextSettings.fxRate;
      if(pricingChanged)await repricePublishedWamdaProducts(nextSettings);
      else{
        await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
        storeSettings=nextSettings;applyStoreSettings();
      }
      return send(res,200,{ok:true,settings:safeSettingsForAdmin(),paymentsReady,fxReady:fxRateReady()});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/fx/refresh') {
      const result = await refreshAutomaticFx();
      return send(res,result.ok?200:422,result);
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100)));
      const result = await pool.query(`SELECT o.id,o.product_label,o.amount_minor::text,o.currency,o.status,o.customer_name,o.customer_phone,o.game_account,o.notes,o.invoice_number,o.invoice_identifier,o.wallet_label,o.created_at,o.expires_at,o.paid_at,o.supplier_provider,o.supplier_kind,o.supplier_status,o.supplier_message,o.supplier_order_id,o.supplier_mch_order_id,j.last_error AS supplier_error FROM nexa_orders o LEFT JOIN nexa_fulfillment_jobs j ON j.order_id=o.id ORDER BY o.created_at DESC LIMIT $1`,[limit]);
      return send(res,200,{ok:true,orders:result.rows.map(o=>({...o,amountMinor:o.amount_minor,createdAt:o.created_at,expiresAt:o.expires_at,paidAt:o.paid_at}))});
    }
    const adminFulfillmentRetry = url.pathname.match(/^\/api\/admin\/orders\/(NX-[A-F0-9]{20})\/fulfillment\/retry$/);
    if (req.method === 'POST' && adminFulfillmentRetry) {
      if (!pool) return send(res,503,{ok:false,error:'DATABASE_NOT_CONFIGURED'});
      const orderId=adminFulfillmentRetry[1];
      const found=await pool.query(`SELECT status,supplier_provider,supplier_status FROM nexa_orders WHERE id=$1`,[orderId]);
      if (!found.rowCount || found.rows[0].status!=='paid' || !['seagm','wamda'].includes(found.rows[0].supplier_provider)) {
        return send(res,409,{ok:false,error:'FULFILLMENT_NOT_RETRYABLE',message:'لا يمكن إعادة محاولة هذا الطلب قبل تأكيد الدفع وربطه بمورد رقمي.'});
      }
      if (found.rows[0].supplier_status==='completed') return send(res,409,{ok:false,error:'FULFILLMENT_ALREADY_COMPLETED',message:'تم تسليم هذا الطلب بالفعل؛ لا يمكن إعادة شرائه.'});
      await pool.query(`INSERT INTO nexa_fulfillment_jobs(order_id,status,attempt_count,next_attempt_at,locked_at,last_error)
        VALUES($1,'pending',0,NOW(),NULL,'')
        ON CONFLICT(order_id) DO UPDATE SET status='pending',attempt_count=0,failure_count=0,next_attempt_at=NOW(),locked_at=NULL,last_error='',updated_at=NOW()`,[orderId]);
      await pool.query(`UPDATE nexa_orders SET supplier_status='pending',supplier_message='أعيد إرسال الطلب إلى قائمة تنفيذ المورد من لوحة الإدارة.' WHERE id=$1`,[orderId]);
      runSeagmFulfillmentWorker().catch(error=>console.error('manual supplier retry failed',String(error?.message||'unknown').slice(0,120)));
      return send(res,200,{ok:true,message:'تمت جدولة إعادة فحص الطلب باستخدام رقم المورد الأصلي؛ لن يتم إنشاء رقم طلب مختلف.'});
    }
    const adminOrderMatch = url.pathname.match(/^\/api\/admin\/orders\/(NX-[A-F0-9]{20})\/cancel$/);
    if (req.method === 'POST' && adminOrderMatch) {
      const cancelled = await cancelPendingOrder(adminOrderMatch[1]);
      return cancelled ? send(res,200,{ok:true,message:'تم إلغاء الطلب المعلّق.'}) : send(res,409,{ok:false,message:'لا يمكن إلغاء هذا الطلب؛ قد يكون مدفوعاً أو منتهياً.'});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/shamcash/wallets') {
      try {
        const payload=await shamApi('GET','/v1/wallets'); const wallets=Array.isArray(payload)?payload:Array.isArray(payload?.data)?payload.data:[];
        return send(res,200,{ok:true,data:wallets.map(w=>({id:w.id,provider:w.provider,providerDisplayName:w.providerDisplayName,label:w.label,walletAddress:w.walletAddress,accountNumber:w.accountNumber,status:w.status}))});
      } catch (error) { if(error instanceof ProviderError)return send(res,502,{error:error.code,message:providerMessage(error)}); throw error; }
    }

    if (req.method === 'GET' && url.pathname === '/api/payments/config') {
      let enabled = paymentsReady, receiverLabel = cfg.receiverLabel, receiverAddress = cfg.receiverAddress;
      let message = 'الدفع بانتظار ضبط مفاتيح API والمحفظة وقاعدة البيانات على الخادم.';
      if (enabled) {
        try { const wallet = await getWallet(); receiverLabel = String(wallet.label || receiverLabel); receiverAddress = String(wallet.walletAddress || receiverAddress); message = 'تم التحقق من وجود محفظة شام كاش نشطة. كل طلب ينشئ فاتورة رسمية ويُتحقق من العملية عبر API.'; }
        catch (error) { enabled = false; message = error instanceof ProviderError ? providerMessage(error) : 'تعذر التحقق من محفظة الاستلام حالياً.'; }
      }
      return send(res,200,{enabled,provider:'Sham Cash',currency:'SYP',currencies:['SYP','USD'],sypPerUsd:Number(storeSettings?.fxRate || 145),fxReady:fxRateReady(),fxMode:storeSettings?.fxMode || 'manual',fxUpdatedAt:storeSettings?.fxUpdatedAt || null,fxSource:storeSettings?.fxMode === 'api' ? 'SP Today API V2' : 'سعر يدوي في لوحة Nexa',receiverLabel,receiverAddress,orderTtlMinutes:cfg.orderTtlMinutes,maxTransactionAgeMinutes:Math.round(cfg.maxAgeMs/60_000),message});
    }
    const orderLookup = url.pathname.match(/^\/api\/orders\/(NX-[A-F0-9]{20})$/);
    if (req.method === 'GET' && orderLookup) {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const q = await pool.query(`SELECT o.id,o.product_label,o.amount_minor,o.currency,o.status,o.expires_at,o.invoice_number,o.invoice_identifier,o.wallet_label,o.wallet_address,o.customer_name,o.paid_at,p.transaction_id,o.supplier_provider,o.supplier_status,o.supplier_message,o.supplier_order_id,o.supplier_result_encrypted
        FROM nexa_orders o LEFT JOIN nexa_payments p ON p.order_id=o.id WHERE o.id=$1`,[orderLookup[1]]);
      if (!q.rowCount) return send(res,404,{error:'ORDER_NOT_FOUND',message:'لم يتم العثور على الطلب.'});
      const o=q.rows[0];
      const delivery=o.status==='paid'?supplierDeliveryForOrder(o):null;
      const receipt = o.status === 'paid' ? {orderId:o.id,product:o.product_label,amountMinor:String(o.amount_minor),currency:o.currency,customerName:o.customer_name,invoiceNumber:o.invoice_number,transactionId:o.transaction_id,paidAt:o.paid_at ? new Date(o.paid_at).toISOString() : null,receiverLabel:o.wallet_label,receiverAddress:o.invoice_identifier,...(delivery?{delivery}:{})} : null;
      return send(res,200,{ok:true,orderId:o.id,product:o.product_label,amountMinor:String(o.amount_minor),currency:o.currency,status:o.status,expiresAt:new Date(o.expires_at).toISOString(),invoiceNumber:o.invoice_number,invoiceIdentifier:o.invoice_identifier,receiverLabel:o.wallet_label,receiverAddress:o.invoice_identifier,delivery,receipt});
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      if (rateLimit(req,res,`order:${ip}`,8,60_000)) return;
      const input = await bodyJson(req);
      const customer = await currentCustomer(req);
      const result = await createOrder(input,customer);
      if (isHttpErrorResult(result)) return send(res, result.status, { error:result.error, message:result.message });
      // "pending_payment" is an order state, not an HTTP status code.
      return send(res, 201, { ok:true, ...result });
    }
    if (req.method === 'POST' && url.pathname === '/api/shamcash/verify') {
      if (rateLimit(req,res,`verify:${ip}`,8,5*60_000)) return;
      const input = await bodyJson(req);
      const result = await verifyPayment(input);
      const headers = result.retryAfter ? {'Retry-After':String(result.retryAfter)} : {};
      // "paid" is business data; a successful verification uses HTTP 200.
      return send(res, httpStatusForResult(result, 200), result, headers);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/')) return send(res,404,{error:'NOT_FOUND'});
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(req,res,url.pathname);
    return send(res,405,{error:'METHOD_NOT_ALLOWED'});
  } catch (error) {
    const statusCode = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const logPath=url.pathname.startsWith('/api/webhooks/wamda/')?'/api/webhooks/wamda/[redacted]':url.pathname;
    console.error(JSON.stringify({ event:'request_failed', method:req.method, path:logPath, code:error?.code || null, message:error?.message || 'unknown_error', status:statusCode }));
    return send(res,statusCode,{
      error:error?.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',
      message:statusCode === 500 ? 'حدث خطأ داخلي. لم يتم تأكيد الدفع.' : 'تعذر معالجة الطلب.',
    });
  }
});
server.listen(cfg.port,()=>{
  console.log(`Nexa server listening on ${cfg.port}; paymentsReady=${paymentsReady}`);
});