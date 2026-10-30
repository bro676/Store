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
  validateCatalog, mergeCatalog, isSafeCatalogImage, getJsonPath, normalizeFxRate, validateCatalogApiUrl,
} from './admin-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
let catalog = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'catalog.json'), 'utf8'));
let storeSettings = null;
let fxApiTokenRuntime = '';
let catalogApiTokenRuntime = '';
let catalogApiSyncInProgress = false;
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
  for (const migration of ['001_init.sql', '002_shamcash_invoices.sql', '003_store_admin.sql']) {
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
async function createOrder(input) {
  if (!paymentsReady) return { error:'PAYMENTS_NOT_READY', status:503, message:'الدفع غير متاح حتى تكتمل إعدادات API وقاعدة البيانات على الخادم.' };
  const pack = findPack(input.categoryId, input.productId, input.optionId, Number(input.packIndex));
  if (!pack) return { error:'INVALID_PRODUCT', status:400, message:'الباقة غير متاحة أو سعرها غير محدد.' };
  const currency = String(input.currency || 'SYP').trim().toUpperCase();
  if (!['SYP','USD'].includes(currency)) return { error:'INVALID_CURRENCY', status:400, message:'اختر الليرة السورية أو الدولار الأمريكي.' };
  const pricedPack = pricePack(pack, currency);
  if (!pricedPack) return { error:'INVALID_PRICE', status:400, message:'تعذر حساب السعر بالعملة المختارة.' };
  const name = String(input.customerName || '').trim().slice(0,70);
  const phone = String(input.customerPhone || '').trim().slice(0,25);
  const gameAccount = String(input.accountId || '').trim().slice(0,80);
  const notes = String(input.notes || '').trim().slice(0,500);
  if (name.length < 2 || !/^\+?[0-9\s()-]{7,20}$/.test(phone)) return {error:'INVALID_CUSTOMER',status:400,message:'يرجى إدخال الاسم ورقم هاتف صحيح.'};
  let wallet, invoice, id, persisted = false;
  try {
    wallet = await getWallet(true);
    id = `NX-${crypto.randomBytes(10).toString('hex').toUpperCase()}`;
    invoice = await createShamInvoice(id, pricedPack, wallet);
    await pool.query(`INSERT INTO nexa_orders (id,category_id,product_id,option_id,pack_index,product_label,amount_minor,currency,customer_name,customer_phone,game_account,notes,expires_at,invoice_number,invoice_identifier,wallet_label,wallet_address)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id,input.categoryId,input.productId,input.optionId,Number(input.packIndex),pricedPack.label,pricedPack.amountMinor.toString(),pricedPack.currency,name,phone,gameAccount,notes,invoice.expiresAt,invoice.invoiceNumber,invoice.identifier,invoice.walletLabel,invoice.walletAddress]);
    persisted = true;
    return {
      orderId:id, product:pricedPack.label, amountMinor:pricedPack.amountMinor.toString(), currency:pricedPack.currency, expiresAt:invoice.expiresAt.toISOString(),
      invoiceNumber:invoice.invoiceNumber, invoiceIdentifier:invoice.identifier, receiverLabel:invoice.walletLabel,
      receiverAddress:invoice.identifier, status:'pending_payment',
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
      if (used.rowCount && used.rows[0].transaction_id === transactionRef) return {ok:true,alreadyPaid:true,orderId,transactionId:transactionRef,status:'paid',receipt:{orderId,product:order.product_label,amountMinor:String(order.amount_minor),currency:order.currency,customerName:order.customer_name,invoiceNumber:order.invoice_number,transactionId:transactionRef,paidAt:order.paid_at ? new Date(order.paid_at).toISOString() : new Date().toISOString(),receiverLabel:order.wallet_label,receiverAddress:order.invoice_identifier}};
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
    await client.query("UPDATE nexa_orders SET status='paid',paid_at=$2 WHERE id=$1",[orderId,paidAt]);
    await client.query('COMMIT');
    return {ok:true,orderId,invoiceNumber:order.invoice_number,transactionId:transactionRef,status:'paid',verifiedAt:new Date().toISOString(),
      receipt:{orderId,product:order.product_label,amountMinor:String(order.amount_minor),currency:order.currency,customerName:order.customer_name,
        invoiceNumber:order.invoice_number,transactionId:transactionRef,paidAt:paidAt.toISOString(),receiverLabel:order.wallet_label,receiverAddress:order.invoice_identifier}};
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
    themePrimary:'#376f5f', themeSecondary:'#8ba995', themeDark:'#24433a',
    fxMode:'manual', fxRate:145, fxApiUrl:'', fxJsonPath:'', fxUnit:'new',
    fxAuthHeader:'Authorization', fxAuthPrefix:'Bearer', fxUpdatedAt:null, fxLastError:'',
    catalogApiMode:'manual', catalogApiUrl:'', catalogApiJsonPath:'catalog',
    catalogApiAuthHeader:'Authorization', catalogApiAuthPrefix:'Bearer', catalogApiSyncMode:'merge',
    catalogApiIntervalMinutes:15, catalogApiLastSyncAt:null, catalogApiLastAttemptAt:null, catalogApiLastError:'',
    catalogApiTokenEncrypted:'', catalogApiTokenCleared:false,
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
    if (storeSettings.themePrimary === '#e23b57' && storeSettings.themeSecondary === '#547ee8' && storeSettings.themeDark === '#101a2e') {
      storeSettings.themePrimary = '#376f5f';
      storeSettings.themeSecondary = '#8ba995';
      storeSettings.themeDark = '#24433a';
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(storeSettings)]);
    }
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
    themePrimary:String(storeSettings?.themePrimary || '#376f5f'),
    themeSecondary:String(storeSettings?.themeSecondary || '#8ba995'),
    themeDark:String(storeSettings?.themeDark || '#24433a'),
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
  const { shamApiTokenEncrypted, fxApiTokenEncrypted, catalogApiTokenEncrypted, ...settings } = storeSettings || {};
  return { ...settings, shamApiTokenConfigured:Boolean(cfg.apiToken), fxApiTokenConfigured:Boolean(fxApiTokenRuntime), catalogApiTokenConfigured:Boolean(catalogApiTokenRuntime) };
}
function validateAndApplySettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_SETTINGS');
  const next = { ...storeSettings };
  const setText = (key, max, fallback = '') => {
    if (input[key] === undefined) return;
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error(`INVALID_${key.toUpperCase()}`);
    next[key] = input[key].trim() || fallback;
  };
  setText('storeName',80,'Nexa Store');
  setText('announcement',240,'');
  for (const key of ['themePrimary','themeSecondary','themeDark']) if (input[key] !== undefined) {
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
function upsertCatalogProduct(input) {
  if (!input || typeof input.categoryId !== 'string' || !input.product || typeof input.product !== 'object') throw new Error('INVALID_CATALOG_PRODUCT_REQUEST');
  const categoryIndex = catalog.findIndex(category=>category.id===input.categoryId);
  if (categoryIndex < 0) throw Object.assign(new Error('CATEGORY_NOT_FOUND'),{status:404});
  const validated = validateCatalog([{id:'api-products',name:'API Products',desc:'API validation',image:'assets/brand/logo.svg',items:[input.product]}])[0].items[0];
  const next = JSON.parse(JSON.stringify(catalog));
  const items = next[categoryIndex].items;
  const productIndex = items.findIndex(product=>product.id===validated.id);
  if (productIndex < 0) items.push(validated);
  else items[productIndex] = validated;
  return { catalog:validateCatalog(next),created:productIndex<0,productId:validated.id };
}

async function cancelPendingOrder(orderId) {
  if (!pool) throw Object.assign(new Error('DATABASE_NOT_CONFIGURED'),{status:503});
  const found = await pool.query("SELECT id,invoice_number FROM nexa_orders WHERE id=$1 AND status='pending_payment' AND expires_at>NOW()",[orderId]);
  if (!found.rowCount) return false;
  if (found.rows[0].invoice_number) await shamApi('DELETE',`/v1/invoices/${encodeURIComponent(found.rows[0].invoice_number)}`);
  const result = await pool.query("UPDATE nexa_orders SET status='cancelled' WHERE id=$1 AND status='pending_payment' AND expires_at>NOW() RETURNING id",[orderId]);
  return Boolean(result.rowCount);
}

await initializeStoreState();
if (storeSettings?.fxMode === 'api') refreshAutomaticFx().catch(error=>console.error('initial FX refresh failed',error.message));
if (storeSettings?.catalogApiMode === 'auto') syncCatalogFromApi().catch(error=>console.error('initial catalogue API sync failed',error.message));
const fxRefreshTimer = setInterval(()=>{ if (storeSettings?.fxMode === 'api') refreshAutomaticFx().catch(error=>console.error('scheduled FX refresh failed',error.message)); },5*60_000);
fxRefreshTimer.unref?.();
const catalogSyncTimer = setInterval(()=>{
  if (storeSettings?.catalogApiMode !== 'auto' || catalogApiSyncInProgress) return;
  const last = new Date(storeSettings.catalogApiLastAttemptAt || storeSettings.catalogApiLastSyncAt || 0).getTime();
  const interval = Math.max(5,Number(storeSettings.catalogApiIntervalMinutes || 15))*60_000;
  if (!Number.isFinite(last) || Date.now()-last >= interval) syncCatalogFromApi().catch(error=>console.error('scheduled catalogue API sync failed',error.message));
},60_000);
catalogSyncTimer.unref?.();

const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = String(process.env.TRUST_PROXY === 'true' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true,service:'nexa-shamcash-gateway',paymentsReady,dbReady:Boolean(pool)});

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
    if (url.pathname.startsWith('/api/admin/') && !adminAuthorized(req)) {
      return send(res,401,{ok:false,error:'UNAUTHORIZED',message:'سجّل الدخول إلى لوحة الإدارة أولاً.'});
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      return send(res,200,{ok:true,catalog});
    }
    if (req.method === 'GET' && url.pathname === '/api/storefront-config') {
      return send(res,200,{ok:true,...publicSettings()});
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
    if (req.method === 'GET' && url.pathname === '/api/admin/catalog') {
      return send(res,200,{ok:true,catalog});
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin/catalog') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,4_000_000);
      const nextCatalog = validateCatalog(input.catalog);
      await persistCatalog(nextCatalog);
      return send(res,200,{ok:true,message:'تم حفظ الكتالوج بنجاح.',catalog});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/products') {
      if (rateLimit(req,res,`catalog-write:${ip}`,40,60_000)) return;
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,2_800_000);
      const result = upsertCatalogProduct(input);
      await persistCatalog(result.catalog);
      return send(res,result.created?201:200,{ok:true,created:result.created,productId:result.productId,message:result.created?'تمت إضافة المنتج عبر API.':'تم تحديث المنتج عبر API.'});
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/catalog/sync-status') {
      return send(res,200,{ok:true,mode:storeSettings.catalogApiMode,lastSyncAt:storeSettings.catalogApiLastSyncAt||null,lastError:storeSettings.catalogApiLastError||'',syncInProgress:catalogApiSyncInProgress,configured:Boolean(storeSettings.catalogApiUrl),tokenConfigured:Boolean(catalogApiTokenRuntime)});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/sync-preview') {
      if (rateLimit(req,res,`catalog-sync:${ip}`,5,60_000)) return;
      const result = await syncCatalogFromApi({preview:true});
      return send(res,200,result);
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/catalog/sync') {
      if (rateLimit(req,res,`catalog-sync:${ip}`,5,60_000)) return;
      const result = await syncCatalogFromApi();
      return send(res,200,result);
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/settings') {
      return send(res,200,{ok:true,settings:safeSettingsForAdmin(),paymentsReady,fxReady:fxRateReady()});
    }
    if (req.method === 'PATCH' && url.pathname === '/api/admin/settings') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const input = await bodyJson(req,3_000_000);
      const nextSettings = validateAndApplySettings(input);
      await pool.query("UPDATE nexa_store_state SET settings=$1::jsonb,updated_at=NOW() WHERE singleton=TRUE",[JSON.stringify(nextSettings)]);
      storeSettings = nextSettings;
      applyStoreSettings();
      return send(res,200,{ok:true,settings:safeSettingsForAdmin(),paymentsReady,fxReady:fxRateReady()});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/fx/refresh') {
      const result = await refreshAutomaticFx();
      return send(res,result.ok?200:422,result);
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/orders') {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const limit = Math.min(200,Math.max(1,Number(url.searchParams.get('limit')||100)));
      const result = await pool.query(`SELECT id,product_label,amount_minor::text,currency,status,customer_name,customer_phone,game_account,notes,invoice_number,invoice_identifier,wallet_label,created_at,expires_at,paid_at FROM nexa_orders ORDER BY created_at DESC LIMIT $1`,[limit]);
      return send(res,200,{ok:true,orders:result.rows.map(o=>({...o,amountMinor:o.amount_minor,createdAt:o.created_at,expiresAt:o.expires_at,paidAt:o.paid_at}))});
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
      const q = await pool.query(`SELECT o.id,o.product_label,o.amount_minor,o.currency,o.status,o.expires_at,o.invoice_number,o.invoice_identifier,o.wallet_label,o.wallet_address,o.customer_name,o.paid_at,p.transaction_id
        FROM nexa_orders o LEFT JOIN nexa_payments p ON p.order_id=o.id WHERE o.id=$1`,[orderLookup[1]]);
      if (!q.rowCount) return send(res,404,{error:'ORDER_NOT_FOUND',message:'لم يتم العثور على الطلب.'});
      const o=q.rows[0];
      const receipt = o.status === 'paid' ? {orderId:o.id,product:o.product_label,amountMinor:String(o.amount_minor),currency:o.currency,customerName:o.customer_name,invoiceNumber:o.invoice_number,transactionId:o.transaction_id,paidAt:o.paid_at ? new Date(o.paid_at).toISOString() : null,receiverLabel:o.wallet_label,receiverAddress:o.invoice_identifier} : null;
      return send(res,200,{ok:true,orderId:o.id,product:o.product_label,amountMinor:String(o.amount_minor),currency:o.currency,status:o.status,expiresAt:new Date(o.expires_at).toISOString(),invoiceNumber:o.invoice_number,invoiceIdentifier:o.invoice_identifier,receiverLabel:o.wallet_label,receiverAddress:o.invoice_identifier,receipt});
    }
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      if (rateLimit(req,res,`order:${ip}`,8,60_000)) return;
      const input = await bodyJson(req);
      const result = await createOrder(input);
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
    console.error(JSON.stringify({ event:'request_failed', method:req.method, path:url.pathname, code:error?.code || null, message:error?.message || 'unknown_error', status:statusCode }));
    return send(res,statusCode,{
      error:error?.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'INTERNAL_ERROR',
      message:statusCode === 500 ? 'حدث خطأ داخلي. لم يتم تأكيد الدفع.' : 'تعذر معالجة الطلب.',
    });
  }
});
server.listen(cfg.port,()=>{
  console.log(`Nexa server listening on ${cfg.port}; paymentsReady=${paymentsReady}`);
});
