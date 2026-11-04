const FAMILY_RULES = [
  ['pubg',/(?:\b(?:pubg|unknown cash)\b|ببجي|بوبجي|يو\s*سي|يوسي)/],
  ['free-fire',/(?:free\s*fire|freefire|فري\s*فاير)/],
  ['mobile-legends',/(?:mobile\s*legends|mlbb|موبايل\s*ليجند|موبايل\s*ليجندز)/],
  ['call-of-duty',/(?:call\s*of\s*duty|codm|كول\s*اوف\s*ديوتي)/],
  ['roblox',/(?:roblox|روبلوكس)/],
  ['steam',/(?:steam|ستيم)/],
  ['google-play',/(?:google\s*play|جوجل\s*بلاي)/],
  ['playstation',/(?:playstation|psn|بلايستيشن)/],
  ['xbox',/(?:xbox|اكس\s*بوكس)/],
  ['itunes',/(?:itunes|app\s*store|اي\s*تونز)/],
  ['spotify',/(?:spotify|سبوتيفاي)/],
  ['netflix',/(?:netflix|نتفلكس)/],
  ['telegram',/(?:telegram|تلجرام|تيليجرام)/],
  ['instagram',/(?:instagram|انستغرام|انستقرام)/],
  ['tiktok',/(?:tiktok|تيك\s*توك)/],
  ['youtube',/(?:youtube|يوتيوب)/],
  ['facebook',/(?:facebook|فيسبوك|فيس\s*بوك)/],
  ['discord',/(?:discord|ديسكورد)/],
  ['twitch',/(?:twitch|تويتش)/],
  ['whatsapp',/(?:whatsapp|واتساب|واتس\s*اب)/],
  ['twitter',/(?:twitter|x\s*com|تويتر)/],
  ['snapchat',/(?:snapchat|سناب\s*شات|سناب)/],
  ['linkedin',/(?:linkedin|لينكد\s*ان)/],
  ['pinterest',/(?:pinterest|بنترست)/],
  ['reddit',/(?:reddit|ريديت)/],
  ['viber',/(?:viber|فايبر)/],
  ['imo',/(?:\bimo\b|ايمو)/],
  ['apple',/(?:apple|ابل|آبل)/],
  ['amazon',/(?:amazon|امازون)/],
  ['microsoft',/(?:microsoft|مايكروسوفت)/],
];
export function normalizeSupplierText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g,'')
    .replace(/[ـ]/g,'')
    .replace(/[أإآ]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .trim()
    .replace(/\s+/g,' ');
}
const FAMILY_TERMS = {
  pubg:/(?:\b(?:pubg|uc|unknown cash|unified currency)\b|ببجي|بوبجي|يو\s*سي|يوسي)/gu,
  'free-fire':/(?:\b(?:free\s*fire|freefire)\b|فري\s*فاير)/gu,
  'mobile-legends':/(?:\b(?:mobile\s*legends|mlbb)\b|موبايل\s*ليجند(?:ز)?)/gu,
  'call-of-duty':/(?:\b(?:call\s*of\s*duty|codm)\b|كول\s*اوف\s*ديوتي)/gu,
  roblox:/\broblox\b|روبلوكس/gu,
  steam:/\bsteam\b|ستيم/gu,
  'google-play':/\b(?:google\s*play|gift\s*card)\b|جوجل\s*بلاي/gu,
  playstation:/\b(?:playstation|psn)\b|بلاي\s*ستيشن|بلايستيشن/gu,
  xbox:/\bxbox\b|اكس\s*بوكس/gu,
  itunes:/\b(?:itunes|app\s*store)\b|اي\s*تونز/gu,
  spotify:/\bspotify\b|سبوتيفاي/gu,
  netflix:/\bnetflix\b|نتفلكس/gu,
  telegram:/\btelegram\b|تلجرام|تيليجرام/gu,
  instagram:/\binstagram\b|انستغرام|انستقرام/gu,
  tiktok:/\btiktok\b|تيك\s*توك/gu,
  youtube:/\byoutube\b|يوتيوب/gu,
  facebook:/\bfacebook\b|فيسبوك|فيس\s*بوك/gu,
  discord:/\bdiscord\b|ديسكورد/gu,
  twitch:/\btwitch\b|تويتش/gu,
  whatsapp:/\bwhatsapp\b|واتساب|واتس\s*اب/gu,
  twitter:/\b(?:twitter|x\s*com)\b|تويتر/gu,
  snapchat:/\bsnapchat\b|سناب\s*شات|سناب/gu,
  linkedin:/\blinkedin\b|لينكد\s*ان/gu,
  pinterest:/\bpinterest\b|بنترست/gu,
  reddit:/\breddit\b|ريديت/gu,
  viber:/\bviber\b|فايبر/gu,
  imo:/\bimo\b|ايمو/gu,
  apple:/\bapple\b|ابل|آبل/gu,
  amazon:/\bamazon\b|امازون/gu,
  microsoft:/\bmicrosoft\b|مايكروسوفت/gu,
};
function familyFromSupplierText(value) {
  const normalized=normalizeSupplierText(value);
  if(!normalized)return '';
  const matches=FAMILY_RULES.filter(([,pattern])=>pattern.test(normalized));
  return matches.length===1?matches[0][0]:'';
}

export function supplierCategoryMatchKey(categoryName = '') {
  const normalized=normalizeSupplierText(categoryName);
  if(!normalized)return '';
  const family=familyFromSupplierText(normalized)||(/\buc\s*\d+\b/.test(normalized)?'pubg':'');
  return family ? 'family::'+family : 'name::'+normalized;
}
/**
 * Normalize names without discarding commercial qualifiers. Currency symbols
 * and emoji variants are meaningful for gift cards, social reactions and
 * regional products, so encode them before the general text normalizer strips
 * punctuation and symbols.
 */
export function normalizeSupplierProductText(value) {
  const text = String(value ?? '').normalize('NFKC')
    .replace(/\$/gu,' usd ')
    .replace(/€/gu,' eur ')
    .replace(/£/gu,' gbp ')
    .replace(/¥/gu,' jpy ')
    .replace(/₺/gu,' try ')
    .replace(/₹/gu,' inr ')
    .replace(/₽/gu,' rub ')
    .replace(/[٠-٩]/gu,digit=>String(digit.charCodeAt(0)-0x0660))
    .replace(/[۰-۹]/gu,digit=>String(digit.charCodeAt(0)-0x06f0))
    // Narrow Arabic/English synonyms for common SKU qualifiers and durations.
    .replace(/(?:أشهر|اشهر)/gu,' months ')
    .replace(/(?:شهرية|شهري)/gu,' monthly ')
    .replace(/شهر/gu,' month ')
    .replace(/(?:سنوات|أعوام|اعوام)/gu,' years ')
    .replace(/(?:سنوي|سنوية)/gu,' yearly ')
    .replace(/(?:سنة|عام)/gu,' year ')
    .replace(/(?:أسابيع|اسابيع)/gu,' weeks ')
    .replace(/(?:أسبوعي|اسبوعي)/gu,' weekly ')
    .replace(/(?:أسبوع|اسبوع)/gu,' week ')
    .replace(/(?:بريميوم)/gu,' premium ')
    .replace(/(?:أيام|ايام)/gu,' days ')
    .replace(/(?:يومي|يومية)/gu,' daily ')
    .replace(/(?<![\p{L}\p{N}])يوم(?![\p{L}\p{N}])/gu,' day ')
    .replace(/برايم/gu,' prime ')
    .replace(/(?:متابعين|متابعون|متابع)/gu,' followers ')
    .replace(/(?:مشاهدات|مشاهدة)/gu,' views ')
    .replace(/(?:لايكات|اعجابات|إعجابات|اعجاب)/gu,' likes ')
    .replace(/(?:تعليقات|تعليق)/gu,' comments ')
    .replace(/(?:أعضاء|اعضاء|عضو)/gu,' members ')
    .replace(/(?:تفاعلات|تفاعل)/gu,' reactions ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\uFE0F\u200D]+/gu,emoji =>
      ' emoji_' + Array.from(emoji).map(char=>char.codePointAt(0).toString(16)).join('_') + ' ');
  return normalizeSupplierText(text);
}

const GENERIC_IDENTITY_TERMS = new Set([
  'basic','standard','premium','vip','pro','plus','starter','small','medium','large',
  'weekly','monthly','yearly','daily','day','days','month','months','year','years',
  'pack','package','bundle','topup','top','up','recharge','boost','service','default',
  'followers','follower','likes','like','views','view','subscribers','subscriber',
  'members','member','comments','comment','reactions','reaction','shares','share',
  '1','2','3','7','10','15','30','60','90','100','1000','usd','eur','gbp','syp'
]);

export function supplierProductMatchKey(product, categoryName = '') {
  const name = normalizeSupplierProductText(product?.name);
  if (!name || name.length < 2) return '';
  const category = normalizeSupplierProductText(categoryName || product?.categoryName || '');
  // Prefer a platform explicitly present in the SKU name. Use the source
  // category only when the name omits it, then the description as a last resort.
  // This prevents a broad/mislabelled category from overriding the product name.
  const productAndCategoryText=normalizeSupplierText([product?.name,categoryName,product?.categoryName].filter(Boolean).join(' '));
  const ucDenomination=/\buc\s*\d+\b/.test(productAndCategoryText);
  const family = familyFromSupplierText(product?.name) ||
    familyFromSupplierText([categoryName,product?.categoryName].filter(Boolean).join(' ')) ||
    (ucDenomination?'pubg':'') || familyFromSupplierText(product?.description) || 'product';
  // Strip only the platform alias. Keep denomination, region, currency, emoji,
  // language, account type and other SKU qualifiers in their original order.
  const identity = FAMILY_TERMS[family]
    ? normalizeSupplierProductText(name.replace(FAMILY_TERMS[family], ' '))
    : name;
  if (!identity) return '';
  const tokens = identity.split(' ').filter(Boolean);
  const ambiguousGenericName = family === 'product' &&
    (tokens.length <= 1 || tokens.every(token=>GENERIC_IDENTITY_TERMS.has(token)));
  // Unknown one-word/generic names are not safe to cross-match without a
  // category discriminator. Normal product names deliberately ignore vendor
  // category labels, which are frequently different for the same SKU.
  return (family === 'product' ? 'product' : family) + '::' + identity +
    (ambiguousGenericName && category ? '::category:' + category : '');
}

/**
 * Build a single-pass index for resolving legacy published products that do
 * not yet carry supplierMatchKey. The previous implementation rescanned and
 * flattened the entire supplier cache for every catalogue product.
 */
export function buildSupplierSourceMatchKeyIndex(settings = {}) {
  const index = new Map();
  const providers = [
    ['wamda', settings?.wamdaCatalogCache],
    ['beststore', settings?.bestStoreCatalogCache],
  ];
  for (const [provider, categories] of providers) {
    for (const category of Array.isArray(categories) ? categories : []) {
      for (const product of Array.isArray(category?.products) ? category.products : []) {
        const productId = Number(product?.id);
        if (!Number.isSafeInteger(productId) || productId <= 0) continue;
        const matchKey = supplierProductMatchKey(product, category?.name || product?.categoryName || '');
        if (matchKey) index.set(`${provider}:${productId}`, matchKey);
      }
    }
  }
  return index;
}

export function existingSupplierMatchKey(product, sourceMatchIndex = new Map()) {
  if (product?.supplierMatchKey) return String(product.supplierMatchKey);
  const provider = product?.wamda?.provider === 'wamda'
    ? 'wamda'
    : (product?.bestStore?.provider === 'beststore' ? 'beststore' : '');
  if (!provider) return '';
  const productId = Number(provider === 'wamda' ? product.wamda.productId : product.bestStore.productId);
  if (!Number.isSafeInteger(productId) || productId <= 0) return '';
  return sourceMatchIndex instanceof Map ? (sourceMatchIndex.get(`${provider}:${productId}`) || '') : '';
}

function supplierProviderProductKeys(product) {
  const keys=[];
  if(product?.wamda?.provider==='wamda'){
    const id=Number(product.wamda.productId);
    if(Number.isSafeInteger(id)&&id>0)keys.push(`wamda:${id}`);
  }
  if(product?.bestStore?.provider==='beststore'){
    const id=Number(product.bestStore.productId);
    if(Number.isSafeInteger(id)&&id>0)keys.push(`beststore:${id}`);
  }
  return keys;
}

export function registerSupplierCatalogCategory(index, category) {
  if(!index||!category)return;
  const normalized=normalizeSupplierText(category.name||'');
  if(normalized&&!index.categoryByName.has(normalized))index.categoryByName.set(normalized,category);
  const family=supplierCategoryMatchKey(category.name||'');
  if(family&&!index.categoryByFamily.has(family))index.categoryByFamily.set(family,category);
}

/**
 * One-pass index of the existing storefront catalog. Bulk publication uses
 * this to avoid scanning thousands of catalog rows for every supplier SKU.
 */
export function buildSupplierCatalogIndex(catalog, sourceMatchIndex = new Map()) {
  const index={
    byMatchKey:new Map(),
    byProviderProduct:new Map(),
    categoryByName:new Map(),
    categoryByFamily:new Map(),
    sourceMatchIndex,
  };
  for(const category of Array.isArray(catalog)?catalog:[]){
    registerSupplierCatalogCategory(index,category);
    const items=Array.isArray(category?.items)?category.items:[];
    for(let position=0;position<items.length;position++){
      const item=items[position],entry={category,index:position,item};
      const providerKeys=supplierProviderProductKeys(item);
      const keys=new Set([existingSupplierMatchKey(item,sourceMatchIndex)]);
      // Old catalog rows keep their persisted legacy key. Also index the new
      // key derived from the current supplier cache so a cross-provider winner
      // updates that old row instead of creating a duplicate storefront item.
      for(const providerKey of providerKeys){
        const currentSourceKey=sourceMatchIndex instanceof Map?sourceMatchIndex.get(providerKey):'';
        if(currentSourceKey)keys.add(currentSourceKey);
        if(!index.byProviderProduct.has(providerKey))index.byProviderProduct.set(providerKey,entry);
      }
      for(const key of keys)if(key&&!index.byMatchKey.has(key))index.byMatchKey.set(key,entry);
    }
  }
  return index;
}

/** Update the in-memory lookup maps after an item is replaced or inserted. */
export function updateSupplierCatalogIndex(index, previousEntry, product, category, itemIndex, matchKey) {
  if(!index||!category||!product)return null;
  if(previousEntry?.item){
    const keys=new Set([existingSupplierMatchKey(previousEntry.item,index.sourceMatchIndex)]);
    for(const providerKey of supplierProviderProductKeys(previousEntry.item)){
      const currentSourceKey=index.sourceMatchIndex instanceof Map?index.sourceMatchIndex.get(providerKey):'';
      if(currentSourceKey)keys.add(currentSourceKey);
      if(index.byProviderProduct.get(providerKey)===previousEntry)index.byProviderProduct.delete(providerKey);
    }
    for(const oldKey of keys)if(oldKey&&index.byMatchKey.get(oldKey)===previousEntry)index.byMatchKey.delete(oldKey);
  }
  const nextEntry={category,index:itemIndex,item:product};
  if(matchKey)index.byMatchKey.set(String(matchKey),nextEntry);
  for(const providerKey of supplierProviderProductKeys(product))index.byProviderProduct.set(providerKey,nextEntry);
  registerSupplierCatalogCategory(index,category);
  return nextEntry;
}
export function supplierCostInSyp(candidate, fxRate = 145) {
  const cost = Number(candidate?.sourceCost ?? candidate?.unitPrice ?? candidate?.price);
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const currency = String(candidate?.currency || 'USD').toUpperCase();
  if (currency === 'SYP') return cost;
  if (currency === 'USD') {
    const fx = Number(fxRate);
    return Number.isFinite(fx) && fx > 0 ? cost * fx : null;
  }
  return null;
}

export function isSupplierAvailable(value) {
  if (value === false || value === 0) return false;
  if (typeof value === 'string') {
    return !['false','0','no','off','inactive','disabled'].includes(value.trim().toLowerCase());
  }
  return true;
}

function sourceProductKey(candidate, index) {
  const provider = String(candidate?.provider || '').trim().toLowerCase();
  const productId = Number(candidate?.productId ?? candidate?.product?.id ?? candidate?.id);
  if (!['wamda','beststore'].includes(provider)) return '';
  return Number.isSafeInteger(productId) && productId > 0
    ? `${provider}:${productId}`
    : `${provider}:anonymous:${index}`;
}

function candidatePriority(candidate) {
  return (candidate.available ? 2 : 0) + (Number.isFinite(candidate.costSyp) && candidate.costSyp > 0 ? 1 : 0);
}

/**
 * Build a complete inventory plan from both suppliers. Every distinct provider
 * SKU is visited once. A unique item is emitted as a one-source group and is
 * still published. A key duplicated by distinct SKUs in the same supplier is
 * marked ambiguous and each SKU is emitted independently rather than
 * incorrectly merging several variants into one storefront product.
 */
export function buildSupplierComparisonPlan(input, fxRate = 145) {
  const rows = Array.isArray(input) ? input : [];
  const stats = {
    sourceRowsFetched:rows.length,
    duplicateSourceRowsRemoved:0,
    invalidSourceRows:0,
    sources:{
      wamda:{fetched:0,uniqueProducts:0,available:0,priceableAvailable:0,unavailable:0,invalidPrice:0},
      beststore:{fetched:0,uniqueProducts:0,available:0,priceableAvailable:0,unavailable:0,invalidPrice:0},
    },
    sharedProductKeys:0,
    unambiguousSharedProductKeys:0,
    uniqueOnlyProductKeys:0,
    ambiguousProductKeys:0,
    unmatchableProducts:0,
    comparedGroups:0,
    singleSourceGroups:0,
    ambiguousSkuGroups:0,
  };

  const deduplicated = new Map();
  for (let index=0; index<rows.length; index++) {
    const raw = rows[index];
    const provider = String(raw?.provider || '').trim().toLowerCase();
    if (!raw || !['wamda','beststore'].includes(provider)) {
      stats.invalidSourceRows++;
      continue;
    }
    stats.sources[provider].fetched++;
    const product = raw.product && typeof raw.product === 'object' ? raw.product : raw;
    const available = isSupplierAvailable(raw.available ?? product?.available);
    const costSyp = supplierCostInSyp(raw,fxRate);
    const productId = Number(raw.productId ?? product?.id ?? raw.id);
    const candidate = {
      ...raw,
      provider,
      product,
      productId:Number.isSafeInteger(productId)&&productId>0?productId:null,
      available,
      costSyp,
      matchKey:supplierProductMatchKey(product,raw.categoryName || product?.categoryName || ''),
      sourceProductKey:sourceProductKey({...raw,provider,productId},index),
      sourceSequence:index,
    };
    const dedupeKey=candidate.productId? `${provider}:${candidate.productId}`:null;
    if (dedupeKey && deduplicated.has(dedupeKey)) {
      stats.duplicateSourceRowsRemoved++;
      const previous=deduplicated.get(dedupeKey);
      if (candidatePriority(candidate)>candidatePriority(previous)) {
        deduplicated.set(dedupeKey,candidate);
      }
      continue;
    }
    if (dedupeKey) deduplicated.set(dedupeKey,candidate);
    else deduplicated.set(candidate.sourceProductKey,candidate);
  }

  const candidates=[...deduplicated.values()];
  const grouped=new Map();
  for (const candidate of candidates) {
    const sourceStats=stats.sources[candidate.provider];
    sourceStats.uniqueProducts++;
    if (candidate.available) sourceStats.available++;
    else sourceStats.unavailable++;
    if (candidate.available && Number.isFinite(candidate.costSyp) && candidate.costSyp>0) {
      sourceStats.priceableAvailable++;
    } else if (candidate.available) {
      sourceStats.invalidPrice++;
    }
    if (!candidate.matchKey) {
      stats.unmatchableProducts++;
      continue;
    }
    const group=grouped.get(candidate.matchKey)||[];
    group.push(candidate);
    grouped.set(candidate.matchKey,group);
  }

  const groups=[];
  for (const [matchKey, sourceGroup] of grouped) {
    const byProvider={
      wamda:sourceGroup.filter(candidate=>candidate.provider==='wamda'),
      beststore:sourceGroup.filter(candidate=>candidate.provider==='beststore'),
    };
    const shared=byProvider.wamda.length>0&&byProvider.beststore.length>0;
    if (shared) stats.sharedProductKeys++;
    else stats.uniqueOnlyProductKeys++;

    const ambiguousProvider=byProvider.wamda.length>1||byProvider.beststore.length>1;
    if (ambiguousProvider) {
      stats.ambiguousProductKeys++;
      for (const candidate of sourceGroup) {
        if (!candidate.available || !Number.isFinite(candidate.costSyp) || candidate.costSyp<=0) continue;
        const publishMatchKey=`${matchKey}::source:${candidate.sourceProductKey}`;
        groups.push({
          matchKey,
          publishMatchKey,
          winner:{...candidate,publishMatchKey},
          candidates:[{...candidate,publishMatchKey}],
          compared:false,
          ambiguous:true,
          sourceProductKey:candidate.sourceProductKey,
        });
        stats.ambiguousSkuGroups++;
        stats.singleSourceGroups++;
      }
      continue;
    }

    if (shared) stats.unambiguousSharedProductKeys++;
    const priceable=sourceGroup
      .filter(candidate=>candidate.available&&Number.isFinite(candidate.costSyp)&&candidate.costSyp>0)
      .map(candidate=>({...candidate,publishMatchKey:matchKey}))
      .sort((a,b)=>a.costSyp-b.costSyp||String(a.provider).localeCompare(String(b.provider))||Number(a.productId||0)-Number(b.productId||0));
    if (!priceable.length) continue;
    const providers=new Set(priceable.map(candidate=>candidate.provider));
    const compared=providers.size>1;
    const group={matchKey,publishMatchKey:matchKey,winner:priceable[0],candidates:priceable,compared,ambiguous:false};
    groups.push(group);
    if (compared) stats.comparedGroups++;
    else stats.singleSourceGroups++;
  }

  return {
    groups,
    candidates,
    stats:{
      ...stats,
      uniqueSourceProducts:candidates.length,
      publishableGroups:groups.length,
      productsFetched:candidates.length,
      uniqueProducts:groups.length,
    },
  };
}

export function compareSupplierCandidates(candidates, fxRate = 145) {
  return buildSupplierComparisonPlan(candidates,fxRate).groups;
}

/**
 * Try supplier candidates from lowest to highest source cost. A malformed
 * calculated WAMDA selling price must not abort publication for every other
 * product; fall back to the next supplier, or report this product as skipped.
 * All unrelated errors still propagate so real publication failures remain
 * visible and cannot be silently hidden.
 */
const SAFE_SKIPPABLE_PRICE_ERRORS = new Set([
  'INVALID_WAMDA_CALCULATED_PRICE',
  'INVALID_WAMDA_UNIT_PRICE',
  'BEST_STORE_INVALID_SELL_PRICE',
  'BEST_STORE_INVALID_SOURCE_COST',
]);

export function applyFirstPriceableSupplierCandidate(group, applyCandidate) {
  if (typeof applyCandidate !== 'function') throw new TypeError('INVALID_SUPPLIER_APPLY_CALLBACK');
  const candidates = Array.isArray(group?.candidates) && group.candidates.length
    ? group.candidates
    : (group?.winner ? [group.winner] : []);
  const unpriceableCandidates = [];
  for (const candidate of candidates) {
    try {
      return { candidate, result:applyCandidate(candidate), unpriceableCandidates };
    } catch (error) {
      const errorCode=String(error?.code||error?.message||'');
      if (!SAFE_SKIPPABLE_PRICE_ERRORS.has(errorCode)) throw error;
      unpriceableCandidates.push({
        provider:String(candidate?.provider || ''),
        productId:Number(candidate?.productId || 0),
        categoryId:String(candidate?.categoryId ?? ''),
        sourceProductKey:String(candidate?.sourceProductKey||''),
        errorCode,
      });
    }
  }
  return { candidate:null, result:null, unpriceableCandidates };
}
