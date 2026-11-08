import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const webRoot=path.resolve(here,'../../');

test('storefront language engine translates static and dynamic text, attributes and digits',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.doesNotThrow(()=>new vm.Script(source,{filename:'nexa-store-language.js'}));
 const sandbox={
  window:{addEventListener(){},dispatchEvent(){},requestAnimationFrame(){return 1}},
  document:{getElementById(){return null},
   documentElement:{dataset:{},set lang(value){this.language=value},set dir(value){this.direction=value}},
   body:{nodeType:1,matches(){return false},querySelectorAll(){return []}},
   querySelector(){return null},
   createTreeWalker(){return {nextNode(){return null}}}
  },
  localStorage:{getItem(){return null},setItem(){}},
  MutationObserver:class{observe(){}},
  NodeFilter:{SHOW_TEXT:4,SHOW_ELEMENT:1},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}
 };
 vm.runInNewContext(source,sandbox,{filename:'nexa-store-language.js'});
 sandbox.window.NexaLocale.initialize();
 sandbox.window.NexaLocale.setLanguage('en');
 const translate=sandbox.window.NexaLocale.translate;
 const editorialUiLabels=[["BROWSE BY CATEGORY","تصفّح الفئات"],["POPULAR PICKS","اختيارات شائعة"],["HOW IT WORKS","كيف يعمل المتجر"],["HELP CENTER","مركز المساعدة"],["NEXA CATALOG","كتالوج Nexa"],["NEXA DIGITAL STORE","المتجر الرقمي من Nexa"],["YOUR ACTIVITY","نشاطك"],["SAVED ITEMS","العناصر المحفوظة"],["SECURE CHECKOUT · SHAM CASH","الدفع الآمن · شام كاش"],["NEXA WALLET","محفظة Nexa الرقمية"],["LIVE TRANSACTION CHECK","التحقق المباشر من التحويل"],["NEXA CARE CENTER","مركز خدمة Nexa"],["SEND A REQUEST","إرسال طلب"],["LOCAL ORDER LOOKUP","البحث المحلي عن طلب"],["HELP & ANSWERS","المساعدة والإجابات"],["PAYMENT HISTORY","سجل المدفوعات"],["YOUR NEXA ACCOUNT","ملف حساب Nexa"],["ABOUT NEXA","عن Nexa"],["YOUR DIGITAL SPACE","مساحتك الرقمية"],["NEED HELP?","هل تحتاج إلى مساعدة؟"],["CUSTOMER ACCOUNT","حساب العميل"],["ACCOUNT ACCESS","الوصول إلى الحساب"],["CUSTOMER REGISTRATION","إنشاء حساب العميل"],["ACCOUNT RECOVERY","استعادة الحساب"],["NOTIFICATION CENTER","مركز الإشعارات"],["VIP MEMBERSHIP","عضوية VIP"],["TELEGRAM CONNECTION","ربط تيليجرام"],["PARTNERS & REFERRALS","الشركاء والإحالات"],["ACCOUNT SECURITY","أمان الحساب"],["IDENTITY VERIFICATION","التحقق من الهوية"],["CUSTOMER API ACCESS","وصول العميل إلى API"],["NEXA APP","تطبيق Nexa"],["NEXA MEMBER","عضو Nexa"],["DIGITAL STORE","المتجر الرقمي"],["Nexa Store","متجر Nexa"],["SECURE API PAYMENT GATEWAY","بوابة دفع آمنة عبر API"],["PAYMENT FLOW","مسار الدفع"]];
 assert.equal(translate('صفحة ٢ من ٥'),'Page 2 of 5');
 assert.equal(translate('إنشاء فاتورة شحن ١٢'),'Create top-up invoice 12');
 assert.equal(translate('لا توجد طلبات حتى الآن.'),'No orders yet.');
 assert.equal(translate('3 مجلدات'),'3 folders');
 assert.equal(translate('EAFC Mobile Singapore - ٩٩٩٩ فضي'),'EAFC Mobile Singapore - 9999 Silver');
 assert.equal(translate('الباقة الذهبية - شهرية - ٥٠٠ جواهر'),'Gold Package - Monthly - 500 Diamonds');
 assert.equal(translate('شحن مباشر لحساب اللاعب.'),'Direct top-up for the player account.');
 assert.equal(translate('الخيار الأساسي'),'Basic option');
 assert.equal(translate('الخيار المميز'),'Premium option');
 sandbox.window.NexaLocale.setLanguage('ar');
 assert.equal(translate('EAFC Mobile Singapore - 9999 Silver'),'EAFC Mobile سنغافورة - ٩٩٩٩ فضي');
 assert.equal(translate('The Gold Package - Monthly - 500 Diamonds'),'الباقة الذهبية - شهرية - ٥٠٠ جواهر');
 assert.equal(translate('Direct top-up for the player account.'),'شحن مباشر لحساب اللاعب.');
 sandbox.window.NexaLocale.setLanguage('en');
 assert.equal(translate('اختر المنطقة أو النسخة أو الخطة المناسبة.'),'Choose the suitable region, version or plan.');
 assert.equal(translate('إغلاق القائمة الجانبية'),'Close sidebar');
 assert.equal(translate('3 مجلدات ·'),'3 folders ·');
 assert.equal(sandbox.document.documentElement.direction,'ltr');
 sandbox.window.NexaLocale.setLanguage('ar');
 assert.equal(translate('Order 27'),'طلب ٢٧');
 for(const [english,arabic] of editorialUiLabels)assert.equal(translate(english),arabic,'Arabic locale must fully localize '+english);
 assert.equal(translate('No orders yet.'),'لا توجد طلبات حتى الآن.');
 assert.equal(translate('Full name'),'الاسم الكامل');
 assert.equal(translate('Card number'),'رقم البطاقة');
 assert.equal(translate('Electronic payment receipt'),'وصل دفع إلكتروني');
 assert.equal(translate('3 folders'),'٣ مجلدات');

 assert.equal(translate('Search by product name...'),'ابحث باسم المنتج...');
 assert.equal(translate('Close sidebar'),'إغلاق القائمة الجانبية');
 assert.equal(translate('Open Main category'),'فتح الفئة الرئيسية');
 assert.equal(translate('3 folders ·'),'٣ مجلدات ·');
 sandbox.window.NexaLocale.setLanguage('en');
 assert.equal(translate('فتح الفئة الرئيسية'),'Open Main category');
 for(const [english,arabic] of editorialUiLabels)assert.equal(translate(arabic),english,'English locale must restore '+english);
 assert.equal(translate('5 أقسام داخلية · 7 منتجات'),'5 subcategories · 7 products');
 assert.equal(translate('4 مجلدات رئيسية'),'4 main folders');
 assert.equal(translate('2 أقسام رئيسية'),'2 main categories');
 assert.equal(translate('تبديل عملة العرض إلى الدولار الأمريكي'),'Switch display currency to US dollar');
 assert.equal(translate('تم تأكيد الدفع. سيصل طلبك قريباً'),'Payment confirmed. Your order will arrive soon.');
 assert.equal(translate('0 أقسام'),'0 departments');
 assert.equal(translate('قسم الألعاب'),'Games');
 assert.equal(translate('خدمات الرصيد'),'Balance Services');
 assert.equal(translate('قسم التطبيقات'),'Apps');
 assert.equal(translate('أرقام افتراضية'),'Virtual Numbers');
 assert.equal(translate('بطاقات إلكترونية'),'Digital Cards');
 assert.equal(translate('قسم VPN'),'VPN');
 assert.equal(translate('توثيق الحسابات'),'Account Verification');
 assert.equal(translate('الذكاء الاصطناعي'),'Artificial Intelligence');
 assert.equal(translate('التسويق والخدمات الاجتماعية'),'Social Media and Marketing');
 assert.equal(translate('المواقع والبرمجة'),'Websites and Programming');
 assert.equal(translate('شحن الألعاب والعضويات والنقاط الرقمية.'),'Game top-ups, memberships and digital points.');
 assert.equal(translate('تعذر تحميل تفاصيل الباقة. حدّث الكتالوج وحاول مجدداً.'),'Could not load package details. Refresh the catalog and try again.');
 assert.equal(translate('مساعد Nexa يراجع معلومات المتجر…'),'Nexa Assistant is reviewing store information…');
 assert.equal(translate('جارٍ تسجيل الدخول…'),'Signing in…');
 assert.equal(translate('تم إنشاء فاتورة شام كاش الرسمية. حوّل المبلغ الظاهر ثم أدخل رقم العملية.'),'The official Sham Cash invoice has been created. Transfer the displayed amount, then enter the transaction reference.');
 assert.equal(translate('سيتم خصم المبلغ بالليرة السورية الجديدة من رصيد حسابك بعد التحقق من كفايته.'),'The amount will be deducted from your account balance in new Syrian pounds after confirming that sufficient funds are available.');
 assert.equal(translate('حوّل قيمة الفاتورة إلى محفظة Nexa، ثم أدخل رقم العملية في نموذج التحقق.'),'Transfer the invoice amount to your Nexa wallet, then enter the transaction reference in the verification form.');
 assert.equal(translate('يمكنك التواصل مع الدعم عبر واتساب أو البريد من صفحة «مركز الدعم».'),'You can contact support through WhatsApp or email on the Support Center page.');
 const dynamicUiTranslations=[
  ['عنوان محفظة الاستلام','Receiving wallet address'],
  ['استكشف ←','Explore →'],
  ['التواصل مع الدعم ↗','Contact Support ↗'],
  ['← الأقسام الرئيسية','Main categories →'],
  ['← المجلد الأعلى','Parent folder →'],
  ['يمكنك استخدام المجلدات الفرعية أو البحث باسم آخر.','You can use subfolders or search for another term.'],
  ['هذا المنتج ظاهر للتفاصيل فقط؛ لا يمكن إنشاء طلب قبل عودته إلى التوفر لدى المورد.','This product is displayed for details only. Orders cannot be placed until the supplier marks it available again.'],
  ['تأكد من رقم الطلب أو أعد المحاولة.','Check the order number or try again.'],
  ['✓ مدفوع ومتحقق','✓ Paid and verified'],
  ['تم التحقق من الدفع لدى مزوّد شام كاش عبر API.','Payment was verified with the Sham Cash provider through the API.'],
  ['رقم الفاتورة','Invoice number'],
  ['هذا الوصل يثبت أن Nexa Store تحقّق من الدفع والمبلغ والمستلم. احتفظ برقم الطلب والفاتورة للرجوع إليهما. بيانات الحساب أو البطاقة لا تظهر إلا بعد تأكيد اكتمال التسليم.','This receipt confirms that Nexa Store verified the payment, amount and recipient. Keep the order and invoice numbers for reference. Account or card details are shown only after delivery is confirmed complete.'],
  ['استخدم رقم الهاتف وكلمة المرور لعرض بيانات الحساب ورصيد المحفظة.','Use your phone number and password to view your account details and wallet balance.'],
  ['شحن رصيد الحساب · SYP','Account balance top-up · SYP']
 ];
 for(const [arabic,english] of dynamicUiTranslations)assert.equal(translate(arabic),english,'Missing dynamic storefront translation: '+arabic);
 sandbox.window.NexaLocale.setLanguage('ar');
 assert.equal(translate('5 subcategories · 7 products'),'٥ أقسام داخلية · ٧ منتجات');
 assert.equal(translate('0 departments'),'٠ أقسام');
 assert.equal(translate('Page 2 of 5'),'صفحة ٢ من ٥');
 assert.equal(sandbox.document.documentElement.direction,'rtl');
 assert.ok(source.includes("const excludedSelector = 'script,style,code,pre,[data-no-translate]'"),
  'Input and textarea placeholders must remain eligible for attribute translation');
 assert.ok(source.includes('translationLookup[key]'),'The extended translation dictionary must be consulted');
 assert.ok(source.includes('document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT)'),
  'Placeholder/title/alt/aria-label attributes are traversed incrementally in animation-frame batches');
 assert.ok(!source.includes('root.querySelectorAll(attributeSelector)'),
  'Locale changes must not synchronously query every attribute in a large dashboard or catalogue subtree');
  sandbox.window.NexaLocale.setLanguage('en');
  sandbox.window.NexaLocale.setLanguage('tr');
  assert.equal(sandbox.window.NexaLocale.getLanguage(),'ar');
  assert.equal(sandbox.document.documentElement.language,'ar');
  assert.equal(sandbox.document.documentElement.direction,'rtl');
  assert.equal(translate('الرئيسية'),'الرئيسية');
});

test('all Arabic static storefront text nodes have exact English dictionary entries',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const keys=new Set([...source.matchAll(/^\s*(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*:/gm)]
  .map(match=>(match[1]||match[2]).replace(/\\'/g,"'")));
 const beforeScripts=store.slice(0,store.indexOf('<script src="/assets/brand/nexa-catalog.js'));
 const nodes=[...beforeScripts.matchAll(/>([^<>]+)</g)]
  .map(match=>match[1].replace(/\s+/g,' ').trim())
  .filter(value=>/[\u0600-\u06FF]/.test(value)&&value.length>1);
 const missing=[...new Set(nodes)].filter(value=>!keys.has(value));
 assert.deepEqual(missing,[],'Every static Arabic interface text node must have a direct English translation');
});

test('language direction updates first, then closes the drawer on the new RTL/LTR side',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 const clickStart=store.indexOf("$('sidebarLanguageToggle')?.addEventListener('click'");
 const clickEnd=store.indexOf("$('sidebarLogoutButton')",clickStart);
 const clickHandler=store.slice(clickStart,clickEnd);
 const langStart=store.indexOf("window.addEventListener('nexa:languagechange'");
 const langEnd=store.indexOf("window.addEventListener('storage'",langStart);
 const langHandler=store.slice(langStart,langEnd);
 assert.ok(!clickHandler.includes('closeMenu(true)'),'The click handler must not close the drawer before changing dir');
 assert.ok(clickHandler.indexOf('NexaLocale?.setLanguage(next)')>=0,'Document direction changes before the close event');
 assert.ok(langHandler.includes('drawer-direction-switching')&&langHandler.includes('closeMenu(true)'),'The drawer closes once after direction changes');
 assert.ok(css.includes(':root[dir="ltr"] .app-shell .sidebar{'),'English uses a left-side drawer');
 assert.ok(css.includes('transform:translate3d(-110%,0,0)!important'),'The left-side drawer moves off-canvas in English');
 assert.ok(css.includes(':root[dir="rtl"] .app-shell .sidebar{'),'Arabic retains a right-side drawer');
 assert.ok(css.includes('drawer-direction-switching .app-shell .sidebar'),'The direction swap avoids cross-screen animation');
});

test('theme switch is a moving sun/moon control and storefront panels use theme variables',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 const start=store.indexOf('id="storeThemeToggle"');
 const markup=store.slice(start,start+1400);
 assert.ok(markup.includes('sidebar-theme-switch'),'Theme switch track exists');
 assert.ok(markup.includes('sidebar-theme-switch-knob'),'Theme switch has a moving knob');
 assert.ok(markup.includes('sidebar-theme-sun')&&markup.includes('sidebar-theme-moon'),'Sun and moon icons are included');
 assert.ok(css.includes(':root[data-theme="dark"] .app-shell .sidebar .sidebar-theme-switch-knob'),'Dark mode moves knob to the moon side');
 assert.ok(css.includes(':root[data-theme="light"] .app-shell .sidebar .sidebar-theme-switch-knob'),'Light mode moves knob to the sun side');
 assert.ok(css.includes('background:var(--surface)!important;color:var(--ink)!important'),'Panels use active theme variables');
 assert.ok(store.includes("setStoreColorMode(document.documentElement.dataset.theme||'dark',{persist:false})"),
  'Theme labels are synchronized when language changes');
});

test('date and time output use the selected storefront locale instead of a fixed Arabic locale',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(!/\.toLocaleDateString\('ar-SY'/.test(store),'Date-only values must follow the selected language');
 assert.ok(!/\.toLocaleString\('ar-SY'/.test(store),'Date/time values must follow the selected language');
 assert.ok(!/new Intl\.DateTimeFormat\('ar-SY'/.test(store),'Explicit date formatters must follow the selected language');
 assert.ok(store.includes("storeIntlLocale()"),'Both supported storefront locales are selected dynamically');
});


test('production stylesheet controls locale rail layout and all checkout surfaces',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 assert.ok(store.includes('nexa-wamda-blue.css?v=20261107-i18n-rtl-theme-v1'));
 for(const token of [':root[dir="ltr"] .app-shell .sidebar{',':root[dir="rtl"] .app-shell .sidebar{','body.sidebar-closed .app-shell .sidebar','body.sidebar-open .app-shell .sidebar',':root[data-theme="dark"] #orderModal','#orderModal select option','#catalogContent .pack-label']) assert.ok(css.includes(token),'Missing active production CSS rule: '+token);
});

test('dynamic checkout fragments, count labels and page description have English translations',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.ok(source.includes('meta[name="description"]'));
 for(const token of ['أقسام داخلية','main categories','main folders','تم تأكيد الدفع. ','تبديل عملة العرض إلى ','تنتهي الفاتورة في ']) assert.ok(source.includes(token),'Missing translation token: '+token);
});

test('account orders and favourites stay isolated from guest storage',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(store.includes('nexa-store-client:account:'),'account storage is namespaced by customer id');
 assert.ok(store.includes('nexa-store-client:guest'),'guest storage has its own namespace');
 assert.ok(store.includes('function visibleOrders(){return customerAccount?accountOrders:(storageRead().guestOrders||[])}'),'signed-in order history comes from account API results');
 assert.ok(store.includes('accountOrders=(orderData.orders||[])'),'account orders are held separately in memory');
 assert.ok(!store.includes('const saved=storageRead();saved.orders=orders;storageSave(saved)'),'account orders are not copied to guest local storage');
 assert.ok(store.includes("fetch('/api/account/preferences'"),'account favourites and preferences sync through the server');
});

test('desktop drawer labels refresh in the selected language',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const start=store.indexOf("window.addEventListener('nexa:languagechange'");const end=store.indexOf("window.addEventListener('storage'",start);
 const handler=store.slice(start,end);
 assert.ok(handler.includes('setStoreMenuState(isStoreMenuOpen(),false)'),'desktop drawer preserves open state and localizes aria-label');
 assert.ok(handler.includes('closeMenu(true)'),'mobile drawer closes and restores focus on language change');
});

test('visible number formatting follows the storefront language',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(!store.includes(".toLocaleString('en-US')"),'counts do not hard-code English locale');
 assert.ok(!store.includes("Intl.NumberFormat('en-US'"),'currency formatter follows selected locale');
 assert.ok(store.includes("storeIntlLocale()"),'both Arabic and English formats are selected');
});

test('dark checkout and notice surfaces use dark theme tokens',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 for(const selector of ['.wallet-payment-form','.wallet-payment-result','.wallet-invoice-meta','.catalog-note','.wallet-api-note','.support-ticket-result','.reference-warning-panel'])assert.ok(css.includes(selector),'missing dark styling for '+selector);
 assert.ok(css.includes('select option')&&css.includes('background-color:var(--surface-2)!important'),'native select options use dark surfaces');
});

test('repeated language toggles preserve source text and dynamic attributes',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.ok(source.includes('const lastTranslatedText = new WeakMap();'),'The source text node is preserved after translation');
 assert.ok(source.includes('const lastTranslatedAttributes = new WeakMap();'),'Original placeholder and label attributes remain recoverable');
 assert.ok(source.includes('else if(lastTranslated!==undefined&&current!==lastTranslated)'),'App-rendered text changes are distinguished from translations');
 assert.ok(source.includes('aria-description')&&source.includes('data-tooltip'),'Dynamic accessibility labels and tooltips are translated');
});


test('locale transition disables drawer motion before changing document direction',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const setStart=source.indexOf('function setLanguage(next');
 const before=source.indexOf('nexa:languagechange:before',setStart);
 const direction=source.indexOf('updateDocumentLanguage();',setStart);
 assert.ok(before>setStart&&direction>before,'The pre-change event fires before html direction is updated');
 const guard=store.indexOf("window.addEventListener('nexa:languagechange:before'");
 const changed=store.indexOf("window.addEventListener('nexa:languagechange'",guard);
 assert.ok(guard>=0&&changed>guard,'The drawer motion guard is registered before the post-change handler');
 assert.ok(store.slice(guard,changed).includes("classList.add('drawer-direction-switching')"),
  'Drawer transitions are disabled while the old physical side is still active');
});

test('final drawer state rules preserve RTL and LTR open/closed states on desktop and mobile',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 const final=css.slice(css.lastIndexOf('NEXA DRAWER STATE CONTRACT v4'));
 for(const token of [
  ':root[dir="rtl"] body.sidebar-closed .app-shell .sidebar',
  'transform:translate3d(110%,0,0)!important',
  ':root[dir="ltr"] body.sidebar-closed .app-shell .sidebar',
  'transform:translate3d(-110%,0,0)!important',
  'body.sidebar-open .app-shell .sidebar',
  'pointer-events:none!important'
 ])assert.ok(final.includes(token),'Missing final drawer state rule: '+token);
});

test('dark mode converts remaining legacy white panels and controls to dark theme surfaces',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 const final=css.slice(css.lastIndexOf('NEXA DARK SURFACE COMPLETION v4'));
 for(const selector of [
  '.header-search:focus-within','.icon-button','.wallet-chip','.btn-soft','.assistant-launcher',
  '.assistant-head','.assistant-message','.wallet-placeholder','.back-button','.modal-product',
  '.catalog-steps','.catalog-count','.category-mark','.product-badge'
 ])assert.ok(final.includes(selector),'Missing dark theme coverage for '+selector);
 assert.ok(final.includes('background:var(--surface-2)!important'),'Legacy light surfaces use active dark tokens');
});


test('package selection and order dialog have complete dark-mode surfaces',async()=>{
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-wamda-blue.css'),'utf8');
 const dark=css.slice(css.lastIndexOf('NEXA PACKAGE SELECTION + ORDER DIALOG DARK CONTRACT v5'));
 for(const token of [
  '#orderModal .modal-product','#orderModal .modal-close','#orderModal .field label',
  '#orderModal .field small','#orderModal select option','.pack-card',
  '#catalogContent .pack-label','.step-summary','.catalog-note'
 ])assert.ok(dark.includes(token),'Missing dark-mode coverage for '+token);
 assert.ok(dark.includes('background:var(--surface-2)!important'),'Package fields use the dark surface token');
 assert.ok(dark.includes('color-scheme:dark!important'),'Native order controls use the dark color scheme');
});

test('package flow dynamic UI strings and sidebar open/close labels are translated both ways',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 for(const phrase of [
  '"إغلاق القائمة الجانبية": "Close sidebar"',
  '"فتح القائمة الجانبية": "Open sidebar"',
  '"اختر المنطقة أو النسخة أو الخطة المناسبة.": "Choose the suitable region, version or plan."',
  '"الكمية": "Quantity"'
 ])assert.ok(source.includes(phrase),'Missing package-flow translation '+phrase);
 assert.ok(store.includes('nexa-store-language.js?v=20261108-ar-en-syp-v1'),'Package flow locale cache version is fresh');
});


test('catalog folder/product and order/invoice terms are translated in both directions',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 assert.ok(source.includes('const catalogCheckoutTranslations = Object.freeze({'),'the dedicated dynamic catalog and checkout dictionary exists');
 assert.ok(source.includes('productNameTermTranslations,catalogCheckoutTranslations,supplierCheckoutWalletTranslations);'),'the new terms participate in the bidirectional translation lookup');
 for(const [arabic,english] of [
  ["'مجلد':'Folder'","'منتج رقمي':'Digital product'"],["'اختيار الباقة':'Choose package'","'تأكيد الطلب':'Confirm order'"],
  ["'اسم العميل':'Customer name'","'عملة الدفع':'Payment currency'"],["'إنشاء الطلب والمتابعة للدفع':'Create order and continue to payment'","'عنوان محفظة الاستلام':'Receiving wallet address'"],
  ["'فاتورة شام كاش الرسمية':'Official Sham Cash invoice'","'بيانات المنتج':'Product details'"]
 ]){assert.ok(source.includes(arabic)&&source.includes(english),'Missing exact bilingual flow terms '+arabic+' / '+english);}
 assert.ok(store.includes('nexa-store-language.js?v=20261108-ar-en-syp-v1'),'the expanded locale dictionary cache is refreshed');
 assert.ok(store.includes('nexa-responsive.css?v=20261107-package-order-wallet-final-v11'),'the new catalog and modal styles are cache-busted');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-responsive.css'),'utf8');
 for(const selector of [':root[data-theme="dark"] #orderModal',':root[data-theme="light"] #orderModal','#orderModal .modal-body','#orderModal .modal-actions'])assert.ok(css.includes(selector),'Missing theme coverage for '+selector);
});

test('invoice receiver and payment-status content has complete English labels',async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 for(const phrase of [
  "'لم يرد عنوان المحفظة مع الفاتورة.':'The receiving wallet address was not returned with the invoice.'",
  "'عنوان الاستلام مرتبط بهذه الفاتورة ويجب استخدامه لهذا الطلب فقط.':'The receiving address is linked to this invoice and must only be used for this order.'",
  "'لن نطلب كلمة مرور شام كاش أو رمز OTP في أي مرحلة.':'We will never ask for your Sham Cash password or OTP.'",
  "'تحقق من عملية التحويل':'Verify the transfer'"
 ])assert.ok(source.includes(phrase),'Missing invoice / payment translation '+phrase);
});

test('package picker and wallet top-up terms translate in both directions', async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const sandbox={
  window:{addEventListener(){},dispatchEvent(){},requestAnimationFrame(){return 1}},
  document:{getElementById(){return null},
   documentElement:{dataset:{},set lang(value){this.language=value},set dir(value){this.direction=value}},
   body:{nodeType:1,matches(){return false},querySelectorAll(){return []}},
   querySelector(){return null},createTreeWalker(){return {nextNode(){return null}}}
  },
  localStorage:{getItem(){return null},setItem(){}},
  MutationObserver:class{observe(){}},
  NodeFilter:{SHOW_TEXT:4,SHOW_ELEMENT:1},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}
 };
 vm.runInNewContext(source,sandbox,{filename:'nexa-store-language.js'});
 sandbox.window.NexaLocale.initialize();
 const translate=sandbox.window.NexaLocale.translate;
 sandbox.window.NexaLocale.setLanguage('en');
 for(const [arabic,english] of [
  ['متاح للطلب','Available to order'],
  ['غير متوفر حالياً','Currently unavailable'],
  ['اختيار الباقة ←','Choose package ←'],
  ['السعر المعتمد','Approved price'],
  ['شحن رصيد الحساب','Top up account balance'],
  ['اشحن عبر شام كاش؛ سيضاف المبلغ بعد التحقق من الفاتورة ورقم العملية.','Top up with Sham Cash. Funds are added after the invoice and transaction reference are verified.'],
  ['إنشاء فاتورة شحن','Create top-up invoice'],
  ['الحد الأدنى 1,000 والحد الأعلى 5,000,000 ليرة سورية جديدة.','Minimum 1,000 and maximum 5,000,000 new Syrian pounds.'],
  ['الفاتورة صالحة حتى','Invoice valid until'],
  ['حوّل قيمة الفاتورة إلى محفظة Nexa، ثم أدخل رقم العملية في نموذج التحقق.','Transfer the invoice amount to your Nexa wallet, then enter the transaction reference in the verification form.']
 ])assert.equal(translate(arabic),english,'Missing English locale for '+arabic);
 sandbox.window.NexaLocale.setLanguage('ar');
 for(const [arabic,english] of [
  ['متاح للطلب','Available to order'],
  ['اختيار الباقة ←','Choose package ←'],
  ['إنشاء فاتورة شحن','Create top-up invoice'],
  ['الفاتورة صالحة حتى','Invoice valid until']
 ])assert.equal(translate(english),arabic,'Missing Arabic locale for '+english);
});

test('supplier package names, supplier field labels and wallet account strings translate both ways', async()=>{
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const sandbox={window:{addEventListener(){},dispatchEvent(){},requestAnimationFrame(){return 1}},document:{getElementById(){return null},documentElement:{dataset:{},set lang(value){this.language=value},set dir(value){this.direction=value}},body:{nodeType:1,matches(){return false},querySelectorAll(){return []}},querySelector(){return null},createTreeWalker(){return {nextNode(){return null}}}},localStorage:{getItem(){return null},setItem(){}},MutationObserver:class{observe(){}},NodeFilter:{SHOW_TEXT:4,SHOW_ELEMENT:1},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail}}};
 vm.runInNewContext(source,sandbox,{filename:'nexa-store-language.js'});sandbox.window.NexaLocale.initialize();const translate=sandbox.window.NexaLocale.translate;
 const pairs=[['سعر البيع','Sale price'],['منتج رقمي مرتبط بمصدر ومضة','Digital product linked to Wamda source'],['منتج مرتبط بمصدر Best Store','Product linked to Best Store source'],['منتج مرتبط بمصدر ومضة','Product linked to Wamda source'],['المنتج يعمل بشكل تلقائي ٢٤ ساعة ☑','This product runs automatically 24/7 ☑'],['شحن رصيد الحساب','Top up account balance'],['سجّل الدخول لعرض رصيدك ومتابعة عمليات الشحن والشراء.','Sign in to view your balance and track top-ups and purchases.'],['حساب نشط','Active account'],['رصيدك المتاح','Available balance'],['إنشاء فاتورة شحن','Create top-up invoice'],['اشحن عبر شام كاش؛ سيضاف المبلغ بعد التحقق من الفاتورة ورقم العملية.','Top up with Sham Cash. Funds are added after the invoice and transaction reference are verified.'],['كلمة المرور','Password'],['الرقم المصري','Egyptian phone number'],['ايميلك','Your email'],['ادخل عنوان بيب Bep20','Enter BEP20 wallet address'],['رقم واتساب للتواصل','WhatsApp contact number'],['معرف اللاعب','Player ID'],['حساب شام كاش للمستلم','Recipient Sham Cash account'],['اختر المدينة','Choose city'],['رقم الهاتف الخاص بك','Your phone number'],['يرجى التأكد من "أيدي" المستخدم قبل الإرسال','Please verify the user ID before submitting']];
 sandbox.window.NexaLocale.setLanguage('en');for(const [ar,en] of pairs)assert.equal(translate(ar),en,'Missing English translation for '+ar);
 sandbox.window.NexaLocale.setLanguage('ar');for(const [ar,en] of pairs){const expected=ar.includes('Bep20')?'ادخل عنوان بيب Bep٢٠':(en==='Player ID'?'رقم اللاعب':(en==='Choose city'?'اختر  المدينة':ar));assert.equal(translate(en),expected,'Missing Arabic translation for '+en);}
});

test('storefront supports USD and SYP display while invoice amounts keep their real currency',async()=>{
 const store=await fs.readFile(path.join(webRoot,'index.html'),'utf8');
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 const server=await fs.readFile(path.join(webRoot,'server/src/server.js'),'utf8');
 const preferences=await fs.readFile(path.join(webRoot,'server/src/customer-preferences.js'),'utf8');
 const css=await fs.readFile(path.join(webRoot,'assets/brand/nexa-interface-finish.css'),'utf8');
 const locale=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 assert.ok(store.includes("const storeIntlLocale=()=>storeLocale()==='ar'?'ar-SY':'en-US'"));
 assert.ok(store.includes("const next=storeLocale()==='ar'?'en':'ar'"));
 assert.ok(store.includes("const STORE_DISPLAY_CURRENCY_KEY='nexa-store-display-currency'"));
 assert.ok(store.includes('id="sidebarCurrencyToggle"')&&store.includes("getStoreDisplayCurrency()==='SYP'?'USD':'SYP'"));
 assert.ok(store.includes("return formatCurrencyAmount(value/storefrontFxRate,'USD')"));
 assert.ok(store.includes("return formatCurrencyAmount(amount*storefrontFxRate,'SYP')"));
 assert.ok(store.includes("const formatMinor=(minor,currency='SYP')")&&store.includes("formatCurrencyAmount(value,currency==='USD'?'USD':'SYP')"));
 assert.ok(store.includes("preview.textContent=formatCurrencyAmount(totalSyp,'SYP')"),'SYP checkout invoices remain quoted in SYP');
 assert.ok(store.includes("saveCustomerPreferences({displayCurrency:selected})"));
 assert.ok(store.includes("preferences.displayCurrency))setStoreDisplayCurrency"));
 assert.ok(!store.includes('TRY')&&!store.includes('storefrontTryPerUsd')&&!store.includes('tr-TR'));
 assert.ok(admin.includes('id="adminLanguageToggle"')&&admin.includes('initializeAdminLocale();'));
 assert.ok(admin.includes("window.NexaLocale?.setLanguage(locale==='ar'?'en':'ar')"));
 assert.ok(!admin.includes('fxTryRate')&&!admin.includes('tryPerUsd'));
 assert.ok(server.includes("delete storeSettings.tryPerUsd"),'Legacy TRY setting is discarded when settings load');
 assert.ok(!server.includes('tryFxReady')&&!server.includes('INVALID_TRY_PER_USD'));
 assert.ok(preferences.includes("if(source.locale==='ar'||source.locale==='en')"));
 assert.ok(preferences.includes("source.displayCurrency==='USD'?'USD':'SYP'"));
 assert.ok(preferences.includes("!['SYP','USD'].includes(patch.displayCurrency)"));
 assert.ok(locale.includes("const selected=next==='en'?'en':'ar'"));
 assert.ok(locale.includes('adminSupplementaryTranslations'));
 assert.ok(!locale.includes('turkishTranslations')&&!locale.includes('turkishReverse')&&!locale.includes('tr-TR'));
 assert.ok(css.includes(":root[data-theme=\"dark\"]")&&css.includes(":root[data-theme=\"light\"]"));
 assert.ok(css.includes(":root[dir=\"ltr\"] #app.shell .side")&&css.includes(":root[dir=\"rtl\"] #app.shell .side"));
 assert.ok(store.includes("nexa-interface-finish.css")&&admin.includes("nexa-interface-finish.css"));
});

test('every static Arabic administration text has an English translation',async()=>{
 const admin=await fs.readFile(path.join(webRoot,'admin.html'),'utf8');
 const source=await fs.readFile(path.join(webRoot,'assets/brand/nexa-store-language.js'),'utf8');
 const mainMap=source.match(/const adminEnglishTranslations = Object\\.freeze\\((\\{[\\s\\S]*?\\})\\);/);
 const extraMap=source.match(/const adminSupplementaryTranslations = Object\\.freeze\\((\\{[\\s\\S]*?\\})\\);/);
 assert.ok(mainMap&&extraMap,'Both admin translation dictionaries must be present');
 const keys=new Set([...Object.keys(JSON.parse(mainMap[1])),...Object.keys(JSON.parse(extraMap[1]))]);
 const bodyStart=admin.indexOf('<body'),scriptStart=admin.indexOf('<script src="/assets/brand/nexa-catalog.js');
 const body=admin.slice(bodyStart,scriptStart);
 const nodes=[...body.matchAll(/>([^<>]+)</g)].map(match=>match[1].replace(/\\s+/g,' ').trim()).filter(value=>/[\\u0600-\\u06FF]/.test(value)&&value.length>1);
 const missing=[...new Set(nodes)].filter(value=>!keys.has(value));
 assert.deepEqual(missing,[],'Every static Arabic admin label and help text must have an exact English translation');
});
