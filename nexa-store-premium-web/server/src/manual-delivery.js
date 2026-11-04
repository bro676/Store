const SUPPLIER_KEYS = [
  ['wamda', 'wamda'],
  ['seagm', 'seagm'],
  ['bestStore', 'beststore'],
];

export function linkedSupplierForProduct(product = {}) {
  for (const [key, provider] of SUPPLIER_KEYS) {
    if (product?.[key]?.provider === provider) return product[key];
  }
  return null;
}

export function resolveProductFulfillment(product = {}) {
  const supplier = linkedSupplierForProduct(product);
  const requestedMode = String(product?.fulfillmentMode || '').trim().toLowerCase();
  const mode = requestedMode || (supplier ? 'automatic' : 'manual');
  if (!['automatic', 'manual'].includes(mode)) {
    return { valid: false, error: 'INVALID_FULFILLMENT_MODE' };
  }

  const rawHours = product?.manualDeliveryHours ?? 24;
  const hours = Number(rawHours);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 720) {
    return { valid: false, error: 'INVALID_MANUAL_DELIVERY_HOURS' };
  }
  const message = String(product?.manualDeliveryMessage || '').trim();
  if (message.length > 240 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message)) {
    return { valid: false, error: 'INVALID_MANUAL_DELIVERY_MESSAGE' };
  }
  if (mode === 'automatic' && !supplier) {
    return { valid: false, error: 'AUTOMATIC_FULFILLMENT_NOT_CONFIGURED' };
  }

  return {
    valid: true,
    mode,
    provider: mode === 'manual' ? 'manual' : supplier.provider,
    supplier: mode === 'automatic' ? supplier : null,
    manualDeliveryHours: hours,
    manualDeliveryMessage: message,
  };
}

export function buildManualDeliveryMessage(template = '', hours = 24) {
  const safeHours = Number.isSafeInteger(Number(hours)) && Number(hours) >= 1 && Number(hours) <= 720
    ? Number(hours)
    : 24;
  const custom = String(template || '').trim();
  const source = custom || 'تم تأكيد الدفع. طلبك قيد التجهيز اليدوي، وسيصلك خلال {hours} ساعة كحد أقصى.';
  const message = source.includes('{hours}')
    ? source.replaceAll('{hours}', String(safeHours))
    : source + ' مدة التسليم المتوقعة: ' + safeHours + ' ساعة كحد أقصى.';
  return message.slice(0, 500);
}

export function normalizeManualDeliveryDetails(value) {
  const details = String(value ?? '').trim();
  if (!details || details.length > 8000 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(details)) {
    throw Object.assign(new Error('بيانات التسليم اليدوي فارغة أو أطول من الحد المسموح.'), {
      code: 'INVALID_MANUAL_DELIVERY_DETAILS',
      status: 400,
    });
  }
  return details;
}
