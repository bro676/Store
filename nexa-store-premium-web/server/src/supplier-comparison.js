const FAMILY_RULES = [
  ['pubg',/(?:\b(?:pubg|uc)\b|ببجي|بوبجي|يو\s*سي|يوسي)/],
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
  roblox:/\broblox\b/gu,steam:/\bsteam\b/gu,
  'google-play':/\b(?:google\s*play|gift\s*card)\b/gu,
  playstation:/\b(?:playstation|psn)\b/gu,xbox:/\bxbox\b/gu,
  itunes:/\b(?:itunes|app\s*store)\b/gu,spotify:/\bspotify\b/gu,
  netflix:/\bnetflix\b/gu,telegram:/\btelegram\b/gu,
  instagram:/\binstagram\b/gu,tiktok:/\btiktok\b/gu,
};
export function supplierCategoryMatchKey(categoryName = '') {
  const normalized=normalizeSupplierText(categoryName);
  if(!normalized)return '';
  const family=FAMILY_RULES.find(([,pattern])=>pattern.test(normalized))?.[0];
  return family ? 'family::'+family : 'name::'+normalized;
}
export function supplierProductMatchKey(product, categoryName = '') {
  const name = normalizeSupplierText(product?.name);
  if (!name || name.length < 2) return '';
  const context = normalizeSupplierText([categoryName,product?.categoryName,product?.description].filter(Boolean).join(' '));
  const family = FAMILY_RULES.find(([,pattern])=>pattern.test(context + ' ' + name))?.[0]
    || normalizeSupplierText(categoryName || product?.categoryName || 'general');
  // Strip only family aliases; retain denominations, regions, currencies and SKU qualifiers.
  const identity = FAMILY_TERMS[family] ? normalizeSupplierText(name.replace(FAMILY_TERMS[family], ' ')) : name;
  return family + '::' + (identity || name);
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
export function compareSupplierCandidates(candidates, fxRate = 145) {
  const groups = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || candidate.available === false) continue;
    const key = String(candidate.matchKey || supplierProductMatchKey(candidate.product || candidate, candidate.categoryName || ''));
    if (!key) continue;
    const costSyp = supplierCostInSyp(candidate, fxRate);
    if (!Number.isFinite(costSyp) || costSyp <= 0) continue;
    const group = groups.get(key) || [];
    group.push({ ...candidate, matchKey:key, costSyp });
    groups.set(key, group);
  }
  const winners = [];
  for (const [matchKey, options] of groups) {
    options.sort((a,b)=>a.costSyp-b.costSyp || String(a.provider).localeCompare(String(b.provider)));
    winners.push({ matchKey, winner:options[0], candidates:options, compared:options.length > 1 });
  }
  return winners;
}
