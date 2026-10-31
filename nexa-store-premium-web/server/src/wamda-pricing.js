function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function normalizeWamdaMargin(value) {
  const margin = Number(value);
  if (!Number.isFinite(margin) || margin < 0 || margin > 1000) {
    throw Object.assign(new Error('INVALID_WAMDA_PROFIT_MARGIN'), { status:400 });
  }
  return roundMoney(margin);
}

export function calculateWamdaSellPriceSyp({ unitPriceUsd, fxRate, marginPercent = 0 } = {}) {
  const costUsd = Number(unitPriceUsd);
  const exchangeRate = Number(fxRate);
  const margin = normalizeWamdaMargin(marginPercent);
  if (!Number.isFinite(costUsd) || costUsd <= 0 || costUsd > 1_000_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_UNIT_PRICE'), { status:422 });
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_FX_RATE'), { status:422 });
  }
  const calculated = roundMoney(costUsd * exchangeRate * (1 + margin / 100));
  if (!Number.isFinite(calculated) || calculated <= 0 || calculated > 1_000_000_000) {
    throw Object.assign(new Error('INVALID_WAMDA_CALCULATED_PRICE'), { status:422 });
  }
  return calculated;
}

export function updateWamdaPublishedProduct(existing, source, {
  fxRate,
  marginPercent = 0,
  syncedAt = new Date().toISOString(),
  forceAutomatic = false,
} = {}) {
  if (!existing || !source || typeof existing !== 'object' || typeof source !== 'object') {
    throw new Error('INVALID_WAMDA_PRODUCT_UPDATE');
  }
  const currentWamda = existing.wamda?.provider === 'wamda' ? existing.wamda : {};
  const keepManual = !forceAutomatic && currentWamda.priceMode === 'manual' &&
    Number.isFinite(Number(currentWamda.manualPriceSyp)) && Number(currentWamda.manualPriceSyp) > 0;
  const manualPriceSyp = keepManual ? roundMoney(Number(currentWamda.manualPriceSyp)) : null;
  const calculatedPriceSyp = calculateWamdaSellPriceSyp({
    unitPriceUsd:source.unitPrice,
    fxRate,
    marginPercent,
  });
  const sellPriceSyp = keepManual ? manualPriceSyp : calculatedPriceSyp;
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
    name:String(source.name || existing.name || '').slice(0,120),
    desc:String(source.description || existing.desc || '').slice(0,700),
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
      priceMode:keepManual?'manual':'auto',
      manualPriceSyp,
      calculatedPriceSyp,
      sellPriceSyp,
      marginPercent:normalizeWamdaMargin(marginPercent),
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
