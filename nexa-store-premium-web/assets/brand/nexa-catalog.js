(() => {
 const DEPARTMENTS=[
  {id:'games',name:'قسم الألعاب',icon:'🎮',description:'شحن الألعاب والعضويات والنقاط الرقمية.',folder:'01-games',cover:'assets/products/01-games/cover.svg'},
  {id:'balance',name:'خدمات الرصيد',icon:'💰',description:'الأرصدة والشحن والباقات الرقمية.',folder:'02-balance-services',cover:'assets/products/02-balance-services/cover.svg'},
  {id:'apps',name:'قسم التطبيقات',icon:'📱',description:'الاشتراكات والتطبيقات والخدمات الرقمية.',folder:'03-apps',cover:'assets/products/03-apps/cover.svg'},
  {id:'numbers',name:'أرقام افتراضية',icon:'☎️',description:'الأرقام الافتراضية وخدمات التفعيل المتاحة.',folder:'04-virtual-numbers',cover:'assets/products/04-virtual-numbers/cover.svg'},
  {id:'cards',name:'بطاقات إلكترونية',icon:'💳',description:'بطاقات الألعاب والمتاجر والمحافظ الرقمية.',folder:'05-digital-cards',cover:'assets/products/05-digital-cards/cover.svg'},
  {id:'vpn',name:'قسم VPN',icon:'🔐',description:'اشتراكات VPN وخدمات الخصوصية والاتصال.',folder:'06-vpn',cover:'assets/products/06-vpn/cover.svg'},
  {id:'verification',name:'توثيق الحسابات',icon:'✅',description:'الحسابات الجاهزة وخدمات التوثيق والتفعيل.',folder:'07-account-verification',cover:'assets/products/07-account-verification/cover.svg'},
  {id:'ai',name:'الذكاء الاصطناعي',icon:'✨',description:'أدوات الذكاء الاصطناعي والاشتراكات الذكية.',folder:'08-ai',cover:'assets/products/08-ai/cover.svg'},
  {id:'social',name:'التسويق والخدمات الاجتماعية',icon:'📣',description:'خدمات المنصات الاجتماعية والتفاعل الرقمي.',folder:'09-social-marketing',cover:'assets/products/09-social-marketing/cover.svg'},
  {id:'web',name:'المواقع والبرمجة',icon:'💻',description:'المواقع والبرمجة والتصميم والحلول التقنية.',folder:'10-websites-programming',cover:'assets/products/10-websites-programming/cover.svg'},
  {id:'other',name:'خدمات رقمية متنوعة',icon:'✦',description:'أقسام إضافية لا تندرج تحت الأقسام الرئيسية.',folder:'11-other-services',cover:'assets/products/11-other-services/cover.svg'}
 ];
 const byId=new Map(DEPARTMENTS.map(row=>[row.id,row]));
 const placeholders=new Set(['assets/brand/logo.svg','assets/products/logo.svg','assets/products/_shared/logo.svg']);
 const rules=[
  ['ai',/(?:ذكاء\s*اصطناعي|ذكاء\s*صناعي|chat\s*gpt|chatgpt|claude|gemini|gamma\s*ai|midjourney|ai\s*assistant)/i],
  ['vpn',/(?:\bvpn\b|surf\s*shark|surfshark|nord\s*vpn|proton\s*vpn|express\s*vpn|pure\s*vpn|shield\s*vpn|pia\s*vpn|شبكة\s*خاصة\s*افتراضية)/i],
  ['cards',/(?:بطاقات?\s*(?:الكترونية|رقمية|هدايا)|بطاقة\s*فيزا|بطاقات|gift\s*cards?|google\s*play|playstation|psn\b|steam(?:\s|$)|xbox\s*(?:gift|game)|razer\s*gold|itunes|apple\s*card|visa\b|mastercard)/i],
  ['numbers',/(?:أرقام|ارقام|رقم\s*(?:افتراضي|فوري)|virtual\s*number|phone\s*number|numbers?\s*(?:for|account)|whatsapp\s*number|ارقام\s*(?:انستغرام|ايكلود|ايمو|جيميل|سناب)|رقم\s*واتساب)/i],
  ['games',/(?:قسم\s*الألعاب|ألعاب|العاب|pubg|ببجي|بوبجي|free\s*fire|freefire|فري\s*فاير|roblox|روبلوكس|call\s*of\s*duty|codm|8ball\s*pool|growtopia|efootball|efootbol|mobile\s*legends|minecraft|ماين\s*كرافت|genshin|asphalt|league\s*of\s*legends|ليج\s*او\s*ليجندز|valorant|fortnite|clash\s*of\s*clans)/i],
  ['balance',/(?:خدمات\s*الرصيد|رصيد\s*(?:mtn|سيريتل|سيرياتل|بابرا)|شحن\s*(?:رصيد|مباشر)|syriatel|سيريتل|سيرياتل|\bmtn\b|فواتير\s*(?:mtn|سيريتل)|باقات?\s*(?:انترنت|نت)|internet\s*(?:bundle|top.?up)|top.?up|recharge|مزود\s*(?:برو|سما|ناس|هايفاي|يارا|لاي)|رصيد\s*(?:موبايل|هاتف))/i],
  ['apps',/(?:قسم\s*التطبيقات|تطبيقات|اشتراك\s*(?:تطبيق|شهري)|netflix|نتفلكس|spotify|shahid|anghami|apple\s*music|capcut|canva|adobe|prime\s*video|osn\s*plus|iptv|nova\s*tv|watch\s*tv|picsart|in\s*video|youtube\s*premium)/i],
  ['verification',/(?:توثيق\s*الحسابات|توثيق|حسابات\s*جاهزة|حسابات\s*موثقة|حساب\s*موثق|verified\s*accounts?|account\s*verification|حسابات\s*(?:جيميل|icloud)\s*جاهزة)/i],
  ['web',/(?:برمجة\s*(?:مواقع|ويب)|برمجة\s*مواقع|مواقع\s*الكترونية|تصميم\s*مواقع|website\s*(?:design|development)|web\s*(?:design|development)|hosting|استضافة\s*(?:مواقع|ويب)|\bseo\b|domain\s*(?:name)?|نطاقات?\s*مواقع)/i],
  ['social',/(?:متابعين|متابعون|لايكات|لايك\b|اعجابات|إعجابات|مشاهدات|تعليقات|أعضاء|اعضاء|تصويت|تفاعلات|اعادة\s*نشر|إعادة\s*النشر|followers?|likes?|views?|comments?|engagement|مشاركات\s*(?:فيسبوك|تيك\s*توك|انستغرام)|خدمات\s*(?:انستغرام|انستقرام|تيك\s*توك|تيليجرام|تلجرام|فيسبوك|يوتيوب))/i]
 ];
 function text(value){return String(value??'').normalize('NFKC').replace(/[\u064B-\u065F\u0670]/g,'').replace(/[ـ]/g,' ').replace(/\s+/g,' ').trim().toLowerCase()}
 function classifyCategory(category){
  const value=text([category?.name,category?.desc,category?.description].filter(Boolean).join(' '));
  for(const [id,pattern] of rules)if(pattern.test(value))return id;
  return 'other';
 }
 function department(id){return byId.get(id)||byId.get('other')}
 function getDepartmentSummaries(categories){
  const rows=new Map(DEPARTMENTS.map(row=>[row.id,{...row,categories:[],categoryCount:0,productCount:0}]));
  for(const category of Array.isArray(categories)?categories:[]){
   const row=rows.get(classifyCategory(category));row.categories.push(category);row.categoryCount++;
   row.productCount+=Array.isArray(category?.items)?category.items.length:0;
  }
  return DEPARTMENTS.map(row=>rows.get(row.id)).filter(row=>row.categoryCount>0);
 }
 function safeImage(candidate){
  const value=String(candidate??'').trim();if(!value||placeholders.has(value))return '';
  if(/^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/i.test(value))return value;
  if(/^assets\/[a-z0-9_./-]+$/i.test(value)&&!value.includes('..'))return value;
  try{const url=new URL(value);if(url.protocol==='https:')return url.href}catch{}
  return '';
 }
 function categoryImage(category){return safeImage(category?.image)||department(classifyCategory(category)).cover}
 const icons=[
  [/(?:pubg|ببجي|بوبجي)/i,'assets/products/01-games/pubg/cover.svg'],
  [/(?:roblox|روبلوكس)/i,'assets/products/01-games/roblox/cover.svg'],
  [/(?:free\s*fire|freefire|فري\s*فاير)/i,'assets/products/01-games/free-fire/cover.svg'],
  [/(?:call\s*of\s*duty|codm)/i,'assets/products/01-games/call-of-duty-mobile/cover.svg'],
  [/(?:chat\s*gpt|chatgpt|شات\s*جي\s*بي)/i,'assets/products/08-ai/chatgpt/cover.svg'],
  [/(?:netflix|نتفلكس)/i,'assets/products/03-apps/netflix/cover.svg'],
  [/spotify/i,'assets/products/03-apps/spotify/cover.svg'],
  [/youtube/i,'assets/products/03-apps/youtube/cover.svg'],
  [/(?:google\s*play|جوجل\s*بلاي)/i,'assets/products/05-digital-cards/google-play/cover.svg'],
  [/(?:playstation|psn)/i,'assets/products/05-digital-cards/playstation/cover.svg'],
  [/steam/i,'assets/products/05-digital-cards/steam/cover.svg'],
  [/(?:apple\s*card|itunes)/i,'assets/products/05-digital-cards/apple-card/cover.svg'],
  [/tiktok/i,'assets/products/09-social-marketing/tiktok/cover.svg']
 ];
 function productImage(product,category){
  const own=safeImage(product?.image);if(own)return own;
  const key=text([product?.name,product?.desc,category?.name].filter(Boolean).join(' '));
  for(const [pattern,src] of icons)if(pattern.test(key))return src;
  return department(classifyCategory(category)).cover;
 }
 function optionImage(option,product,category){return safeImage(option?.image)||productImage(product,category)}
 function slugify(value){const result=text(value).replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,64);return result||'item'}
 function folderFor(category,product,option,pack){
  const group=department(classifyCategory(category));
  const parts=['assets','products',group.folder,slugify(category?.name)+'--'+slugify(category?.id||'category'),slugify(product?.name)+'--'+slugify(product?.id||'product')];
  if(option)parts.push('options',slugify(option?.name)+'--'+slugify(option?.id||'option'));
  if(pack)parts.push('packs','pack-'+slugify(pack?.[0]||'offer'));
  return parts.join('/');
 }
 window.NexaCatalog=Object.freeze({departments:DEPARTMENTS.map(row=>Object.freeze({...row})),classifyCategory,department,getDepartmentSummaries,categoryImage,productImage,optionImage,slugify,folderFor});
})();
