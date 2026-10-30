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

export function validateCatalog(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 40) throw new Error('INVALID_CATALOG');
  validateUniqueIds(input, 'CATEGORY');
  for (const category of input) {
    requiredText(category.name, 100, 'CATEGORY_NAME');
    if (typeof category.desc !== 'string' || category.desc.length > 500) throw new Error('INVALID_CATEGORY_DESC');
    if (!isSafeCatalogImage(category.image)) throw new Error('INVALID_CATEGORY_IMAGE');
    if (category.icon !== undefined && (typeof category.icon !== 'string' || category.icon.length > 12)) throw new Error('INVALID_CATEGORY_ICON');
    if (!Array.isArray(category.items) || category.items.length > 200) throw new Error('INVALID_CATEGORY_ITEMS');
    validateUniqueIds(category.items, 'PRODUCT');
    for (const product of category.items) {
      requiredText(product.name, 120, 'PRODUCT_NAME');
      if (typeof product.desc !== 'string' || product.desc.length > 700) throw new Error('INVALID_PRODUCT_DESC');
      if (!isSafeCatalogImage(product.image)) throw new Error('INVALID_PRODUCT_IMAGE');
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
          if (!Number.isFinite(pack[1]) || pack[1] < 0 || pack[1] > 1_000_000_000 || !/^\d+(?:\.\d{1,2})?$/.test(String(pack[1]))) throw new Error('INVALID_PACK_PRICE');
        }
      }
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

export function mergeCatalog(existing, incoming, mode = 'merge') {
  const current = validateCatalog(existing);
  const next = validateCatalog(incoming);
  if (mode === 'replace') return next;
  if (mode !== 'merge') throw new Error('INVALID_CATALOG_SYNC_MODE');
  const merged = current.map(category => JSON.parse(JSON.stringify(category)));
  for (const incomingCategory of next) {
    const categoryIndex = merged.findIndex(category => category.id === incomingCategory.id);
    if (categoryIndex < 0) {
      merged.push(JSON.parse(JSON.stringify(incomingCategory)));
      continue;
    }
    const oldCategory = merged[categoryIndex];
    const oldProducts = new Map(oldCategory.items.map(product => [product.id, product]));
    const incomingIds = new Set(incomingCategory.items.map(product => product.id));
    const items = incomingCategory.items.map(product => ({
      ...(oldProducts.get(product.id) || {}),
      ...JSON.parse(JSON.stringify(product)),
    }));
    for (const oldProduct of oldCategory.items) {
      if (!incomingIds.has(oldProduct.id)) items.push(oldProduct);
    }
    merged[categoryIndex] = { ...oldCategory, ...JSON.parse(JSON.stringify(incomingCategory)), items };
  }
  return validateCatalog(merged);
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
  if (productIndex < 0) items.push(validated);
  else items[productIndex] = validated;
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
