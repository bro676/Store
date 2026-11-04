const AUTOMATIC_PROVIDERS = new Set(['seagm','wamda','beststore']);
const MAX_DELIVERY_ETA_HOURS = 720;

function supplierFor(product) {
  if (product?.wamda?.provider === 'wamda') return product.wamda;
  if (product?.seagm?.provider === 'seagm') return product.seagm;
  if (product?.bestStore?.provider === 'beststore') return product.bestStore;
  return null;
}

export function resolveDeliveryPolicy(product = {}) {
  const supplier = supplierFor(product);
  const provider = String(supplier?.provider || '');
  const explicitMode = product?.deliveryMode;
  let mode;
  if (explicitMode === 'automatic' || explicitMode === 'manual') {
    mode = explicitMode;
  } else if (provider === 'seagm') {
    mode = supplier.autoDelivery === true ? 'automatic' : 'manual';
  } else {
    mode = AUTOMATIC_PROVIDERS.has(provider) ? 'automatic' : 'manual';
  }
  if (mode === 'automatic' && !AUTOMATIC_PROVIDERS.has(provider)) mode = 'manual';

  const rawEta = Number(product?.deliveryEtaHours);
  const etaHours = Number.isSafeInteger(rawEta) && rawEta >= 1 && rawEta <= MAX_DELIVERY_ETA_HOURS
    ? rawEta
    : 24;
  const message = typeof product?.deliveryMessage === 'string'
    ? product.deliveryMessage.trim().slice(0, 500)
    : '';

  return Object.freeze({ mode, provider, etaHours, message });
}

export function manualPendingMessage(policy = {}) {
  const eta = Number.isSafeInteger(Number(policy.etaHours)) &&
    Number(policy.etaHours) >= 1 && Number(policy.etaHours) <= MAX_DELIVERY_ETA_HOURS
    ? Number(policy.etaHours)
    : 24;
  const custom = typeof policy.message === 'string' ? policy.message.trim().slice(0, 500) : '';
  return custom || `تم تأكيد الدفع بنجاح. طلبك قيد التجهيز اليدوي، وسيتم إرسال بياناته خلال ${eta} ساعة كحد أقصى. ستجدها في صفحة «طلباتي».`;
}

export function validateManualDeliveryInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Object.assign(new Error('INVALID_MANUAL_DELIVERY_INPUT'), { status: 400 });
  }
  if (typeof input.deliveryData !== 'string') {
    throw Object.assign(new Error('MANUAL_DELIVERY_DATA_REQUIRED'), { status: 400 });
  }
  const deliveryData = input.deliveryData.trim();
  if (!deliveryData || deliveryData.length > 8000 || deliveryData.includes('\0')) {
    throw Object.assign(new Error('INVALID_MANUAL_DELIVERY_DATA'), { status: 400 });
  }
  const customerMessage = input.customerMessage === undefined || input.customerMessage === null
    ? ''
    : String(input.customerMessage).trim();
  if (customerMessage.length > 500) {
    throw Object.assign(new Error('INVALID_MANUAL_DELIVERY_MESSAGE'), { status: 400 });
  }
  return { deliveryData, customerMessage };
}

export const DELIVERY_POLICY_LIMITS = Object.freeze({
  maxEtaHours: MAX_DELIVERY_ETA_HOURS,
  maxDeliveryDataCharacters: 8000,
  maxCustomerMessageCharacters: 500,
});
