# Nexa Store — Premium UI + Sham Cash API v1

متجر Nexa عربي RTL متجاوب مع الكمبيوتر والجوال وChrome. يعتمد هوية فحمية وذهبية مع وضعين فاتح وداكن مستقلين للمتجر ولوحة الإدارة، ويستخدم PostgreSQL لحفظ الكتالوج والإعدادات والطلبات.

## التشغيل

- **المتجر مع الدفع API:** راجع `server/README.md`، وثبّت Node.js 20.11+ وPostgreSQL 14+، واضبط الأسرار في بيئة الخادم، ثم شغّل `npm install && npm start` من مجلد `server`.
- **معاينة مستقلة:** `index-standalone.html` للعرض فقط؛ تدفق الفاتورة والتحقق المالي يحتاج Node.js وPostgreSQL وHTTPS على نفس النطاق.
- **نسخة قابلة للتعديل:** `index.html` مع `assets/` و`server/`.

## أقسام الواجهة

الرئيسية، المتجر، الطلبات، المفضلة، الدفع عبر شام كاش، ومركز الدعم. تصميم بألوان كحلي عميق وأخضر يشمي/فيروزي ولمسات محايدة، مع تخطيطات متجاوبة.

## شام كاش

يعتمد الخادم المسارات الرسمية في التوثيق:

- `GET /v1/wallets` للتأكد من المحفظة النشطة.
- `POST /v1/invoices` لإصدار فاتورة مرتبطة بطلب Nexa.
- `GET /v1/wallets/shamcash/{walletAddress}/transactions/{tranId}` للتحقق من التحويل الوارد والوقت وعنوان المستلم والمبلغ الدقيق.
- `POST /v1/invoices/{invoiceNumber}/verify` لاستهلاك رقم العملية مرة واحدة لدى المزوّد.
- `GET /v1/invoices/{invoiceNumber}` لمراجعة الحالة والمبلغ المدفوع الفعلي.

يراجع الخادم المبلغ والعملة والاتجاه والمستلم والوقت والانتهاء، ثم يسجل الدفع مرة واحدة في PostgreSQL بقيود فريدة ومعاملة SQL. مفاتيح API لا تُرسل إلى المتصفح. راجع `server/README.md` للتوثيق والإعدادات والحدود والصلاحيات.

في التطوير المحلي يبدأ PAYMENTS_ENABLED=false في ملف المثال. إعداد Render المنشور منفصل ويُدار من متغيرات الخدمة وإعدادات لوحة الإدارة. لا تعتبر الدفع جاهزاً لمجرد تشغيل الخادم؛ يجب أن تكون قاعدة البيانات ومفتاح Sham Cash ومحفظة الاستلام النشطة قد اجتازت الفحص.

## مكونات أخرى

- مركز دعم مع واتساب وبريد ونموذج تجهيز بلاغ وأسئلة شائعة.
- مساعد Nexa الإرشادي داخل الموقع.
- أصول صور محلية تعمل دون تحميل صور خارجية.
- تكامل WAMDA يدعم مزامنة الكتالوج والتسعير وطلب المورد بعد التحقق من الدفع، مع إعادة التحقق من رقم الطلب قبل إعادة المحاولة.
- تكامل SEAGM يدعم البطاقات والشحن المباشر والـWebhook الموقّع والتسليم المشفّر بعد التحقق من الدفع. يحتاج UID وSecret Key من حساب التاجر، ويجب اختباره في Sandbox قبل Production.


## العملة السورية الجديدة وسعر الدولار

- الكتالوج والأسعار الحالية تُدار في PostgreSQL، ويجب التأكد من وحدة العملة التي يستخدمها كل مصدر قبل نشر المنتج للبيع.
- إعداد سعر الصرف الذي ظهر في قاعدة البيانات بتاريخ 1 نوفمبر 2026 هو 145 ليرة سورية جديدة لكل دولار بوضع يدوي. يمكن للإدارة تغييره أو ضبط مصدر آلي موثوق. لا يرسل المتصفح السعر النهائي؛ يحسبه الخادم ويطابقه مع الفاتورة قبل اعتماد الدفع.



## لوحة الإدارة

- افتح `/admin.html` وسجّل الدخول باستخدام `ADMIN_API_KEY` المضبوط في أسرار Render. تنشأ جلسة مؤقتة عبر Cookie من نوع HttpOnly.
- إدارة الأقسام والمنتجات والمناطق والباقات والأسعار وصورها ووصفها تحفظ في PostgreSQL وتنعكس على المتجر عبر `GET /api/catalog`.
- اسم المتجر والشعار والإعلان وألوان الهوية، وإعدادات شام كاش والمحفظة، وسعر الصرف تُدار من نفس اللوحة.
- مفاتيح Sham Cash وSP Today تُشفّر بمفتاح مستقل `STORE_SETTINGS_ENCRYPTION_KEY` ولا تعاد في واجهة الإدارة.
- الصرف الافتراضي اليدوي 145 ليرة سورية جديدة لكل دولار. الوضع التلقائي يحتاج Endpoint ومسار JSON ومصادقة صحيحة من توثيق SP Today V2؛ لم يتم تخمينها. في الوضع التلقائي يُمنع تسعير USD عندما يتجاوز آخر تحديث 30 دقيقة.
- صفحة الطلبات تعرض بيانات الفواتير والتحقق، ولا توفر زر اعتماد دفع يدوي. إلغاء الطلب المعلّق يحاول إلغاء فاتورة المزوّد أولاً.
- بعد التحقق الفعلي من الدفع يظهر وصل إلكتروني يحتوي بيانات العملية ويستطيع العميل طباعته أو حفظه PDF.



## تصميم الواجهة الجديد

تعتمد الواجهة ولوحة الإدارة هوية Nexa الفحمية والذهبية، مع وضع فاتح وداكن مستقل لكل واجهة، وتباين منفصل للحقول والنوافذ والجداول. تنقّل المتجر منظم في خمسة مستويات: القسم الرئيسي، قسم المورد، المنتج، الخيار/المنطقة، ثم الباقة.

## ربط المنتجات عبر API

تدعم لوحة الإدارة مزامنة كتالوج من API خارجي:

- رابط HTTPS، ترويسة `Authorization: Bearer` أو `x-api-key` أو بدون مفتاح، ومسار JSON مثل `catalog` أو `data.catalog`.
- استيراد يدوي مع معاينة قبل الحفظ، أو مزامنة مجدولة بفاصل من 5 إلى 1440 دقيقة.
- وضع الدمج الافتراضي يحدّث العناصر ذات المعرّفات المطابقة ويضيف الجديدة ويحافظ على المنتجات المحلية غير الموجودة في المصدر. وضع الاستبدال الكامل متاح عند الحاجة فقط.
- الاستجابة يجب أن تتبع بنية `catalog.json`؛ الأسعار أرقام بالليرة السورية الجديدة، ومعرّفات الأقسام والمنتجات والخيارات فريدة داخل نطاقها. الصور روابط HTTPS أو مسارات أصول محلية أو صور raster مضمنة.
- توجد واجهة كتابة مستقلة: `POST /api/admin/catalog/products` مع ترويسة `X-Catalog-Key` التي تنشئها من صفحة ربط API. المفتاح محدود بإضافة وتحديث المنتجات ولا يمنح صلاحيات إدارية أخرى.
- مفاتيح مزود الكتالوج ومفتاح الكتابة تُخزّن مشفّرة في PostgreSQL ولا تُعاد إلى الواجهة العامة.


## Dual supplier catalog: WAMDA + Best Store

The Catalog API admin page can connect WAMDA and Best Store to the same storefront. The new “Compare suppliers and publish cheapest” action fetches the latest catalogs from configured sources, matches equivalent game/service SKUs, compares the supplier's base cost before profit, and publishes the lower available cost. Non-matching products from either source remain available in their own storefront category; the public shop does not split its top-level sections by supplier.

Best Store's API docs do not explicitly state the currency for `base_price` or `price`, so choose the matching account currency (USD or SYP) in the admin settings and explicitly confirm it before comparison. The system disables Best Store catalog availability and blocks automated publication/checkout until this confirmation is saved; changing the selected currency clears it. The system uses `base_price` when available and falls back to `price`. Profit is applied only after the winning supplier is selected. Manual edits to published product names, descriptions, images and option prices are preserved during refresh.


## Best Store Webhook

- On first boot, the server creates a random callback secret and stores it encrypted in the existing nexa_store_state.settings; no additional database migration or Render secret is required.
- Open the Nexa Admin dashboard → Catalog API → Best Store. Copy the generated Best Store Webhook URL, paste it into the Best Store account's API → webhook url field, and save it in the Best Store portal.
- The receiver accepts JSON and application/x-www-form-urlencoded callback bodies. It resolves an existing order using order_uuid, a Nexa merchant order ID, or a Best Store supplier order ID; a callback without a supported order reference is rejected.
- The callback is only a wake-up signal. Nexa never trusts a callback status as proof of delivery. It rechecks the UUID through Best Store's authenticated check endpoint and applies the existing order-state machine; duplicate callbacks are safe.
- Best Store's public API reference documents profile, catalog, new order and order-check endpoints but does not describe the webhook event schema or a signature. Treat the generated URL as a secret and do not publish it in logs or source code.
- Best Store API credentials are entered only in the Nexa Admin UI and encrypted at rest. Confirm the supplier's price currency before importing/publishing or enabling automated comparisons.
