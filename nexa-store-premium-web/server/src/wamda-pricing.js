function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUnitMoney(value) {
  return Math.round((value + Number.EPSILON) * 1_000_000_000_000) / 1_000_000_000_000;
}

/**
 * Calculate a sell price for one supplier unit. Keep the existing 2-decimal
 * rule for normal unit prices, but preserve up to 12 decimal places when
 * rounding a tiny per-unit cost to cents would turn it into zero.
 */
export function calculateWamdaSellUnitPriceSyp({
  unitPriceUsd,
  fxRate,
  marginPercent = 0,
  pricingRule,
} = {}) {
  const costUsd = Number(unitPriceUsd);
  const exchangeRate = Number(fxRate);
  if (!Number.isFinite(costUsd) || costUsd <= 0 || costUsd > 1_000_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_UNIT_PRICE'), { status:422 });
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_FX_RATE'), { status:422 });
  }
  const rule = pricingRule
    ? normalizeWamdaPricingRule(pricingRule)
    : { mode:'percent', value:normalizeWamdaMargin(marginPercent) };
  const baseCostSyp = costUsd * exchangeRate;
  const calculated = rule.mode === 'fixed_price'
    ? rule.value
    : rule.mode === 'fixed_profit'
      ? baseCostSyp + rule.value
      : baseCostSyp * (1 + rule.value / 100);
  const centsRounded = roundMoney(calculated);
  const unitPrice = centsRounded > 0 ? centsRounded : roundUnitMoney(calculated);
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || unitPrice > 1_000_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_CALCULATED_PRICE'), { status:422 });
  }
  return unitPrice;
}

/**
 * Convert a supplier unit price to minor currency units only after applying
 * the requested quantity. This prevents per-unit sub-cent prices from being
 * rounded to zero before the customer's minimum/selected quantity is applied.
 */
export function supplierUnitPriceToMinor(unitPriceSyp, quantity) {
  const unit = Number(unitPriceSyp);
  const qty = Number(quantity);
  if (!Number.isFinite(unit) || unit <= 0 || unit > 1_000_000_000 ||
      !Number.isSafeInteger(qty) || qty <= 0 || qty > 1_000_000) {
    throw Object.assign(new Error('INVALID_SUPPLIER_UNIT_PRICE'), { status:422 });
  }
  const fixed = unit.toFixed(12);
  const [whole, fraction = ''] = fixed.split('.');
  const scale = 1_000_000_000_000n;
  const unitScaled = BigInt(whole) * scale + BigInt((fraction + '000000000000').slice(0, 12));
  const totalScaled = unitScaled * BigInt(qty);
  return (totalScaled * 100n + scale / 2n) / scale;
}

export function normalizeWamdaMargin(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin) || margin < 0 || margin > 1000) {
    throw Object.assign(new Error('INVALID_WAMDA_PROFIT_MARGIN'), { status:400 });
  }
  return roundMoney(margin);
}

export function normalizeWamdaPricingRule(rule, { allowInherit = false } = {}) {
  if (allowInherit && rule?.mode === 'inherit') return { mode:'inherit' };
  const mode = String(rule?.mode || '');
  if (!['percent','fixed_profit','fixed_price'].includes(mode)) {
    throw Object.assign(new Error('INVALID_WAMDA_PRICING_MODE'), { status:400 });
  }
  const value = Number(rule?.value);
  const minimum = mode === 'fixed_price' ? 0.01 : 0;
  if (!Number.isFinite(value) || value < minimum || value > 1_000_000_000 ||
      (mode === 'percent' && value > 1000)) {
    throw Object.assign(new Error('INVALID_WAMDA_PRICING_VALUE'), { status:400 });
  }
  return { mode, value:roundMoney(value) };
}

export function resolveWamdaPricingRule({
  globalRule = { mode:'percent', value:0 },
  categoryRule = null,
  productRule = null,
} = {}) {
  const layers = [
    ['product', productRule],
    ['category', categoryRule],
    ['global', globalRule],
  ];
  for (const [source, candidate] of layers) {
    if (!candidate) continue;
    const normalized = normalizeWamdaPricingRule(candidate, { allowInherit:true });
    if (normalized.mode !== 'inherit') return { rule:normalized, source };
  }
  return { rule:{ mode:'percent', value:0 }, source:'global' };
}

export function calculateWamdaSellPriceSyp({
  unitPriceUsd,
  fxRate,
  marginPercent = 0,
  pricingRule,
} = {}) {
  const costUsd = Number(unitPriceUsd);
  const exchangeRate = Number(fxRate);
  if (!Number.isFinite(costUsd) || costUsd <= 0 || costUsd > 1_000_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_UNIT_PRICE'), { status:422 });
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_FX_RATE'), { status:422 });
  }
  const rule = pricingRule
    ? normalizeWamdaPricingRule(pricingRule)
    : { mode:'percent', value:normalizeWamdaMargin(marginPercent) };
  const baseCostSyp = costUsd * exchangeRate;
  const calculated = rule.mode === 'fixed_price'
    ? rule.value
    : rule.mode === 'fixed_profit'
      ? baseCostSyp + rule.value
      : baseCostSyp * (1 + rule.value / 100);
  const rounded = roundMoney(calculated);
  if (!Number.isFinite(rounded) || rounded <= 0 || rounded > 1_000_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_CALCULATED_PRICE'), { status:422 });
  }
  return rounded;
}

export function updateWamdaPublishedProduct(existing, source, {
  fxRate,
  marginPercent = 0,
  globalRule,
  categoryRule,
  syncedAt = new Date().toISOString(),
  forceAutomatic = false,
} = {}) {
  if (!existing || !source || typeof existing !== 'object' || typeof source !== 'object') {
    throw new Error('INVALID_WAMDA_PRODUCT_UPDATE');
  }
  const currentWamda = existing.wamda?.provider === 'wamda' ? existing.wamda : {};
  let productOverride = source.pricingOverride ?? currentWamda.pricingOverride ?? null;
  if (forceAutomatic) productOverride = { mode:'inherit' };
  if (!productOverride && currentWamda.priceMode === 'manual' &&
      Number.isFinite(Number(currentWamda.manualPriceSyp)) && Number(currentWamda.manualPriceSyp) > 0) {
    productOverride = { mode:'fixed_price', value:Number(currentWamda.manualPriceSyp) };
  }
  const normalizedOverride = normalizeWamdaPricingRule(productOverride || { mode:'inherit' }, { allowInherit:true });
  const resolved = resolveWamdaPricingRule({
    globalRule:globalRule || { mode:'percent', value:normalizeWamdaMargin(marginPercent) },
    categoryRule,
    productRule:normalizedOverride,
  });
  const calculatedPriceSyp = calculateWamdaSellUnitPriceSyp({
    unitPriceUsd:source.unitPrice,
    fxRate,
    pricingRule:resolved.rule,
  });
  const isFixedProductPrice = normalizedOverride.mode === 'fixed_price';
  const manualPriceSyp = isFixedProductPrice ? normalizedOverride.value : null;
  const sellPriceSyp = calculatedPriceSyp;
  const options = Array.isArray(existing.options) ? existing.options.map(option => ({...option})) : [];
  const firstOption = options[0] || {
    id:'wamda-default', name:'الخيار الأساسي', desc:'منتج مرتبط بمصدر ومضة', flag:'⚡', packs:[['سعر البيع',sellPriceSyp]],
  };
  const packs = Array.isArray(firstOption.packs) ? firstOption.packs.map(pack => [...pack]) : [];
  if (packs.length) packs[0] = [String(packs[0][0] || 'سعر البيع'), sellPriceSyp];
  else packs.push(['سعر البيع',sellPriceSyp]);
  firstOption.packs = packs;
  if (!options.length) options.push(firstOption);
  else options[0] = firstOption;

  return {
    ...existing,
    name:String(existing.manualOverrides?.name ?? source.name ?? existing.name ?? '').slice(0,120),
    desc:String(existing.manualOverrides?.desc ?? source.description ?? existing.desc ?? '').slice(0,700),
    options,
    wamda:{
      ...currentWamda,
      provider:'wamda',
      categoryId:Number(source.categoryId),
      productId:Number(source.id),
      minimumQuantity:Number(source.minQuantity || 1),
      maximumQuantity:Number(source.maxQuantity || source.minQuantity || 1),
      fields:Array.isArray(source.fields)?source.fields.map(field=>({...field})):[],
      sourcePrice:Number(source.sourcePrice || source.unitPrice),
      pricePerQuantity:Number(source.pricePerQuantity || 1),
      unitPrice:Number(source.unitPrice),
      currency:String(source.currency || 'USD'),
      available:source.available !== false,
      missingFromLatestSync:false,
      priceMode:isFixedProductPrice?'manual':'auto',
      manualPriceSyp,
      pricingOverride:normalizedOverride,
      resolvedPricingRule:resolved.rule,
      pricingSource:resolved.source,
      calculatedPriceSyp,
      sellPriceSyp,
      marginPercent:resolved.rule.mode==='percent'?resolved.rule.value:null,
      profitAmountSyp:resolved.rule.mode==='fixed_profit'?resolved.rule.value:null,
      fxRate:Number(fxRate),
      lastSyncedAt:syncedAt,
    },
  };
}

export function markWamdaProductUnavailable(existing, syncedAt = new Date().toISOString()) {
  if (!existing || existing.wamda?.provider !== 'wamda') return existing;
  return {
    ...existing,
    wamda:{
      ...existing.wamda,
      available:false,
      missingFromLatestSync:true,
      lastSyncedAt:syncedAt,
    },
  };
}
