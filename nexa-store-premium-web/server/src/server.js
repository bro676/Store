import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { httpStatusForResult, isHttpErrorResult, safeHttpStatus } from './http-status.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const catalog = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'catalog.json'), 'utf8'));
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
  walletId: process.env.SHAM_WALLET_ID || '',
  receiverLabel: process.env.SHAM_RECEIVER_LABEL || 'محفظة Nexa Store',
  receiverAddress: process.env.SHAM_RECEIVER_ADDRESS || '',
  timezoneOffsetMinutes: Number(process.env.SHAM_TIMEZONE_OFFSET_MINUTES || 180),
  sypPerUsd: Number(process.env.SYP_PER_USD || 0),
  fxUpdatedAt: process.env.SYP_PER_USD_UPDATED_AT || '',
  fxSource: process.env.SYP_PER_USD_SOURCE || '',
};

const fxTimestamp = new Date(cfg.fxUpdatedAt).getTime();
const fxReady = Number.isFinite(cfg.sypPerUsd) && cfg.sypPerUsd > 0 &&
  Number.isFinite(fxTimestamp) && Date.now() - fxTimestamp >= -90_000 &&
  Date.now() - fxTimestamp <= 15 * 60_000 &&
  String(cfg.fxSource).includes('api-v2.sp-today.com');
const providerConfigReady = Boolean(cfg.apiToken && Buffer.byteLength(cfg.apiToken) <= 256 && cfg.walletId &&
  Number.isInteger(cfg.orderTtlMinutes) && cfg.orderTtlMinutes >= 5 && cfg.orderTtlMinutes <= 1440 &&
  cfg.maxAgeMs > 0 && cfg.futureSkewMs >= 0 && Number.isInteger(cfg.timezoneOffsetMinutes) &&
  Math.abs(cfg.timezoneOffsetMinutes) <= 840);
const paymentsReady = cfg.paymentsEnabled && Boolean(cfg.databaseUrl) && providerConfigReady;
let pool;
if (cfg.databaseUrl) {
  pool = new Pool({ connectionString: cfg.databaseUrl, ssl: cfg.databaseSsl ? { rejectUnauthorized: true } : false,
    max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });
  for (const migration of ['001_init.sql', '002_shamcash_invoices.sql']) {
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
async function bodyJson(req) {
  let data = ''; for await (const chunk of req) { data += chunk; if (data.length > MAX_BODY) throw Object.assign(new Error('BODY_TOO_LARGE'), { status: 413 }); }
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
  return { label: `${product.name} — ${option.name} — ${pack[0]}`, amountMinor: BigInt(pack[1]) * 100n };
}
function pricePack(pack, currency) {
  if (currency === 'SYP') return { ...pack, currency, amountMinor:pack.amountMinor };
  if (currency !== 'USD' || !fxReady) return null;
  const rateScaled = BigInt(Math.round(cfg.sypPerUsd * 10_000));
  if (rateScaled <= 0n) return null;
  const amountMinor = (pack.amountMinor * 10_000n + rateScaled / 2n) / rateScaled;
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
      if (used.rowCount && used.rows[0].transaction_id === transactionRef) return {ok:true,alreadyPaid:true,orderId,transactionId:transactionRef,status:'paid'};
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
    return {ok:true,orderId,invoiceNumber:order.invoice_number,transactionId:transactionRef,status:'paid',verifiedAt:new Date().toISOString()};
  } catch (error) {
    await client.query('ROLLBACK').catch(()=>{});
    if (error.code === '23505') return {error:'TRAN_ID_USED',status:409,message:'رقم العملية مستخدم مسبقاً ولا يمكن استخدامه مرة ثانية.'};
    throw error;
  } finally { client.release(); }
}
async function serveStatic(req, res, pathname) {
  if (!(pathname === '/' || pathname === '/index.html' || pathname.startsWith('/assets/'))) return send(res,404,{error:'NOT_FOUND'});
  let target = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const abs = path.resolve(ROOT, '.' + target);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return send(res,404,{error:'NOT_FOUND'});
  try {
    const data = await fs.readFile(abs);
    res.writeHead(200, {'Content-Type':mime[path.extname(abs)] || 'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self' data: blob: https:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"});
    res.end(data);
  } catch { send(res,404,{error:'NOT_FOUND'}); }
}
const server = http.createServer(async (req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = String(process.env.TRUST_PROXY === 'true' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress) : req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true,service:'nexa-shamcash-gateway',paymentsReady,dbReady:Boolean(pool)});
    if (req.method === 'GET' && url.pathname === '/api/admin/shamcash/wallets') {
      const supplied=Buffer.from(String(req.headers['x-admin-key'] || '')); const expected=Buffer.from(cfg.adminApiKey);
      if (!cfg.adminApiKey || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) return send(res,401,{error:'UNAUTHORIZED'});
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
      return send(res,200,{enabled,provider:'Sham Cash',currency:'SYP',currencies:['SYP','USD'],sypPerUsd:fxReady?cfg.sypPerUsd:0,fxReady,fxUpdatedAt:fxReady?cfg.fxUpdatedAt:null,fxSource:fxReady?cfg.fxSource:null,receiverLabel,receiverAddress,orderTtlMinutes:cfg.orderTtlMinutes,maxTransactionAgeMinutes:Math.round(cfg.maxAgeMs/60_000),message});
    }
    const orderLookup = url.pathname.match(/^\/api\/orders\/(NX-[A-F0-9]{20})$/);
    if (req.method === 'GET' && orderLookup) {
      if (!pool) return send(res,503,{error:'DATABASE_NOT_CONFIGURED'});
      const q = await pool.query('SELECT id,product_label,amount_minor,currency,status,expires_at,invoice_number,invoice_identifier,wallet_label,wallet_address FROM nexa_orders WHERE id=$1',[orderLookup[1]]);
      if (!q.rowCount) return send(res,404,{error:'ORDER_NOT_FOUND',message:'لم يتم العثور على الطلب.'});
      const o=q.rows[0];
      return send(res,200,{ok:true,orderId:o.id,product:o.product_label,amountMinor:String(o.amount_minor),currency:o.currency,status:o.status,expiresAt:new Date(o.expires_at).toISOString(),invoiceNumber:o.invoice_number,invoiceIdentifier:o.invoice_identifier,receiverLabel:o.wallet_label,receiverAddress:o.invoice_identifier});
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
